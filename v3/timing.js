// Positive log-energy flux at two time scales. Frames are disjoint and filter
// state crosses frame boundaries. Frame indices always refer to source samples.
const BANDS = 3;
const FLOOR = 0.001;

// Relative rises in two bands corroborate multi-band attacks in compressed
// mixes. These are acoustic cues rather than a count of isolated instruments.
function coattackRise(energy, peak) {
  const from = Math.max(0, peak - 8), to = peak - 3;
  if (to <= from) return 0;
  let first = 0, second = 0;
  for (let band = 0; band < BANDS; band++) {
    let mean = 0;
    for (let f = from; f < to; f++) mean += energy[f * BANDS + band];
    mean /= to - from;
    const rise = (energy[peak * BANDS + band] - mean) / Math.max(0.016, mean);
    if (rise >= first) { second = first; first = rise; }
    else if (rise > second) second = rise;
  }
  return first >= 0.28 ? Math.min(2, second) : 0;
}

export function detectAttacks(samples, sampleRate, onProgress = () => {}, rawTrace) {
  if (
    !(samples instanceof Float32Array) ||
    !samples.length ||
    !Number.isFinite(sampleRate) ||
    sampleRate < 4000 ||
    sampleRate > 192000
  ) {
    throw Error('V3 needs nonempty PCM audio at 4–192 kHz.');
  }
  const hop = Math.max(1, Math.round(sampleRate * 0.005));
  const frameCount = Math.ceil(samples.length / hop);
  if (samples.length > 1800 * sampleRate) throw Error('V3 supports up to 30 minutes per song.');
  const energy = new Float32Array(frameCount * BANDS);
  // Peak followers suppress carrier-cycle ripple inside a sustained bass note.
  // Five frames retain enough history for both flux lags.
  const envelope = new Float64Array(5 * BANDS);
  const release = [0.97, 0.95, 0.9];
  const flux = new Float32Array(frameCount);
  const novelty = new Float32Array(frameCount);
  const lowGain = 1 - Math.exp((-2 * Math.PI * 180) / sampleRate);
  const midGain = 1 - Math.exp((-2 * Math.PI * 1800) / sampleRate);
  let low = 0,
    mid = 0,
    background = 0.12;
  for (let f = 0; f < frameCount; f++) {
    let a = 0,
      b = 0,
      c = 0;
    const start = f * hop,
      end = Math.min(samples.length, start + hop);
    for (let s = start; s < end; s++) {
      const x = samples[s];
      low += lowGain * (x - low);
      mid += midGain * (x - mid);
      a += low * low;
      b += (mid - low) ** 2;
      c += (x - mid) ** 2;
    }
    energy[3 * f] = Math.sqrt(a / (end - start));
    energy[3 * f + 1] = Math.sqrt(b / (end - start));
    energy[3 * f + 2] = Math.sqrt(c / (end - start));
    for (let k = 0; k < BANDS; k++) {
      const i = 3 * f + k,
        current = energy[i];
      const fast = f ? envelope[3 * ((f - 1) % 5) + k] : 0;
      const slow = f >= 4 ? envelope[3 * ((f - 4) % 5) + k] : 0;
      envelope[3 * (f % 5) + k] = Math.max(current, fast * release[k]);
      const change =
        Math.max(0, Math.log((FLOOR + current) / (FLOOR + fast))) * 0.65 +
        Math.max(0, Math.log((FLOOR + current) / (FLOOR + slow))) * 0.35;
      // Attenuate apparent large ratios around the noise floor.
      flux[f] += (change * current) / (0.012 + current);
    }
    novelty[f] = flux[f] - Math.max(0.28, background * 2.1);
    background += 0.025 * (Math.min(4, flux[f]) - background);
    if (f % 1024 === 0) onProgress(f / frameCount);
  }
  const events = [];
  for (let f = 0; f < frameCount; f++) {
    if (novelty[f] <= 0) continue;
    const next = Math.min(frameCount - 1, f + 4);
    let peak = f;
    for (let j = f + 1; j <= next; j++) if (flux[j] > flux[peak]) peak = j;
    const gains = Array.from({ length: BANDS }, (_, k) =>
      Math.max(0, energy[3 * peak + k] - (f ? energy[3 * (f - 1) + k] : 0))
    );
    const strongest = Math.max(...gains);
    const band = gains.indexOf(strongest);
    const secondary = Math.max(...gains.filter((_, i) => i !== band));
    const bandSpread = secondary / Math.max(FLOOR, strongest);
    const start = f * hop,
      end = Math.min(samples.length, (peak + 1) * hop);
    let prior = 0,
      maximum = 0;
    for (let s = Math.max(0, start - hop); s < start; s++) prior = Math.max(prior, Math.abs(samples[s]));
    for (let s = start; s < end; s++) maximum = Math.max(maximum, Math.abs(samples[s]));
    let attack = start;
    // Sub-frame refinement only when the waveform rises clearly out of its floor.
    if (maximum > 2 * prior) {
      const threshold = prior + 0.08 * (maximum - prior);
      while (attack + 1 < end && Math.abs(samples[attack]) < threshold) attack++;
    }
    const strength = 1 - Math.exp(-flux[peak] / 2);
    const confidence = 1 - Math.exp(-Math.max(0, novelty[peak]));
    events.push({
      timeMs: (attack * 1000) / sampleRate,
      band,
      bandSpread,
      coattack: coattackRise(energy, peak),
      strength,
      confidence,
      frame: peak
    });
    if (rawTrace) {
      const targetMs = attack * 1000 / sampleRate;
      rawTrace.push({ detector:'broad', sourceMs:f * hop * 1000 / sampleRate, peakMs:peak * hop * 1000 / sampleRate,
        targetMs, band, confidence, decision:'candidate' });
      for (let j = f + 1; j <= Math.min(peak + 6, frameCount - 1); j++) {
        if (j === peak || novelty[j] <= 0 || flux[j] <= flux[j-1] || flux[j] < (flux[j+1] ?? 0)) continue;
        rawTrace.push({ detector:'broad', sourceMs:j * hop * 1000 / sampleRate, targetMs,
          confidence:1 - Math.exp(-novelty[j]), decision:'same-attack-window' });
      }
    }
    f = peak + 6; // Separate perceptual attacks by at least 35 ms.
  }
  return {
    events,
    energy,
    hopMs: (hop * 1000) / sampleRate,
    durationMs: (samples.length * 1000) / sampleRate
  };
}

// Vote with local inter-onset intervals, folded to plausible quarter-note
// periods. Then rank aliases by circular phase concentration and accent weight.
function fitPulse(events, start, end, priorBpm) {
  const bins = new Float64Array(1001);
  let weight = 0;
  for (let i = start; i < end; i++) {
    const e = events[i];
    weight += e.strength;
    for (let j = Math.max(start, i - 6); j < i; j++) {
      const dt = e.timeMs - events[j].timeMs;
      if (dt < 65 || dt > 2800) continue;
      for (const beats of [0.5, 1, 2, 3, 4]) {
        const period = dt / beats;
        if (period < 285 || period > 1000) continue;
        const bin = Math.round(period);
        const vote = (e.strength * events[j].strength) / (Math.sqrt(i - j) * (beats === 1 ? 1 : 1.7));
        for (let k = -3; k <= 3; k++) if (bin + k <= 1000) bins[bin + k] += vote * (4 - Math.abs(k));
      }
    }
  }
  const peaks = [];
  for (let i = 285; i <= 1000; i++) {
    if (bins[i] && bins[i] >= bins[i - 1] && bins[i] > (bins[i + 1] || 0)) peaks.push(i);
  }
  peaks.sort((a, b) => bins[b] - bins[a]);
  const ranked = [];
  const origin = events[start]?.timeMs || 0;
  for (const p of peaks.slice(0, 12)) {
    let re = 0,
      im = 0;
    for (let i = start; i < end; i++) {
      const angle = ((events[i].timeMs - origin) * 2 * Math.PI) / p;
      re += Math.cos(angle) * events[i].strength;
      im += Math.sin(angle) * events[i].strength;
    }
    const concentration = Math.hypot(re, im) / weight;
    const phaseMs = origin + (Math.atan2(im, re) * p) / (2 * Math.PI);
    const continuity = Math.exp(-Math.abs(Math.log(60000 / p / priorBpm)));
    const score =
      (0.45 + 0.55 * concentration) * Math.sqrt(bins[p] / bins[peaks[0]]) * (0.8 + 0.2 * continuity);
    ranked.push({ bpm: 60000 / p, phaseMs, score, concentration });
  }
  ranked.sort((a, b) => b.score - a.score);
  const hypotheses = ranked.slice(0, 3).map((h) => refinePulse(h, events, start, end));
  const best = hypotheses[0];
  return {
    bpm: best?.bpm || priorBpm,
    phaseMs: best?.phaseMs ?? origin,
    confidence: best
      ? best.concentration *
        Math.min(1, (end - start) / 12) *
        (1 - (0.5 * (ranked[1]?.score || 0)) / best.score)
      : 0,
    hypotheses
  };
}

// Weighted linear fit to near-beat events recovers fractional periods beyond
// the 1 ms voting bins. The fit affects pulse interpretation only.
function refinePulse(hypothesis, events, start, end) {
  const period = 60000 / hypothesis.bpm;
  let weight = 0,
    x = 0,
    y = 0,
    xx = 0,
    xy = 0;
  for (let i = start; i < end; i++) {
    const relative = events[i].timeMs - hypothesis.phaseMs;
    const index = Math.round(relative / period);
    if (Math.abs(relative - index * period) > 28) continue;
    const w = events[i].strength;
    weight += w;
    x += w * index;
    y += w * relative;
    xx += w * index * index;
    xy += w * index * relative;
  }
  const variance = weight * xx - x * x;
  if (variance < 2) return hypothesis;
  const fitted = (weight * xy - x * y) / variance;
  if (Math.abs(fitted - period) > 2) return hypothesis;
  return { ...hypothesis, bpm: 60000 / fitted, phaseMs: hypothesis.phaseMs + (y - fitted * x) / weight };
}

export function trackTempo(events, durationMs) {
  const segments = [];
  let start = 0,
    prior = 120;
  for (let ms = 0; ms < durationMs; ms += 8000) {
    let end = start;
    while (end < events.length && events[end].timeMs < ms + 8000) end++;
    const fit = fitPulse(events, start, end, prior);
    segments.push({ startTime: ms, endTime: Math.min(durationMs, ms + 8000), ...fit });
    if (fit.confidence > 0.15) prior = fit.bpm;
    start = end;
  }
  const primary = segments.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
  return {
    version: 1,
    globalBpm: primary.bpm,
    firstBeatMs: segments[0].phaseMs,
    confidence: primary.confidence,
    segments
  };
}
