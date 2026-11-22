// DSP agreement is an internal diagnostic. Independent timing error is supplied
// only by the benchmark when reference annotations exist.
export function assessV3(notes, timeline, profile) {
  const count = notes.length,
    events = timeline.events,
    nps = (count * 1000) / timeline.durationMs;
  const busy = [-Infinity, -Infinity, -Infinity, -Infinity],
    release = [-Infinity, -Infinity, -Infinity, -Infinity],
    lanes = [0, 0, 0, 0];
  const pairs = new Set(),
    covered = new Set(),
    motifHeads = new Map();
  let cursor = 0,
    left = 0,
    peakNps = 0,
    last = null,
    collisions = 0,
    releaseConflicts = 0,
    jacks = 0,
    handStrain = 0;
  let unsupported = 0,
    weak = 0,
    holds = 0,
    supportedHolds = 0,
    repeats = 0,
    consistent = 0,
    chords = 0;
  let coveredWeight = 0,
    strain = 0,
    quietHeads = 0,
    overDensity = 0,
    quietIndex = 0;
  const quietRanges = timeline.quietRanges || [];
  const phraseCounts = new Uint32Array(timeline.phrases.length);
  let phraseIndex = 0;
  for (let i = 0; i < count; i++) {
    const n = notes[i],
      t = n.timeMs;
    while (quietIndex < quietRanges.length && t >= quietRanges[quietIndex].endMs) quietIndex++;
    if (quietIndex < quietRanges.length && t >= quietRanges[quietIndex].startMs) quietHeads++;
    while (phraseIndex + 1 < timeline.phrases.length && t >= timeline.phrases[phraseIndex + 1].startMs)
      phraseIndex++;
    phraseCounts[phraseIndex]++;
    while (left < i && t - notes[left].timeMs >= 1000) left++;
    peakNps = Math.max(peakNps, i - left + 1);
    if (i - left + 1 > Math.ceil(1000 / profile.gap) + 1) overDensity++;
    if (t < busy[n.lane]) collisions++;
    if (t < release[n.lane] + 45) releaseConflicts++;
    busy[n.lane] = n.endTimeMs || t + 1;
    if (n.type === 'hold') release[n.lane] = n.endTimeMs;
    lanes[n.lane]++;
    if (last) {
      const dt = t - last.timeMs;
      if (dt === 0) chords++;
      else {
        pairs.add(last.lane * 4 + n.lane);
        if (n.lane === last.lane && dt < profile.laneGap * 1.5) jacks++;
        if (n.lane >> 1 === last.lane >> 1 && dt < profile.laneGap) handStrain++;
        strain += Math.min(2, profile.laneGap / Math.max(dt, 1)) * (last.lane === n.lane ? 1.6 : 1);
      }
    }
    if (n.type === 'hold') holds++;
    while (
      cursor + 1 < events.length &&
      Math.abs(events[cursor + 1].timeMs - t) <= Math.abs(events[cursor].timeMs - t)
    )
      cursor++;
    const e = events[cursor];
    if (!e || Math.abs(e.timeMs - t) > 35) unsupported++;
    else {
      if (e.confidence < 0.3) weak++;
      if (!covered.has(cursor)) {
        covered.add(cursor);
        coveredWeight += e.salience;
      }
      if (n.type === 'hold' &&
          (n.endTimeMs <= e.sustainEndMs + 35 ||
            Math.abs(n.endTimeMs - (e.tonalHoldEvidence?.endTimeMs ?? -Infinity)) <= 35 ||
            Math.abs(n.endTimeMs - (e.trackedSustain?.endTimeMs ?? -Infinity)) <= 35))
        supportedHolds++;
      if (!last || t !== last.timeMs) {
        const key = timeline.phrases[e.phraseId].motif * 16 + e.slot;
        const saved = motifHeads.get(key);
        if (saved && saved.phrase !== e.phraseId) {
          repeats++;
          if (saved.lane === n.lane) consistent++;
        }
        if (!saved) motifHeads.set(key, { phrase: e.phraseId, lane: n.lane });
      }
    }
    last = n;
  }
  const eventWeight = events.reduce((s, e) => s + e.salience, 0);
  const den = Math.max(1, count);
  const motifDensity = new Map();
  let densityError = 0,
    comparisons = 0;
  for (const p of timeline.phrases) {
    if (!p.eventCount) continue;
    const fraction = phraseCounts[p.id] / p.eventCount;
    const previous = motifDensity.get(p.motif);
    if (previous !== undefined) {
      densityError += Math.abs(fraction - previous);
      comparisons++;
    } else motifDensity.set(p.motif, fraction);
  }
  return {
    counts: { notes: count, holds, chords, collisions, releaseConflicts, peakNps, nps, quietHeads },
    estimates: {
      salienceCoverage: eventWeight ? coveredWeight / eventWeight : null,
      unsupportedRate: unsupported / den,
      weakRate: weak / den,
      overDensityRate: overDensity / den,
      repeatedPhraseDensityDeviation: comparisons ? densityError / comparisons : null,
      supportedHoldRate: holds ? supportedHolds / holds : null,
      rapidJacks: jacks,
      rapidSameHand: handStrain,
      handImbalance: Math.abs(lanes[0] + lanes[1] - lanes[2] - lanes[3]) / den,
      phraseAgreement: repeats ? consistent / repeats : null,
      transitionVariety: pairs.size,
      strainPerHead: strain / den
    }
  };
}

export function layoutUtility(report, intent) {
  const { estimates: e, counts: c } = report;
  if (c.collisions) return -Infinity;
  const accidentalJacks = Math.max(0, e.rapidJacks - (intent?.rapidJacks ?? 0));
  const recognizedFigures = (intent?.rapidJacks ?? 0) + (intent?.rollSteps ?? 0) / 4;
  return (
    0.20 * (e.phraseAgreement ?? 0.5) +
    0.2 * (1 - e.handImbalance) +
    0.25 * (1 - (accidentalJacks + e.rapidSameHand) / Math.max(1, c.notes)) +
    0.03 * Math.min(1, recognizedFigures / Math.max(1, c.notes * 0.06)) +
    (0.12 * Math.min(e.transitionVariety, 8)) / 8 +
    0.23 * (e.salienceCoverage ?? 0) -
    e.unsupportedRate
  );
}

// Measure actual finger presses across entire chord groups. Adjacent-note
// comparisons depend on the order in which chord keys were serialized.
export function measureV3Workload(notes, profile) {
  const lastFinger = Array(4).fill(-Infinity);
  const fingerWork = Array(4).fill(0);
  const loads = [];
  let cursor = 0, left = 0, heads = 0, fastFinger = 0, sharedHandEdges = 0, heldMs = 0;
  let priorTime = -Infinity, priorHands = 0;
  while (cursor < notes.length) {
    const time = notes[cursor].timeMs;
    let hands = 0;
    do {
      const note = notes[cursor++];
      const interval = time - lastFinger[note.lane];
      if (interval < profile.laneGap * 1.45) fastFinger++;
      fingerWork[note.lane] += 1 + (interval <= profile.laneGap * 2 ? 0.25 : 0);
      hands |= 1 << (note.lane >> 1);
      lastFinger[note.lane] = time;
      if (note.type === 'hold') heldMs += note.endTimeMs - time;
    } while (notes[cursor]?.timeMs === time);
    if (hands & priorHands && time - priorTime < 110) sharedHandEdges++;
    while (notes[left].timeMs < time - 2000) left++;
    if (time - notes[0].timeMs >= 2000) loads.push((cursor - left) / 2);
    heads++;
    priorHands = hands;
    priorTime = time;
  }
  loads.sort((a, b) => a - b);
  return { heads, fastFinger, sharedHandEdges, heldMs, fingerWork,
    upperTwoSecondRate: loads[Math.floor((loads.length - 1) * 0.9)] ?? 0 };
}

export function phraseLayoutUtility(report, intent, workload, durationMs) {
  if (report.counts.collisions || report.counts.releaseConflicts) return -Infinity;
  const heads = Math.max(1, workload.heads);
  const unintended = Math.max(0, workload.fastFinger - intent.rapidJacks);
  const fingers = (Math.max(...workload.fingerWork) - Math.min(...workload.fingerWork)) / heads;
  const figures = ((intent.trill ?? 0) + (intent.gallop ?? 0)) * 4 / heads;
  return layoutUtility(report, intent) + 0.25 * report.estimates.rapidSameHand / heads -
    0.22 * unintended / heads - 0.10 * fingers + 0.02 * Math.min(1, figures) +
    0.20 * Math.min(0.25, workload.heldMs / durationMs);
}

// Rate the finished physical layout independently of its requested difficulty.
// Two-second windows include silence, and a short burst has bounded influence.
export function rateV3Difficulty(notes, durationMs) {
  if (notes.length < 2) return .5;
  const seconds = Math.max(1,durationMs/1000);
  const buckets = new Uint16Array(Math.max(1,Math.ceil(seconds)));
  const fingers = Array(4).fill(-Infinity), tails = Array(4).fill(-Infinity);
  let heads = 0, fastEdges = 0, tightFingers = 0, hybrids = 0, rhythmChanges = 0, holds = 0;
  let last = -Infinity, previousGap = Infinity;
  for (const n of notes) {
    const t = n.timeMs, gap = t-last;
    if (gap) {
      heads++;
      if (gap <= 125) fastEdges++;
      if (gap <= 270 && previousGap <= 270 && Math.max(gap,previousGap)/Math.min(gap,previousGap) > 1.4)
        rhythmChanges++;
      if (tails.some(end => end > t)) hybrids++;
      previousGap = gap;
      last = t;
    }
    if (t-fingers[n.lane] <= 165) tightFingers++;
    fingers[n.lane] = t;
    if (n.type === 'hold') { tails[n.lane] = n.endTimeMs; holds++; }
    buckets[Math.min(buckets.length-1,Math.floor(t/1000))]++;
  }
  const local = Array.from(buckets,(count,i) => buckets.length === 1 ? count :
    (count + buckets[i ? i-1 : 1])/2).sort((a,b)=>a-b);
  const upper = local[Math.ceil(local.length*.90)-1];
  const room = Math.max(1,heads-1);
  const rating = .45 + .49*notes.length/seconds + .19*upper + .66*fastEdges/room +
    1.15*tightFingers/notes.length + .93*(notes.length-heads)/heads + .40*rhythmChanges/room +
    .52*hybrids/heads + .18*holds/heads;
  return Math.round(100*Math.min(10,Math.max(.5,rating)))/100;
}
