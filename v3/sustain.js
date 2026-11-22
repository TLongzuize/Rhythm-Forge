import { spectralEnvelopeTracker, attributeLayers, collectEnvelopeAttacks, recurringEnvelopes } from './attack-spectrum.js';

// Track a narrow spectral peak beginning at a measured attack. A sustained
// partial can remain audible underneath other attacks in the same coarse band.
// The analysis proposes an endpoint only after observing its disappearance.
const SUSTAIN_HOP_MS = 20;
const MIN_POWER = 0.000018;
const MAX_SUSTAIN_MS = 1800;
export const MAX_TRACKED_SUSTAIN_MS = 3600;

function sustainSpectra(pcm, sampleRate, windowMs = 75, hopMs = SUSTAIN_HOP_MS, maxHz = 3300) {
  const decimation = Math.max(1, Math.floor(sampleRate / 16000));
  const rate = sampleRate / decimation;
  const size = 2 ** Math.ceil(Math.log2(rate * windowMs / 1000));
  // Pack even and odd samples as one complex transform. Only reconstruct the
  // positive frequencies that the onset and sustain estimators actually read.
  const halfSize = size / 2;
  const real = new Float64Array(halfSize), imag = new Float64Array(halfSize);
  const reversal = new Uint16Array(halfSize);
  const window = Float64Array.from({ length:size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size));
  const cos = real.map((_, i) => Math.cos(2 * Math.PI * i / size));
  const sin = real.map((_, i) => -Math.sin(2 * Math.PI * i / size));
  for (let i = 1; i < halfSize; i++) reversal[i] = (reversal[i >> 1] >> 1) | ((i & 1) * halfSize / 2);

  const frames = new Int32Array(256).fill(-2147483648);
  const spectra = new Array(frames.length);
  const scale = 4 / (size * size);
  const binHz = rate / size;
  const bins = Math.min(size / 2, Math.ceil(maxHz / binHz) + 4);
  function at(ms) {
    const frame = Math.round(ms / hopMs);
    const slot = frame & (frames.length-1);
    if (frames[slot] === frame) return spectra[slot];
    const start = Math.round(frame * hopMs * sampleRate / 1000) - size * decimation / 2;
    for (let i = 0; i < halfSize; i++) {
      const lane = reversal[i], offset = 2 * i;
      const index = start + offset * decimation;
      if (decimation === 1) {
        real[lane] = window[offset] * (pcm[index] ?? 0);
        imag[lane] = window[offset + 1] * (pcm[index + 1] ?? 0);
      } else {
        let even = 0, odd = 0;
        for (let j = 0; j < decimation; j++) {
          even += pcm[index + j] ?? 0;
          odd += pcm[index + decimation + j] ?? 0;
        }
        real[lane] = window[offset] * even / decimation;
        imag[lane] = window[offset + 1] * odd / decimation;
      }
    }
    for (let width = 2; width <= halfSize; width *= 2) {
      const half = width / 2, stride = size / width;
      for (let base = 0; base < halfSize; base += width) for (let offset = 0; offset < half; offset++) {
        const a = base + offset, b = a + half, k = offset * stride;
        const x = cos[k] * real[b] - sin[k] * imag[b];
        const y = sin[k] * real[b] + cos[k] * imag[b];
        real[b] = real[a] - x;
        imag[b] = imag[a] - y;
        real[a] += x;
        imag[a] += y;
      }
    }
    // Callers finish reading a frame before the cache wraps. The longest
    // tonal read spans 3.8 s (256 slots cover 5.12 s), and the brief
    // detector reads one local attack at a time (2.048 s of slots).
    const power = spectra[slot] ??= new Float32Array(bins);
    for (let k = 1; k < bins; k++) {
      const mirror = halfSize - k;
      const evenRe = real[k] + real[mirror], evenIm = imag[k] - imag[mirror];
      const oddRe = imag[k] + imag[mirror], oddIm = real[mirror] - real[k];
      const re = evenRe + cos[k] * oddRe - sin[k] * oddIm;
      const im = evenIm + sin[k] * oddRe + cos[k] * oddIm;
      power[k] = scale * 0.25 * (re * re + im * im);
    }
    frames[slot] = frame;
    return power;
  }
  return { at, binHz, bins };
}

const nearPower = (power, k) => power[k - 1] + power[k] + power[k + 1];

// A narrow arrival that remains audible can corroborate a pitched gesture.
function pitchedArrival(t, tonal) {
  const body = tonal.at(t + 45), arrival = tonal.at(t + 15);
  const prior = tonal.at(t - 45), older = tonal.at(t - 85), trough = tonal.at(t - 25);
  const arrivals = [];
  const voices = [], partials = [];
  let clearPitch = false;
  let total = 0;
  for (const power of body) total += power;
  for (let k = Math.max(4, Math.ceil(65 / tonal.binHz)); k < body.length - 4; k++) {
    if (body[k] < body[k - 1] || body[k] <= body[k + 1] ||
        body[k] < 3 * Math.max(body[k - 3], body[k + 3])) continue;
    const amount = Math.min(nearPower(body, k), nearPower(arrival, k) * 1.8);
    let background = MIN_POWER;
    for (let j = k - 2; j <= k + 2; j++)
      background = Math.max(background, nearPower(prior, j), nearPower(older, j));
    const emergence = amount - 2.6 * background;
    const share = emergence / Math.max(0.00022, total);
    const previousPartial = Math.max(nearPower(trough,k-1), nearPower(trough,k), nearPower(trough,k+1));
    const attackShare = (amount-1.35*previousPartial)/Math.max(.00022,total);
    if (attackShare >= .006 && amount >= MIN_POWER) {
      const l = Math.log(Math.max(1e-14,body[k-1])), c = Math.log(body[k]);
      const r = Math.log(Math.max(1e-14,body[k+1]));
      const center = k + Math.max(-.5,Math.min(.5,(l-r)/(2*(l-2*c+r)) || 0));
      partials.push({center,share:attackShare});
    }
    // A quiet but isolated partial can enter under a much louder sound
    // in another register. Compare against the immediate spectral region.
    if (emergence >= 0.0004 && nearPower(body, k) >= amount * 0.95) {
      let local = 0;
      for (let j = k - 4; j <= k + 4; j++) local += body[j];
      if (emergence >= local * 0.48 && amount >= background * 6) {
        clearPitch = true;
        voices.push({ k, power:emergence, relative:emergence / Math.max(total, .00022) });
      }
    }
    if (share >= 0.07) arrivals.push({ frequency: k * tonal.binHz, share });
  }
  arrivals.sort((a, b) => b.share - a.share);
  const pitched = arrivals[0]?.share ?? 0;
  const independentPitch = arrivals.slice(1).some(({ frequency, share }) => {
    const primary = arrivals[0].frequency;
    const ratio = Math.max(primary, frequency) / Math.min(primary, frequency);
    return share >= 0.11 && ratio > 1.12 && ratio < 3.9 &&
      ![1.25, 4 / 3, 1.5, 5 / 3, 2, 2.5, 3, 3.5].some(harmonic => Math.abs(ratio - harmonic) < 0.065);
  });
  voices.sort((a,b) => b.power-a.power);
  const lead = voices[0];
  let dyad;
  if (lead) for (const other of voices.slice(1)) {
    if (other.relative < .045 || other.power < .18*lead.power) continue;
    const low = Math.min(lead.k,other.k), high = Math.max(lead.k,other.k), ratio = high/low;
    if (low < 6 || ratio < 1.16 || Math.abs(high - Math.round(ratio)*low) < 1.8) continue;
    // A single harmonic series can explain 2f and 3f even though their
    // ratio is non-integral. Look for the corresponding lower fundamental.
    let shared = false;
    for (let divisor = 2; divisor <= 5; divisor++) {
      const base = low/divisor, bin = Math.round(base);
      if (bin < 3 || base*tonal.binHz < 52 || Math.abs(high-Math.round(high/base)*base) > 1.5) continue;
      if (nearPower(body,bin) >= other.power*.10) shared = true;
    }
    if (shared) continue;
    // Staggered disappearances give additional evidence for separate tones.
    const later = tonal.at(t+90);
    const decayA = nearPower(later,lead.k)/Math.max(MIN_POWER,nearPower(body,lead.k));
    const decayB = nearPower(later,other.k)/Math.max(MIN_POWER,nearPower(body,other.k));
    if (Math.abs(Math.min(1.5,decayA)-Math.min(1.5,decayB)) < .32) continue;
    dyad = [Math.round(lead.k*tonal.binHz),Math.round(other.k*tonal.binHz)];
    break;
  }
  // Explain harmonics before counting another pitch. Strong overtones of
  // one piano key often dominate its fundamental. A residual fundamental
  // needs its own overtones or a separately observed decay.
  let harmonicDyad;
  if (partials.length >= 3) {
    const fits = partials.filter(p => p.share >= .016 && p.center*tonal.binHz < 1700).map(root => {
      const series = partials.filter(p => {
        const multiple = Math.round(p.center/root.center);
        return multiple >= 1 && multiple <= 9 &&
          Math.abs(p.center-multiple*root.center) <= Math.max(.85, .013*p.center);
      });
      return { root, series, energy:series.reduce((sum,p) => sum+p.share,0) };
    }).sort((a,b) => b.energy-a.energy);
    const first = fits[0];
    if (first) for (const second of fits.slice(1)) {
      if (first.series.includes(second.root) || second.series.includes(first.root)) continue;
      const residual = second.series.filter(p => !first.series.includes(p));
      const share = residual.reduce((sum,p) => sum+p.share,0);
      if (residual.length < 2 || share < .045 || share < first.energy*.14 || first.series.length < 2) continue;
      const common = [2,3,4].some(divisor => {
        const base = Math.min(first.root.center,second.root.center)/divisor;
        if (base*tonal.binHz < 55 || Math.abs(second.root.center/base-Math.round(second.root.center/base)) > .05 ||
            Math.abs(first.root.center/base-Math.round(first.root.center/base)) > .05) return false;
        return nearPower(body,Math.round(base)) > total*.012;
      });
      if (!common) {
        harmonicDyad = [first.root,second.root].map(p => Math.round(p.center*tonal.binHz));
        break;
      }
    }
  }
  return { voice:(lead || harmonicDyad) && { hz:lead ? Math.round(lead.k*tonal.binHz) : harmonicDyad[0],
      share:lead?.relative ?? pitched, ...(dyad || harmonicDyad ? {dyad:dyad ?? harmonicDyad} : {}) },
    pitched, ...(clearPitch ? { clearPitch: true } : {}), ...(independentPitch ? { independentPitch: true } : {}) };
}

// A short-lived, diffuse rise can corroborate an impact arriving with a
// pitched gesture. Both estimates describe changes in the mixed recording.
function percussiveImpact(t, brief) {
  const initial = brief.at(t + 8), before = brief.at(t - 24), after = brief.at(t + 40);
  let residual = 0, reference = 0, spread = 0;
  for (let k = Math.max(3, Math.ceil(1250 / brief.binHz)); k < initial.length - 1; k++) {
    // Use the smaller adjacent power to suppress isolated narrow peaks and
    // discount energy still present after the attack.
    const level = Math.min(initial[k], initial[k - 1], initial[k + 1]);
    const background = Math.max(before[k - 1], before[k], before[k + 1], after[k] * 1.4);
    reference += initial[k];
    const rise = level - background * 1.35;
    if (rise <= MIN_POWER / 16) continue;
    residual += rise;
    spread++;
  }
  return spread >= Math.max(4, 250 / brief.binHz)
    ? residual / Math.max(0.00008, reference) : 0;
}

// Find short spectral arrivals which can disappear in three-band RMS. A
// frequency neighborhood in the earlier spectrum rejects slight glides.
// Pick temporal peaks against a local background independently in each band.
function findSpectralAttacks(brief, tonal, durationMs, events, waveform, progress) {
  const hop = 8;
  const frames = Math.ceil(durationMs / hop);
  const novelty = Array.from({ length: 3 }, () => new Float32Array(frames));
  const envelopes = spectralEnvelopeTracker(brief.binHz, brief.bins, frames);
  const bandEnds = [350, 1700, 7600].map(hz => Math.ceil(hz / brief.binHz));
  let eventIndex = 0;
  for (let i = 2; i < frames; i++) {
    const time = i * hop;
    const after = brief.at(time), prior = brief.at(time - 2 * hop);
    envelopes.observe(i, after);
    while ((events[eventIndex]?.timeMs ?? Infinity) + 40 <= time) {
      const event = events[eventIndex++];
      if (event.strength < 0.115 || event.timeMs < 45 || event.timeMs + 65 > durationMs) continue;
      const impact = percussiveImpact(event.timeMs, brief);
      if (impact >= 0.035 || event.components)
        event.components = { pitched: 0, ...event.components, impact };
    }
    let band = 0;
    for (let k = 2; k < Math.min(after.length - 1, bandEnds[2]); k++) {
      if (k === bandEnds[band]) band++;
      const background = Math.max(prior[k - 1], prior[k], prior[k + 1]);
      const increase = after[k] - background * 1.35;
      if (increase > MIN_POWER / 8)
        novelty[band][i] += Math.log1p(increase / (MIN_POWER + background));
    }
    if (i % 2048 === 0) progress(i / frames);
  }
  const peaks = [];
  for (const [band, values] of novelty.entries()) {
    const width = 24;
    let sum = 0;
    for (let i = 0; i <= Math.min(width, values.length - 1); i++) sum += values[i];
    for (let i = 1; i < values.length - 2; i++) {
      sum += values[i + width] ?? 0;
      sum -= values[i - width - 1] ?? 0;
      const value = values[i];
      const floor = sum / (Math.min(frames - 1, i + width) - Math.max(0, i - width) + 1);
      const absolute = [0.58, 1.55, 1.8][band];
      if (value < Math.max(absolute, 3 * floor) || value <= values[i - 1] || value < values[i + 1] ||
          value <= values[i - 2] || value < values[i + 2]) continue;
      const rise = values[i - 1] < value * 0.38 ? 0 : hop;
      const timeMs = i * hop - rise;
      const confidence = Math.min(0.44, 0.065 * Math.log1p(value / absolute) + 0.038 * (value / floor - 3));
      const trace = waveform.rawTrace && { detector:'spectral', sourceMs:i*hop, refinedMs:timeMs, band,
        confidence, decision:'coincident-register-peak' };
      if (trace) waveform.rawTrace.push(trace);
      peaks.push({ timeMs, band, confidence, score: value / absolute, trace });
    }
  }
  peaks.sort((a, b) => a.timeMs - b.timeMs || b.score - a.score);
  const separated = [];
  for (const peak of peaks) {
    const previous = separated.at(-1);
    if (!previous || peak.timeMs - previous.timeMs >= 34) separated.push(peak);
    else if (peak.score > previous.score) separated[separated.length - 1] = peak;
  }
  const additional = [];
  let near = 0;
  for (const peak of separated) {
    while (events[near + 1] && events[near + 1].timeMs < peak.timeMs) near++;
    const matched = [events[near], events[near + 1]].filter(Boolean)
      .sort((a, b) => Math.abs(a.timeMs - peak.timeMs) - Math.abs(b.timeMs - peak.timeMs))[0];
    if (peak.trace) peak.trace.decision = 'separation-or-confidence';
    if (Math.abs((matched?.timeMs ?? Infinity) - peak.timeMs) <= 22) {
      if (peak.trace) Object.assign(peak.trace, {decision:'merged', targetMs:matched.timeMs});
      matched.spectralRise = Math.max(matched.spectralRise ?? 0, peak.confidence);
    } else if (Math.abs((matched?.timeMs ?? Infinity) - peak.timeMs) >= 34 && peak.confidence >= 0.14) {
      const { voice, ...pitchEvidence } = pitchedArrival(peak.timeMs, tonal);
      const components = { ...pitchEvidence,
        impact: percussiveImpact(peak.timeMs, brief) };
      // Narrow changes can also be resonances moving during a sustained
      // sound. Prefer a genuine level rise, corroboration in the spectral
      // envelope, or a strong peak later supported by rhythm analysis.
      const { energy, hopMs } = waveform;
      const frame = Math.floor(peak.timeMs / hopMs);
      let priorMean = 0, priorPeak = 0, onsetPeak = 0;
      for (let j = -10; j <= 3; j++) {
        const rms = energy[(frame + j) * 3 + peak.band] ?? 0;
        if (j < -3) {
          priorMean += rms / 7;
          priorPeak = Math.max(priorPeak, rms);
        } else onsetPeak = Math.max(onsetPeak, rms);
      }
      const waveformRise = onsetPeak >= 1.2 * Math.max(0.008, priorMean) && onsetPeak - priorPeak >= 0.002;
      const separatedGesture = components.clearPitch || components.impact >= 0.085;
      const neighborGap = Math.abs((matched?.timeMs ?? Infinity) - peak.timeMs);
      // A rise immediately following a broadband hit can be the same sound's
      // resonant body. Require a distinct launch cue to place both heads.
      if (peak.trace) peak.trace.decision = 'unconfirmed-launch';
      if (neighborGap < 60 && peak.band === matched?.band && matched.confidence >= 0.10 && !separatedGesture) continue;
      const launch = waveformRise || separatedGesture;
      if (!launch && peak.score < 4) continue;
      // Backtrack a corroborated level rise to its first stable elevation.
      let timeMs = peak.timeMs;
      if (waveformRise) {
        const crossing = priorPeak + 0.20 * (onsetPeak - priorPeak);
        for (let j = frame - 3; j <= frame + 2; j++) {
          if (energy[j * 3 + peak.band] < crossing || energy[(j + 1) * 3 + peak.band] < crossing) continue;
          if (Number.isFinite(energy[j * 3 + peak.band]) && j >= 0) timeMs = Math.min(timeMs, j * hopMs);
          break;
        }
      }
      if (peak.trace) peak.trace.decision = 'refined-times-too-close';
      if (Math.min(Math.abs(timeMs - (events[near]?.timeMs ?? -Infinity)),
          Math.abs(timeMs - (events[near + 1]?.timeMs ?? Infinity))) < 34 ||
          timeMs - (additional.at(-1)?.timeMs ?? -Infinity) < 34) continue;
      if (peak.trace) Object.assign(peak.trace, { decision:'candidate', targetMs:timeMs });
      additional.push({ timeMs, band: peak.band, bandSpread: 0, strength: 0.18 + 0.4 * peak.confidence,
        confidence: peak.confidence, sustainEndMs: timeMs, spectralRise: peak.confidence, spectralOnly: true,
        components, ...(voice ? { voice } : {}), ...(launch ? { corroboratedLaunch: true } : {}) });
    }
  }
  const peaksByTime = envelopes.peaks(hop);
  let anchor = 0;
  for (const peak of peaksByTime) {
    if (peak.relative >= 1.75 && peak.band < 2) {
      while (anchor+1 < events.length && Math.abs(events[anchor+1].timeMs-peak.timeMs) <
          Math.abs(events[anchor].timeMs-peak.timeMs)) anchor++;
      const e = events[anchor];
      const pitched = e && e.timeMs === peak.timeMs && e.strength >= .115
        ? { ...e.components, voice:e.voice } : pitchedArrival(peak.timeMs, tonal);
      if (pitched.voice) peak.voice = pitched.voice;
      peak.pitched = !!(pitched.clearPitch || pitched.pitched >= 0.15);
    }
  }
  recurringEnvelopes(peaksByTime);
  attributeLayers(peaksByTime);
  const extra = collectEnvelopeAttacks(events, additional, peaksByTime, waveform.rawTrace);
  // The decay vectors are needed only for source attribution. Keep the
  // reusable Worker analysis sparse when it crosses into the browser cache.
  for (const peak of peaksByTime) { delete peak.tail; delete peak.height; }
  return { additional, envelopes:extra };
}

// A weak broadband rise can be a new pitched note over steady accompaniment.
// Compare with a frequency neighborhood in the older frames so ordinary
// vibrato does not look like a fresh partial in an adjacent bin.
function tonalEntry(at, time, binHz) {
  const before = at(time - 55), earlier = at(time - 95);
  const arrival = at(time + 15), body = at(time + 45);
  let total = 0;
  for (const level of body) total += level;
  for (let k = Math.max(5, Math.ceil(75 / binHz)); k < body.length - 5; k++) {
    if (body[k] < body[k - 1] || body[k] < body[k + 1] ||
        body[k] < 3 * Math.max(body[k - 3], body[k + 3])) continue;
    const amount = nearPower(body, k);
    if (amount < Math.max(total * 0.15, MIN_POWER * 5)) continue;
    let background = 0;
    for (let j = k - 3; j <= k + 3; j++)
      background = Math.max(background, nearPower(before, j), nearPower(earlier, j));
    if (amount >= background * 4.2 &&
        nearPower(arrival, k) >= Math.max(amount * 0.36, background * 2.5)) return true;
  }
  return false;
}

// Follow only a dominant onset with a clean launch. General polyphonic
// evidence still uses the fixed-bin detector below.
function sustainedPeak(onset, arrival, before, earlier, binHz) {
  let k = 0, total = 0;
  for (let i = Math.max(4, Math.ceil(60 / binHz)); i < onset.length - 3; i++) {
    total += onset[i];
    if (onset[i] > onset[k]) k = i;
  }
  if (!k) return undefined;
  const power = nearPower(onset, k);
  const background = Math.max(nearPower(before, k), nearPower(earlier, k));
  if (power < Math.max(total * 0.62, MIN_POWER * 6, background * 6) ||
      nearPower(arrival, k) < Math.max(power * 0.30, background * 3) ||
      onset[k] < 4 * Math.max(onset[k - 3], onset[k + 3])) return undefined;
  return { k, power, background };
}

function interruptsPartial(at, attack, center, minimum) {
  const before = at(attack.timeMs - 50), after = at(attack.timeMs + 50);
  const old = nearPower(before, center);
  if (old < minimum) return false;
  if (nearPower(after, center) > old * 1.9) return true;
  // A separate nearby note can enter while the old partial remains, so a
  // replacement requires both a new local peak and loss at the old position.
  if (nearPower(after, center) >= old * 0.72) return false;
  for (let k = Math.max(2, center - 4); k <= Math.min(center + 4, after.length - 2); k++) {
    if (Math.abs(k - center) >= 2 &&
        nearPower(after, k) > Math.max(old * 0.55, nearPower(before, k) * 2.2)) return true;
  }
  return false;
}

function trackSustain(at, events, index, launch, durationMs) {
  const { k: origin, power: launched, background } = launch;
  const event = events[index], start = event.timeMs;
  const limit = Math.min(durationMs, start + MAX_TRACKED_SUSTAIN_MS);
  const minimum = Math.max(MIN_POWER / 2, launched * 0.18, background * 2);
  let center = origin, previous = launched, missing = 0, settled = Infinity, lastSeen;
  let neighboringAttack = index + 1;
  for (let t = Math.round((start + 65) / SUSTAIN_HOP_MS) * SUSTAIN_HOP_MS;
      t < limit; t += SUSTAIN_HOP_MS) {
    const spectrum = at(t);
    const step = Math.max(2, Math.ceil(center * 0.04));
    let peak = 0, level = 0, best = 0;
    for (let k = Math.max(2, center - step); k <= Math.min(center + step, spectrum.length - 3); k++) {
      if (spectrum[k] <= spectrum[k - 1] || spectrum[k] < spectrum[k + 1]) continue;
      const power = nearPower(spectrum, k);
      const rank = power / (1 + 0.25 * Math.abs(k - center));
      if (rank > best) { peak = k; level = power; best = rank; }
    }
    if (level < minimum) {
      if (++missing < 3) continue;
      const estimatedEndTimeMs = t - 2.5 * SUSTAIN_HOP_MS;
      // Observe disappearance, then estimate the release between adjacent spectra.
      if (estimatedEndTimeMs - start < 235 || settled < launched * 0.34) return undefined;
      return { state: 'release', endTimeMs: estimatedEndTimeMs, continuity: 0.9 };
    }
    while (events[neighboringAttack]?.timeMs <= t + 20) {
      const attack = events[neighboringAttack++];
      if (attack.timeMs >= t - 40 && attack.band === event.band && attack.confidence >= 0.28 &&
          interruptsPartial(at, attack, center, minimum)) return { state: 'ambiguous' };
    }
    if (peak < origin * 0.77 - 1 || peak > origin * 1.30 + 1 ||
        t - start > 140 && level > Math.max(previous * 2.8, launched * 0.55) ||
        missing && level > launched * 0.55) return { state: 'ambiguous' };
    center = peak;
    previous = level;
    missing = 0;
    lastSeen = t;
    if (t - start <= 215) settled = Math.min(settled, level);
  }
  if (lastSeen - start >= 235 && settled >= launched * 0.34) {
    if (missing) return { state: 'ambiguous' };
    return { state: 'active', observedThroughMs: lastSeen, boundary: limit === durationMs ? 'audio-end' : 'tracking-limit' };
  }
  return undefined;
}

export function addSustainEvidence(samples, sampleRate, events, durationMs, progress, waveform) {
  if (!events.length && (!waveform || !waveform.energy.some(value => value > 0.001)))
    return waveform ? { additional:[], envelopes:[] } : [];
  const tonal = sustainSpectra(samples, sampleRate);
  const { at, binHz } = tonal;
  for (const [i, event] of events.entries()) {
    if (i % 64 === 0) progress(i / events.length * (waveform ? 0.65 : 1));
    const t = event.timeMs;
    if (waveform && event.strength >= 0.115 && t >= 45 && t + 65 <= durationMs) {
      const { voice, ...components } = pitchedArrival(t, tonal);
      if (voice) event.voice = voice;
      if (components.pitched >= 0.07) event.components = components;
    }
    // Look only at a detector timestamp surrounded by enough audio to
    // isolate its first tens of milliseconds from adjacent attacks.
    if (event.confidence >= 0.025 && event.confidence < 0.10 && event.strength >= 0.135 &&
        t >= 95 && t + 90 <= durationMs &&
        t - (events[i - 1]?.timeMs ?? -Infinity) >= 65 &&
        (events[i + 1]?.timeMs ?? Infinity) - t >= 75 &&
        tonalEntry(at, t, binHz)) event.tonalEntry = true;
    if (event.confidence < 0.18 || t + 240 > durationMs) continue;
    const onset = at(t + 45);
    const arrival = at(t + 15);
    const before = at(t - 45), earlier = at(t - 105);
    // Where the first quarter-second is already crowded, use the existing
    // fixed-band evidence; a moving source is too hard to isolate reliably.
    if ((events[i + 2]?.timeMs ?? Infinity) - t > 240) {
      const launch = sustainedPeak(onset, arrival, before, earlier, binHz);
      if (launch) {
        const tracked = trackSustain(at, events, i, launch, durationMs);
        if (tracked) event.trackedSustain = tracked;
      }
    }
    const middle = at(t + 135), body = at(t + 215);
    let best;
    for (let k = Math.max(4, Math.ceil(60 / binHz)); k < onset.length - 3; k++) {
      if (onset[k] < onset[k - 1] || onset[k] < onset[k + 1] ||
          onset[k] < 4 * Math.max(onset[k - 3], onset[k + 3])) continue;
      const initial = nearPower(onset, k);
      const background = Math.max(nearPower(before, k), nearPower(earlier, k));
      const settled = Math.min(nearPower(middle, k), nearPower(body, k));
      if (nearPower(arrival, k) < Math.max(MIN_POWER, initial * 0.3, background * 2.5)) continue;
      if (settled < Math.max(MIN_POWER, initial * 0.34, background * 3.5)) continue;
      const strength = settled / (settled + Math.max(MIN_POWER, background * 4));
      const rank = strength * Math.sqrt(settled);
      if (!best || rank > best.rank) best = { k, settled, background, strength, rank };
    }
    if (!best) continue;
    const { k, settled, background, strength } = best;
    const threshold = Math.max(MIN_POWER / 2, background * 1.8, settled * 0.19);
    const end = Math.min(durationMs, t + MAX_SUSTAIN_MS);
    let missing = 0, preceding = nearPower(onset, k), low = preceding;
    for (let cursor = Math.round((t + 65) / SUSTAIN_HOP_MS) * SUSTAIN_HOP_MS;
      cursor < end; cursor += SUSTAIN_HOP_MS) {
      const power = nearPower(at(cursor), k);
      // Reject a fading partial that grew again after a trough. With only
      // mix audio, such a restart is too ambiguous to chart as one hold.
      if (power > Math.max(low * 3.4, settled * 0.9) &&
          power > preceding * 1.8 && cursor - t >= 145) break;
      low = Math.min(preceding, power);
      preceding = power;
      if (power >= threshold) {
        missing = 0;
      } else if (++missing === 3) {
        const endTimeMs = cursor - 2.5 * SUSTAIN_HOP_MS;
        if (endTimeMs - t >= 235) event.tonalHoldEvidence = { endTimeMs, continuity: strength };
        break;
      }
    }
  }
  const additional = waveform ? findSpectralAttacks(
    sustainSpectra(samples, sampleRate, 20, 8, 7900), tonal, durationMs, events, waveform,
    fraction => progress(0.65 + fraction * 0.35)) : [];
  progress(1);
  return additional;
}
