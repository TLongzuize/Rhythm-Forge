// Compare compressed spectral envelopes in approximate semitone bands. A
// neighboring band in the earlier frame can explain pitch drift without an onset.
export function spectralEnvelopeTracker(binHz, bins, frames) {
  const edges = [];
  for (let i = 0; i <= 90; i++) {
    const k = Math.round(55 * 2 ** (i / 12) / binHz);
    if (k > 0 && k < bins && k !== edges.at(-1)) edges.push(k);
  }
  const count = edges.length;
  const history = Array.from({ length:3 }, () => new Float32Array(count));
  const curve = new Float32Array(frames);
  const region = edges.map(k => [140, 320, 680, 1350, 2700, 4900].filter(hz => k * binHz >= hz).length);
  const powerBands = Array.from({ length:7 }, () => new Float32Array(frames));
  const register = edges.map(k => k*binHz < 250 ? 0 : k*binHz < 800 ? 1 : k*binHz < 2400 ? 2 : 3);
  const layers = Array.from({ length:4 }, () => new Float32Array(frames));
  function observe(i, power) {
    const now = history[i % 3], past = history[(i + 1) % 3];
    let sum = 0;
    for (let band = 0; band < count; band++) {
      let max = 0;
      const end = edges[band + 1] ?? bins;
      for (let k = edges[band]; k < end; k++) max = Math.max(max, power[k]);
      powerBands[region[band]][i] += max;
      now[band] = Math.log1p(800 * Math.sqrt(max));
      const rise = now[band] - Math.max(past[band], past[band - 1] ?? 0, past[band + 1] ?? 0);
      if (rise > 0 && i >= 2) {
        sum += rise;
        layers[register[band]][i] += rise;
      }
    }
    curve[i] = sum;
  }
  function peaks(hop) {
    // Quantized moving medians keep peak picking linear in recording length.
    const slow = movingMedian(curve, 48, 0.125);
    const scaled = curve.map((value, i) => value / (1 + slow[i]));
    const local = movingMedian(scaled, 14, 0.03125);
    const peaks = [];
    for (let i = 3; i < frames - 3; i++) {
      const height = scaled[i], floor = local[i] + 0.5;
      if (height < .76*floor || height < floor && height-Math.min(scaled[i-2],scaled[i+2]) < .22 ||
          height < scaled[i-1] || height <= scaled[i+1] ||
          height < scaled[i-2] || height <= scaled[i+2]) continue;
      const recent = peaks.at(-1);
      const strongest = Math.max(...layers.map(layer => layer[i]));
      const band = layers.findIndex(layer => layer[i] === strongest);
      const relative = height / floor;
      let first = i;
      while (first > i-3 && scaled[first-1] >= local[i] + 0.23*(height-local[i])) first--;
      // A flux maximum trails an abrupt step. Locate its leading edge in
      // measured frames, even on genuinely off-grid notes.
      const timeMs = (first === i ? i - 0.5 : first) * hop;
      const signature = [], tail = [], energy = [];
      for (const levels of powerBands) {
        const pre = (levels[Math.max(0,i-4)] + levels[Math.max(0,i-3)]) / 2;
        const attack = Math.max(levels[i], levels[i+1]);
        const after = (levels[Math.min(frames-1,i+4)] + levels[Math.min(frames-1,i+6)]) / 2;
        const gain = Math.max(0, Math.sqrt(attack) - Math.sqrt(pre));
        signature.push(gain);
        energy.push(Math.sqrt(attack));
        tail.push(Math.min(2, Math.sqrt(Math.max(0, after-pre)) / Math.max(.004, gain)));
      }
      const total = signature.reduce((a,b) => a+b,0);
      const energySum = energy.reduce((a,b) => a+b,0);
      const growth = total / Math.max(.006,energySum);
      // Log compression exposes faint sidebands. Check the uncompressed
      // spectrum before letting periodic vibrato corroborate itself.
      const audibleBands = energy.filter(level => level >= Math.max(.002,energySum*.08)).length;
      const acousticRise = growth >= .13 || growth >= .055 && audibleBands >= 3;
      const peak = { timeMs, peakMs:i*hop, height, relative, band, acousticRise,
        signature:signature.map(value => Math.round(100*value/Math.max(1e-8,total))), tail:tail.map(v => Math.round(100*v)),
        shape:layers.map(layer => Math.round(100 * layer[i] / curve[i])) };
      if (!recent || peak.timeMs - recent.timeMs >= 40) peaks.push(peak);
      else if (peak.height > recent.height) peaks[peaks.length - 1] = peak;
    }
    return peaks;
  }
  return { observe, peaks };
}

function movingMedian(values, radius, unit) {
  const histogram = new Uint16Array(512);
  const out = new Float32Array(values.length);
  const bin = i => Math.min(histogram.length - 1, Math.round(values[i] / unit));
  let lo = 0, hi = 0, at = 0, below = 0;
  for (let i = 0; i < values.length; i++) {
    while (hi < values.length && hi <= i + radius) {
      const b = bin(hi++);
      histogram[b]++;
      if (b < at) below++;
    }
    while (lo < i - radius) {
      const b = bin(lo++);
      histogram[b]--;
      if (b < at) below--;
    }
    const middle = (hi - lo) >> 1;
    while (below > middle) below -= histogram[--at];
    while (below + histogram[at] <= middle) below += histogram[at++];
    out[i] = at * unit;
  }
  return out;
}

// Look for two independently recurring attack shapes. Neighboring peaks with
// distinct registers must each explain part of the target. Different decays
// at the target guard against interpreting one broadband hit as a chord.
export function attributeLayers(peaks) {
  // Find two locally recurring, spectrally different exemplars whose
  // simultaneous arrival explains the measured target's attack AND decay.
  const views = peaks.map(({ signature, tail }) => {
    const dominant = signature.indexOf(Math.max(...signature));
    return { dominant, level:signature.map(x => x/100),
      body:signature.map((x,k) => x/100 * Math.min(1.5, tail[k]/100)) };
  });
  const overlap = (a,b) => a.reduce((sum,x,k) => sum + Math.min(x,b[k]),0);
  for (let i = 0; i < peaks.length; i++) {
    const target = peaks[i], view = views[i];
    if (target.relative < 1.25 || !target.recurrence && target.relative < 1.8) continue;
    const examples = [];
    for (let j = Math.max(0,i-55); j <= Math.min(peaks.length-1,i+55); j++) {
      const other = peaks[j], v = views[j], dt = Math.abs(other.timeMs-target.timeMs);
      if (dt < 65 || dt > 5200 || other.relative < 1.35 || !other.recurrence ||
          v.level[v.dominant] < .42 || view.level[v.dominant] < .135) continue;
      if (!examples.some(k => overlap(views[k].level,v.level) > .84)) examples.push(j);
      if (examples.length >= 16) break;
    }
    let best = .18;
    for (let a = 0; a < examples.length; a++) for (let b = a+1; b < examples.length; b++) {
      const u = views[examples[a]], v = views[examples[b]];
      if (Math.abs(u.dominant-v.dominant) < 2 || overlap(u.level,v.level) > .46 ||
          Math.abs(target.tail[u.dominant]-target.tail[v.dominant]) < 40) continue;
      let dot = 0, norm = 0;
      for (let k = 0; k < view.level.length; k++) {
        const delta = u.level[k]-v.level[k];
        dot += delta*(view.level[k]-v.level[k]);
        norm += delta*delta;
      }
      const fraction = dot/norm;
      if (fraction < .24 || fraction > .76) continue;
      let error = 0, bodyError = 0;
      for (let k = 0; k < view.level.length; k++) {
        error += Math.abs(view.level[k]-fraction*u.level[k]-(1-fraction)*v.level[k]);
        bodyError += Math.abs(view.body[k]-fraction*u.body[k]-(1-fraction)*v.body[k]);
      }
      const improvement = 2*(1-Math.max(overlap(u.level,view.level),overlap(v.level,view.level))) - error;
      if (error <= .49 && bodyError <= .68 && improvement > best) {
        best = improvement;
        target.layerPair = [u.dominant,v.dominant];
      }
    }
  }
}

// Test a repeated timbre at its measured peaks. Refine a proposed interval
// against several observations. A metrical position by itself supplies no cue.
export function recurringEnvelopes(peaks) {
  function similar(a, b) {
    let overlap = 0, envelope = 0;
    for (let k = 0; k < a.shape.length; k++) overlap += Math.min(a.shape[k], b.shape[k]);
    for (let k = 0; k < a.signature.length; k++) envelope += Math.min(a.signature[k], b.signature[k]);
    return overlap >= 67 && envelope >= 46;
  }
  function nearest(t) {
    let lo = 0, hi = peaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (peaks[mid].timeMs < t) lo = mid+1;
      else hi = mid;
    }
    return t-(peaks[lo-1]?.timeMs ?? -Infinity) < (peaks[lo]?.timeMs ?? Infinity)-t ? peaks[lo-1] : peaks[lo];
  }
  for (const [i, peak] of peaks.entries()) {
    // A wobbling partial can recur with excellent periodicity. Require a
    // change across registers or independent corroboration of a new pitch.
    if (peak.acousticRise === false || peak.shape.filter(x => x >= 13).length < 2 || peak.signature.every(x => x < 12)) continue;
    let best = 0;
    for (let j = Math.max(0,i-14); j < Math.min(peaks.length,i+15); j++) {
      const first = peaks[j], period = Math.abs(first.timeMs-peak.timeMs);
      if (period < 85 || period > 820 || !similar(peak,first)) continue;
      let support = 0, strong = 0, weight = 0, fit = 0;
      for (let cycle = -4; cycle <= 4; cycle++) {
        if (!cycle) continue;
        const predicted = peak.timeMs + cycle*period;
        const other = nearest(predicted);
        if (!other || Math.abs(other.timeMs-predicted) > Math.min(22, 9+3*Math.abs(cycle)) ||
            !similar(peak, other)) continue;
        support++;
        if (other.relative >= 1.25) strong++;
        weight += cycle*cycle;
        fit += cycle*(other.timeMs-peak.timeMs);
      }
      if (support < 4 || strong < (peak.relative < 1.15 ? 4 : 2) || support <= best) continue;
      best = support;
      peak.recurrence = { periodMs:Math.round(100*fit/weight)/100, supportingPeaks:support };
    }
  }
  // A phrase can keep its rhythm while the instrumentation changes. Transfer
  // the spacing only when several independent, timbrally verified repetitions
  // bracket a new measured spectral rise. Never synthesize a grid position.
  for (const [i, peak] of peaks.entries()) {
    if (peak.acousticRise === false || peak.recurrence || peak.relative < .90 || peak.shape.filter(x => x >= 12).length < 2) continue;
    const anchors = [];
    for (let j = Math.max(0,i-50); j <= Math.min(peaks.length-1,i+50); j++) {
      const a = peaks[j];
      if (a.recurrence && Math.abs(a.timeMs-peak.timeMs) <= 2500) anchors.push(a);
    }
    if (anchors.length < 5) continue;
    for (const anchor of anchors) {
      const full = anchor.recurrence.periodMs;
      for (const period of [full,full/2]) {
        if (period < 78 || period > 620) continue;
        let support = 0, interleaved = 0, early = false, late = false;
        for (const a of anchors) {
          const interval = a.timeMs-peak.timeMs, cycles = Math.round(interval/period);
          if (!cycles || Math.abs(interval-cycles*period) > Math.min(13,period*.09)) continue;
          // Count only observations backed by a compatible measured period.
          const ratio = a.recurrence.periodMs/period;
          if (Math.abs(ratio-Math.round(ratio)) > .07 || ratio < .9 || ratio > 8.1) continue;
          support++;
          if (Math.abs(cycles)%2) interleaved++;
          if (cycles < 0) early = true;
          if (cycles > 0) late = true;
        }
        if (support >= 5 && early && late && (period === full || interleaved >= 2 && support-interleaved >= 2)) {
          peak.phrasePeriodMs = period;
          break;
        }
      }
      if (peak.phrasePeriodMs) break;
    }
  }
}

// Attach corroboration to existing attacks first. A separate timestamp needs
// stronger evidence than a second observation of an already detected attack.
export function collectEnvelopeAttacks(events, spectral, peaks, rawTrace) {
  const candidates = [...events, ...spectral].sort((a,b) => a.timeMs-b.timeMs);
  const additions = [];
  let cursor = 0;
  for (const peak of peaks) {
    const trace = rawTrace && { detector:'envelope', sourceMs:peak.peakMs, refinedMs:peak.timeMs,
      relative:peak.relative, band:peak.band, decision:'insufficient-local-contrast' };
    if (trace) rawTrace.push(trace);
    if (peak.relative < 1.35 && !peak.recurrence && !peak.phrasePeriodMs) continue;
    while (cursor+1 < candidates.length &&
      Math.abs(candidates[cursor+1].timeMs-peak.timeMs) < Math.abs(candidates[cursor].timeMs-peak.timeMs)) cursor++;
    const closest = candidates[cursor], distance = Math.abs((closest?.timeMs ?? Infinity)-peak.timeMs);
    if (distance <= (peak.recurrence || peak.phrasePeriodMs ? 16 : 32)) {
      if (trace) Object.assign(trace, { decision:'merged', targetMs:closest.timeMs });
      if (!closest.envelope || peak.relative > closest.envelope.relative) closest.envelope = peak;
      continue;
    }
    if (trace) trace.decision = 'weak-or-uncorroborated-register';
    if (peak.acousticRise === false && !peak.pitched || (!peak.recurrence && !peak.phrasePeriodMs && (peak.relative < 1.75 || peak.band < 2 && !peak.pitched)) || peak.timeMs <= 0) continue;
    if (trace) Object.assign(trace, { decision:'candidate', targetMs:peak.timeMs });
    const confidence = Math.min(.75, .14 + .105 * peak.relative);
    additions.push({ timeMs:peak.timeMs, band:Math.min(2, Math.max(0, peak.band-1)), strength:confidence,
      confidence, bandSpread:0, envelopeOnly:true, envelope:peak, sustainEndMs:peak.timeMs });
  }
  return additions;
}
