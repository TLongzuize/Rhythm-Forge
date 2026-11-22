import { MAX_TRACKED_SUSTAIN_MS } from './sustain.js';

// Profiles constrain both event selection and hand motion. Changing the
// search budget never relaxes these constraints.
export const V3_COMPOSITION_REVISION = 'difficulty-1';
export const V3_PHRASE_REVISION = 'phrase-1';
export const V3_SPECTRAL_REVISION = 'spectral-1';
const MAX_KEYS_PER_SECOND = 18;
const JACK_RECOVERY = { easy: Infinity, normal: 195, hard: 155, expert: 105 };

export const V3_PROFILES = {
  easy: { gap: 270, laneGap: 320, threshold: 0.38, pulse: 0.32, chord: 0, holds: 1, motifs: 2 },
  normal: { gap: 165, laneGap: 235, threshold: 0.3, pulse: 0.19, chord: 0.09, holds: 1, motifs: 4 },
  hard: { gap: 105, laneGap: 155, threshold: 0.23, pulse: 0.1, chord: 0.2, holds: 2, motifs: 6 },
  expert: { gap: 70, laneGap: 105, threshold: 0.16, pulse: 0.05, chord: 0.33, holds: 2, motifs: 8 }
};
const PERSONALITIES = {
  balanced: [1, 0, 0],
  beat: [1.15, 0.28, 0],
  melodic: [1, 0, 0.18],
  technical: [0.86, -0.04, 0],
  relax: [1.45, 0.2, 0.09]
};
const SHAPES = [
  [0, 2, 1, 3],
  [1, 3, 0, 2],
  [0, 1, 3, 2],
  [2, 0, 1, 3],
  [0, 1, 2, 3],
  [3, 2, 1, 0],
  [2, 1, 3, 0],
  [1, 2, 0, 3]
];
const CALIBRATION = {
  easy: { quantile: 0.52, floor: 0.19, activity: 2.4, gapScale: 0.91 },
  normal: { quantile: 0.37, floor: 0.16, activity: 2.8, gapScale: 0.91 },
  hard: { quantile: 0.23, floor: 0.15, activity: 4.5, gapScale: 1 },
  expert: { quantile: 0.18, floor: 0.12, activity: 5, gapScale: 1 }
};

// A compressed mix can carry clear local accents without reaching the
// absolute gate. Calibrate only with enough independently detected attacks.
function phraseCalibration(timeline, difficulty, profile, mode, confidence) {
  const policy = CALIBRATION[difficulty];
  const phrases = timeline.phrases;
  const salience = phrases.map(() => []);
  let pause = 0;
  const quiet = timeline.quietRanges ?? [];
  for (const e of timeline.events) {
    while (quiet[pause]?.endMs <= e.timeMs) pause++;
    if (e.confidence >= confidence && e.timeMs < (quiet[pause]?.startMs ?? Infinity))
      salience[e.phraseId].push(e.salience);
  }
  return salience.map((values, i) => {
    const from = phrases[i].startMs;
    const duration = (phrases[i + 1]?.startMs ?? timeline.durationMs) - from;
    const active = values.length >= 7 && duration >= 500 && values.length * 1000 >= duration * policy.activity;
    values.sort((a,b) => a - b);
    const median = values[Math.floor(values.length / 2)] ?? 0;
    if (!active) return { threshold: profile.threshold, gapScale: 1, median, active };
    const q = policy.quantile + (mode === 'relax' || mode === 'beat' ? 0.12 : 0);
    const threshold = Math.min(profile.threshold, Math.max(policy.floor, values[Math.floor((values.length - 1) * q)]));
    return { threshold, gapScale: mode === 'relax' ? 1 : policy.gapScale, median, active };
  });
}

function repeatedFigure(previous, current, next, recovery, difficulty) {
  if (!previous || !next || previous.band !== current.band || current.band !== next.band ||
      Math.min(previous.confidence, current.confidence, next.confidence) < 0.16) return false;
  const a = current.timeMs - previous.timeMs, b = next.timeMs - current.timeMs;
  if (a < recovery || a > (difficulty === 'normal' ? 235 : difficulty === 'hard' ? 230 : 195) ||
      Math.abs(a - b) > Math.max(9, a * 0.10)) return false;
  const strength = Math.min(previous.strength, current.strength, next.strength);
  return strength >= 0.14 && strength >= Math.max(previous.strength, current.strength, next.strength) * 0.60;
}

function rollingFigure(first, following, recovery) {
  const run = [first];
  while (run.length < 4 && following.get(run.at(-1))) run.push(following.get(run.at(-1)));
  if (run.length !== 4 || run.some(e => e.confidence < 0.22)) return null;
  const gaps = run.slice(1).map((e, i) => e.timeMs - run[i].timeMs);
  if (Math.min(...gaps) < recovery || Math.max(...gaps) > 230 ||
      Math.max(...gaps) - Math.min(...gaps) > Math.max(14, gaps[0] * 0.12)) return null;
  const change = run.at(-1).band - first.band;
  const directed = change && run.slice(1).every((e, i) => (e.band - run[i].band) * change >= 0);
  const builds = run.at(-1).salience > first.salience * 1.18 && run.at(-1).salience >= run[1].salience &&
    run.at(-1).salience >= run[2].salience;
  return directed || builds && new Set(run.map(e => e.band)).size > 1 ? run : null;
}

function mix(value) {
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

// Measure repeatable intervals on the detected attacks, before the rank gate.
// Nearby interval evidence crosses phrase boundaries and does not require beat phase.
export function technicalRhythm(events, minConfidence) {
  const intervals = events.map((event, i) => i ? event.timeMs - events[i - 1].timeMs : Infinity);
  let left = 0, right = 0, reliable = 0, strength = 0;
  const floor = Math.max(0.1, minConfidence);
  return events.map((event, i) => {
    while (right < events.length && events[right].timeMs <= event.timeMs + 900) {
      if (events[right].confidence >= floor) { reliable++; strength += events[right].strength; }
      right++;
    }
    while (events[left].timeMs < event.timeMs - 900) {
      if (events[left].confidence >= floor) { reliable--; strength -= events[left].strength; }
      left++;
    }
    // A dense background alone is insufficient. Require multiple matching gaps,
    // including a matching gap incident to this head, and retain the confidence floor.
    if (right - left < 15 || reliable < 8 || event.confidence < floor) return 0;
    const meanStrength = strength / reliable;
    if (event.strength < Math.max(0.12, meanStrength * 0.68)) return 0;
    let support = 0;
    for (const gap of [intervals[i], intervals[i + 1]]) {
      if (!(gap >= 45 && gap <= 155)) continue;
      const tolerance = Math.max(6, 0.09 * gap);
      let matches = 0;
      for (let j = left + 1; j < right; j++) {
        if (j === i || j === i + 1) continue;
        if (Math.max(events[j - 1].confidence, events[j].confidence) < floor) continue;
        if (Math.abs(intervals[j] - gap) <= tolerance) matches++;
      }
      if (matches < 3) continue;
      // Divisions of the local pulse corroborate interval evidence. Recurrence
      // supplies independent support when tempo is aliased or phase is uncertain.
      const division = event.period / gap;
      const subdivided = [2, 3, 4, 6, 8, 12, 16].some(n => Math.abs(division - n) < n * 0.08);
      support = Math.max(support, Math.min(1, (matches + Number(subdivided)) / 6));
    }
    const prominence = Math.min(1, event.strength / Math.max(0.15, meanStrength));
    return support * prominence;
  });
}

// Compare complete compatible event sequences within a phrase. A strong isolated
// attack can outweigh a pair of weak neighbours. Repeated close intervals supply
// evidence for a subdivision even when the pulse tracker favours a tempo alias.
function selectTechnicalPhrase(group, spacing, previousTime, difficulty, threshold) {
  const best = [0], parent = [], take = [];
  for (let i = 0; i < group.length; i++) {
    const { e, rank, rhythm } = group[i];
    const dt = e.timeMs - (group[i - 1]?.e.timeMs ?? previousTime);
    const neighbours = [
      (group[i + 1]?.e.timeMs ?? Infinity) - e.timeMs,
      i > 1 ? group[i - 1].e.timeMs - group[i - 2].e.timeMs : Infinity
    ];
    const recurring = Number.isFinite(dt) && neighbours.some(interval => Math.abs(interval - dt) <= Math.max(7, dt * 0.18));
    const steps = e.period / dt;
    const subdivision = [2, 3, 4, 6, 8].some(n => Math.abs(steps - n) <= n * 0.09);
    const supported = rhythm > 0 || recurring || (subdivision && e.confidence >= 0.28);
    const gap = supported ? Math.max(difficulty === 'hard' ? 76 : 50, spacing * 0.7) : spacing;
    let lo = 0, hi = i;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (e.timeMs - group[mid].e.timeMs >= gap) lo = mid + 1;
      else hi = mid;
    }
    parent[i] = lo;
    const eligible = rank >= threshold * (supported ? 0.72 : 1) && e.timeMs - previousTime >= gap;
    const value = eligible ? best[lo] + rank * rank + (supported ? 0.04 : 0) : -Infinity;
    take[i] = value > best[i];
    best.push(take[i] ? value : best[i]);
  }
  const selected = [];
  for (let i = group.length - 1; i >= 0;) {
    if (take[i]) { selected.push(group[i].e); i = parent[i] - 1; }
    else i--;
  }
  return selected.reverse();
}

// Use evidence for a transition between actual selected heads. Recognition is
// local and doesn't need the same global beat phase on either side of a seam.
function planTechnicalHeads(groups, timeline, profile, gap, difficulty, calibration, eventTrace) {
  const events = groups.flat();
  const times = events.map(({ e }) => Math.round(e.timeMs));
  const quiet = timeline.quietRanges ?? [];
  let pause = 0;
  const regions = times.map(time => {
    while (quiet[pause]?.endMs <= time) pause++;
    return pause;
  });
  const ordinary = events.map(({ e }) =>
    gap * (timeline.sections[timeline.phrases[e.phraseId].sectionId].texture === 'thinning' ? 1.1 : 1));
  const minimum = difficulty === 'hard' ? 76 : 50;
  const close = (a, b) => Math.abs(a - b) <= Math.max(9, a * 0.10);
  const corroborated = (i, j, interval) => {
    if (regions[i] !== regions[j]) return false;
    for (let k = 1; k <= 2; k++) {
      if (regions[i - k] === regions[i] && close(interval, times[i] - times[i - k]) ||
          regions[j + k] === regions[j] && close(interval, times[j + k] - times[j]))
        return true;
    }
    const { e, rhythm, arrival } = events[j];
    const ratio = e.period / interval;
    return arrival >= 0.16 && events[i].arrival >= 0.16 ||
      rhythm >= 0.35 && events[i].rhythm >= 0.35 ||
      e.confidence >= 0.28 && [2, 3, 4, 6, 8].some(n => Math.abs(ratio - n) <= n * 0.06);
  };
  const best = new Float64Array(events.length);
  const previous = new Int32Array(events.length).fill(-1);
  const prefix = new Int32Array(events.length);
  let left = 0;
  // Outside this horizon the normal spacing always applies and there is no
  // sequence reward, so only the previous best path needs consideration.
  const horizon = Math.max(235, 1.1 * gap);
  for (const [i, { rank, rhythm, arrival }] of events.entries()) {
    const t = times[i], spacing = ordinary[i];
    while (left < i && t - times[left] > horizon) left++;
    const short = Math.max(minimum, spacing * 0.7);
    const local = [i - 2, i - 1, i + 1, i + 2].some(j => {
      const distance = Math.abs(times[j] - t);
      return distance >= short && distance <= 235 &&
        (j < i ? corroborated(j, i, distance) : corroborated(i, j, distance));
    });
    const threshold = calibration?.[events[i].e.phraseId].threshold ?? profile.threshold;
    const eligible = rank >= threshold || local || rhythm >= 0.35 || arrival >= 0.22;
    let score = eligible ? 0 : -Infinity;
    if (eligible && left) {
      previous[i] = prefix[left - 1];
      score = Math.max(0, best[previous[i]]);
    }
    for (let j = left; j < i; j++) {
      const interval = t - times[j];
      if (interval < short || !Number.isFinite(best[j])) continue;
      const follows = interval <= 235 && corroborated(j, i, interval);
      if (interval < spacing && !follows || !eligible && !follows) continue;
      const path = best[j] + (follows ? 0.025 + (arrival !== undefined ? 0.01 : 0) : 0);
      if (path <= score) continue;
      score = path;
      previous[i] = j;
    }
    best[i] = score + rank * rank;
    prefix[i] = i === 0 || best[i] > best[prefix[i - 1]] ? i : prefix[i - 1];
  }
  const chosen = [];
  for (let i = prefix.at(-1); i >= 0 && Number.isFinite(best[i]); i = previous[i])
    chosen.push(events[i].e);
  chosen.reverse();
  if (eventTrace && chosen.length) {
    const accepted = new Set(chosen);
    let closest = 0;
    for (const [i, {e}] of events.entries()) {
      if (accepted.has(e)) continue;
      while (closest+1 < chosen.length && Math.abs(chosen[closest+1].timeMs-e.timeMs) <
          Math.abs(chosen[closest].timeMs-e.timeMs)) closest++;
      const distance = Math.abs(chosen[closest].timeMs-e.timeMs);
      eventTrace.get(e).decision = distance < Math.max(minimum, ordinary[i]*0.7) ? 'minimum-spacing' :
        Number.isFinite(best[i]) ? 'competing-phrase-path' : 'unsupported-phrase-transition';
    }
  }
  return chosen;
}

// A compound arrival can stand on its own. Otherwise an attack needs
// prominence relative to the surrounding sounds and an audible neighbor.
// Local comparison works inside compressed passages and through tempo aliases.
function phraseAccents(groups, difficulty, minConfidence, spectralPlan) {
  const attacks = groups.flat();
  const accents = new Map();
  for (const [i, { e, tonalTexture }] of attacks.entries()) {
    const { pitched = 0, impact = 0 } = e.components ?? {};
    const voice = spectralPlan && (e.voice ?? e.envelope?.voice);
    const transientWithPitch = voice && voice.hz < 1800 && (e.components?.impact ?? 0) >= 0.08 &&
      e.envelope?.recurrence && e.envelope.shape[3] >= 28;
    const tonalDyad = voice?.dyad || tonalTexture && e.components?.independentPitch;
    const layered = spectralPlan && !!(e.envelope?.layerPair || tonalDyad || transientWithPitch);
    if (tonalTexture && !layered) continue;
    if (e.confidence < minConfidence && !(layered && minConfidence === 0.1)) continue;
    const compound = layered || pitched >= 0.095 && impact >= 0.055;
    const nearby = [];
    let matching = 0;
    for (let j = Math.max(0, i - 12); j <= Math.min(i + 12, attacks.length - 1); j++) {
      if (j === i) continue;
      const other = attacks[j].e;
      const gap = Math.abs(other.timeMs - e.timeMs);
      if (gap > Math.min(920, e.period * 1.65)) continue;
      nearby.push(other.salience);
      if (other.band === e.band && other.confidence >= minConfidence &&
          [0.5, 1, 1.5, 2].some(multiplier => Math.abs(e.period * multiplier - gap) <= 25))
        matching++;
    }
    if (!layered && nearby.length < (difficulty === 'normal' ? 5 : 4)) continue;
    nearby.sort((a, b) => a - b);
    const prominence = e.salience / Math.max(0.12, nearby[nearby.length >> 1] ?? e.salience);
    const contrasting = (e.coattack >= 0.15 && e.bandSpread >= 0.32) || impact >= 0.095 || pitched >= 0.18;
    const strong = e.salience >= (difficulty === 'normal' ? 0.26 : 0.15) &&
      prominence >= (difficulty === 'normal' ? 1.38 : difficulty === 'hard' ? 1.26 : 1.18);
    const impactPattern = nearby.length >= 7 && prominence >= 1.08 && e.salience >= 0.14 &&
      (e.coattack >= 0.15 && e.bandSpread >= 0.36 || impact >= 0.075);
    if (compound || strong && (contrasting || matching >= 2 || e.confidence >= 0.42) || impactPattern)
      accents.set(e, { compound, layered, prominence, impactPattern, stable: compound ||
        strong && (contrasting || matching >= 2 || e.confidence >= 0.42) });
  }
  if (difficulty === 'expert' || difficulty === 'hard') {
    const wave = [...accents].filter(([, accent]) => accent.impactPattern);
    for (const [i, [event, accent]] of wave.entries()) {
      const left = wave[i - 1]?.[0], right = wave[i + 1]?.[0];
      if (!left || !right) continue;
      const before = event.timeMs - left.timeMs, after = right.timeMs - event.timeMs;
      if (before < 135 || before > 370 || Math.abs(before - after) > Math.max(14, before * 0.11)) continue;
      if (left.band !== event.band && right.band !== event.band) continue;
      accent.inSeries = true;
      wave[i - 1][1].inSeries = wave[i + 1][1].inSeries = true;
    }
  }
  for (const [event, accent] of accents) if (!accent.stable && !accent.inSeries) accents.delete(event);
  return accents;
}

// Reserve enough distinct recovering fingers to play the next heads. Within
// one recovery interval they cannot reuse a finger occupied by this chord.
function leavesRoomForFigure(available, lane, next, following, time, recovery, figureLanes) {
  const ready = available.slice();
  ready[lane] = time + recovery;
  for (let event = next; event && Math.round(event.timeMs) < time + recovery; event = following.get(event)) {
    const t = Math.round(event.timeMs);
    const reserved = figureLanes.get(event)?.lane;
    // Consume a finger that is not reserved for a later head in the same window.
    let finger = reserved;
    if (finger === undefined) {
      const later = new Set();
      for (let e = following.get(event); e && Math.round(e.timeMs) < t + recovery; e = following.get(e))
        later.add(figureLanes.get(e)?.lane);
      finger = ready.findIndex((when, i) => when <= t && !later.has(i));
    }
    if (finger < 0 || ready[finger] > t) return false;
    ready[finger] = t + recovery;
  }
  return true;
}

function phraseFingering(first, following, recovery, difficulty, mirror, spectralPlan) {
  const attacks = [first];
  while (attacks.length < 4 && following.get(attacks.at(-1))) attacks.push(following.get(attacks.at(-1)));
  if (attacks.length < 4 || attacks.some(e => e.confidence < 0.16 &&
      !(spectralPlan && (e.envelope?.recurrence || e.envelope?.phrasePeriodMs)))) return null;
  const gaps = attacks.slice(1).map((e, i) => Math.round(e.timeMs) - Math.round(attacks[i].timeMs));
  const [a, b, c] = gaps, similar = Math.abs(a - c) <= Math.max(10, 0.11 * a);
  let fingers, family;
  // Follow repeatable acoustic registers inside a phrase even when every
  // attack's strongest RMS band is identical. The two occurrences of A
  // share a finger only when both its entrance and return can recover.
  const spectra = spectralPlan && attacks.map(e => e.envelope);
  if (spectra && spectra.every(e => e?.signature) && spectra.some(e => e.recurrence) &&
      Math.max(...gaps) <= 245 && Math.min(...gaps) >= 50 && Math.abs(a-c) <= Math.max(14,.14*a)) {
    const likeness = (i,j) => spectra[i].signature.reduce((sum,x,k) =>
      sum+Math.min(x,spectra[j].signature[k]),0);
    const recurringA = likeness(0,2) >= 76;
    if (recurringA && likeness(0,1) < 58 && a+b >= recovery*1.15 && b+c >= recovery*1.15) {
      const recurringB = likeness(1,3) >= 76 && likeness(0,3) < 58;
      fingers = recurringB ? [0,2,0,2] : [0,2,0,3];
      family = recurringB ? 'trill' : 'anchor';
    } else if (difficulty === 'expert' && a >= recovery*1.12 && b >= recovery*1.12 &&
        Math.max(a,b) < 210 && likeness(0,1) >= 82 && likeness(1,2) >= 82 &&
        likeness(2,3) < 58 && spectra.slice(0,3).every(e => e.recurrence)) {
      fingers = [1,1,1,3];
      family = 'jack';
    }
  }
  if (!fingers && similar && Math.min(a, c) >= recovery * 0.65 && Math.max(a, c) <= recovery * 1.12 &&
      b >= Math.max(a, c) * 1.6 && b <= 300) {
    fingers = [0, 2, 3, 1];
    family = 'gallop';
  } else if (!fingers && similar && Math.max(...gaps) - Math.min(...gaps) <= a * 0.15 &&
      Math.min(a, c) * 2 >= recovery * 1.22 && Math.max(...gaps) <= 205 &&
      attacks[0].band === attacks[2].band && attacks[1].band === attacks[3].band &&
      attacks[0].band !== attacks[1].band) {
    fingers = difficulty === 'expert' && Math.min(...gaps) >= recovery * 1.20 ? [0, 1, 0, 1] : [0, 2, 0, 2];
    family = 'trill';
  } else if (!fingers && rollingFigure(first, following, recovery * 0.7)) {
    fingers = [0, 1, 2, 3];
    family = 'roll';
  }
  return fingers ? { attacks, fingers: mirror ? fingers.map(lane => 3 - lane) : fingers, family } : null;
}

function limitHeadRuns(heads) {
  const kept = [];
  let left = 0;
  for (const head of heads) {
    const time = Math.round(head.timeMs);
    while (left < kept.length && time - Math.round(kept[left].timeMs) > 1000) left++;
    if (kept.length - left >= MAX_KEYS_PER_SECOND) {
      let weakest = kept.length;
      let rank = head.salience;
      for (let i = left; i < kept.length; i++) {
        if (kept[i].salience >= rank) continue;
        rank = kept[i].salience;
        weakest = i;
      }
      if (weakest === kept.length) continue;
      kept.splice(weakest, 1);
    }
    kept.push(head);
  }
  return kept;
}

function availableChordKeys(notes, following, next, time) {
  let left = notes.length - 1;
  while (left >= 0 && notes[left].timeMs >= time - 1000) left--;
  let count = notes.length - left - 1, peak = count;
  for (let event = next; event && Math.round(event.timeMs) <= time + 1000; event = following.get(event)) {
    const at = Math.round(event.timeMs);
    while (notes[left + 1]?.timeMs < at - 1000) { left++; count--; }
    peak = Math.max(peak, ++count);
  }
  return MAX_KEYS_PER_SECOND - peak;
}

// The same fixed salience gate can accent nearly every phrase in a clean mix
// and miss clear local peaks in a dense mix. Require broadband evidence plus
// contrast with the nearby attacks for an accent below the fixed gate.
function localChordAccents(events, minConfidence) {
  const accents = new Set();
  for (const [i, event] of events.entries()) {
    if (event.salience < 0.26 || event.salience >= 0.39 || event.bandSpread < 0.45 ||
        event.confidence < Math.max(0.28, minConfidence)) continue;
    const nearby = [];
    for (let j = Math.max(0, i - 8); j <= Math.min(events.length - 1, i + 8); j++) {
      const other = events[j];
      if (j !== i && Math.abs(other.timeMs - event.timeMs) <= 650 && other.confidence >= minConfidence)
        nearby.push(other.salience);
    }
    if (nearby.length < 5) continue;
    nearby.sort((a, b) => a - b);
    if (event.salience >= nearby[Math.floor(nearby.length / 2)] * 1.4) accents.add(event);
  }
  return accents;
}

export function prepareV3Composition(
  timeline,
  { difficulty = 'normal', mode = 'balanced', densityScale = 1, minConfidence = 0.1,
    compositionRevision, eventTrace } = {},
  rhythmEvidence
) {
  const p = V3_PROFILES[difficulty],
    personality = PERSONALITIES[mode];
  if (!p || !personality) throw Error('Unknown V3 difficulty or mode.');
  const gap = (p.gap * personality[0]) / Math.max(0.55, Math.min(1.45, densityScale));
  const technical = difficulty === 'hard' || difficulty === 'expert';
  const spectralPlan = compositionRevision === V3_SPECTRAL_REVISION;
  const phrasePlan = (spectralPlan || compositionRevision === V3_PHRASE_REVISION) && mode !== 'relax' && mode !== 'beat';
  const calibrated = phrasePlan || compositionRevision === V3_COMPOSITION_REVISION;
  const trackSustain = calibrated || compositionRevision === 'articulation-3';
  const sustainLanes = trackSustain || compositionRevision === 'articulation-2';
  const revised = sustainLanes || compositionRevision === 'articulation-1';
  const localAccents = revised && technical && (mode === 'balanced' || mode === 'technical')
    ? localChordAccents(timeline.events, minConfidence) : null;
  const groups = timeline.phrases.map(() => []);
  const textures = spectralPlan && timeline.envelopes ? timeline.phrases.map(() =>
    ({ witnesses:0, tonal:0, impacts:0, observed:0 })) : null;
  if (textures) for (const e of timeline.events) {
    const texture = textures[e.phraseId];
    texture.observed++;
    if (e.envelope?.relative >= 1.55) {
      texture.witnesses++;
      if (e.voice || e.components?.pitched >= .10) texture.tonal++;
      if (e.components?.impact >= .075) texture.impacts++;
    }
  }
  if (textures) for (const texture of textures)
    texture.tonalTexture = texture.tonal >= 3 && texture.tonal >= texture.witnesses*.48 &&
      texture.impacts <= .22*texture.witnesses;
  const calibration = calibrated ? phraseCalibration(timeline, difficulty, p, mode, minConfidence) : null;
  const evidence = technical ? rhythmEvidence ?? technicalRhythm(timeline.events, minConfidence) : null;
  const quiet = timeline.quietRanges ?? [];
  let quietIndex = 0;
  for (const [index, e] of timeline.events.entries()) {
    const trace = eventTrace?.get(e);
    if (revised) {
      const time = Math.round(e.timeMs);
      while (quiet[quietIndex]?.endMs <= time) quietIndex++;
      if (quiet[quietIndex]?.startMs <= time) {
        if (trace) trace.decision = 'quiet-region';
        continue;
      }
    }
    const sustain = Math.min(1, (e.sustainEndMs - e.timeMs) / e.period);
    const rank = e.salience + (personality[1] + p.pulse) * e.pulse + personality[2] * sustain;
    const rhythm = evidence?.[index] || 0;
    // Beat Focus and Relax retain their emphasis on fewer, prominent attacks.
    const pitched = e.components?.pitched ?? 0, impact = e.components?.impact ?? 0;
    const arrival = phrasePlan ? Math.max(pitched, impact, e.spectralRise ?? 0) : undefined;
    const articulation = technical ? Math.min(0.048, Math.max(pitched, impact) * 0.14) : Math.min(0.065, (arrival ?? 0) * 0.17);
    const envelope = spectralPlan && e.envelope;
    const recurrence = envelope?.recurrence || envelope?.phrasePeriodMs;
    const envelopeSupport = recurrence || envelope && envelope.relative >= 1.65 &&
      (envelope.band >= 2 || envelope.pitched || e.confidence >= 0.14);
    const selectionRank = (envelopeSupport ? Math.max(rank, Math.min(0.67, 0.17 * envelope.relative + (recurrence ? 0.18 : 0))) : rank) + rhythm * (mode === 'relax' || mode === 'beat' ? 0.045 : 0.105) +
      (phrasePlan ? articulation : 0) +
      (phrasePlan && mode === 'melodic' ? Math.min(0.14, pitched * 0.21) : 0);
    const threshold = calibration?.[e.phraseId].threshold ?? p.threshold;
    const texture = textures?.[e.phraseId];
    const tonalTexture = texture?.tonalTexture;
    // Suppress isolated RMS ripples where the surrounding recording gives
    // consistent spectral landmarks. Protect independently measured sustains.
    if (texture?.witnesses >= 4 && !e.envelope && !e.spectralOnly &&
        e.confidence < (tonalTexture ? .45 : .28) && !e.trackedSustain && !e.tonalHoldEvidence &&
        (e.components?.impact ?? 0) < .075 && (e.components?.pitched ?? 0) < .12) {
      if (trace) Object.assign(trace,{rank:selectionRank,threshold,rhythm,arrival,decision:'uncorroborated-envelope'});
      continue;
    }
    const weakArrival = phrasePlan && technical && minConfidence === 0.1 && arrival >= 0.23 &&
      e.confidence >= 0.065 && e.strength >= 0.145 &&
      (Math.max(e.components?.pitched ?? 0, e.components?.impact ?? 0) >= 0.18 || rhythm >= 0.35);
    // Require a distinct pitched launch, a diffuse bright transient, or a
    // strong masked contrast on a supported subdivision. Coarse RMS alone
    // can describe the body of the earlier note.
    if (trace) Object.assign(trace, { rank:selectionRank, threshold, rhythm, arrival });
    if (e.spectralOnly && !envelopeSupport && !e.components?.clearPitch &&
        !(e.band > 0 && e.subdivisionError <= 15 && (impact >= 0.06 || !e.corroboratedLaunch))) {
      if (trace) trace.decision = 'unconfirmed-spectral-attack';
      continue;
    }
    if (weakArrival || envelopeSupport && technical && minConfidence === 0.1 || selectionRank >= threshold * (technical ? 0.72 : 1) && e.confidence >= minConfidence) {
      groups[e.phraseId].push({ e, rank: selectionRank, accent: rank, rhythm, arrival, tonalTexture });
      if (trace) trace.decision = 'phrase-spacing-or-path';
    } else if (trace) trace.decision = e.confidence < minConfidence ? 'confidence' : 'rank';
  }
  const layeredAccents = phrasePlan && p.chord ? phraseAccents(groups, difficulty, minConfidence, spectralPlan) : null;
  let planned = revised && technical
    ? planTechnicalHeads(groups, timeline, p, gap, difficulty, calibration, eventTrace) : null;
  if (eventTrace && planned) for (const event of planned) eventTrace.get(event).decision = 'one-second-key-limit';
  if (phrasePlan && planned) planned = limitHeadRuns(planned);
  if (eventTrace && planned) for (const event of planned) eventTrace.get(event).decision = 'finger-recovery';
  const byPhrase = planned ? timeline.phrases.map(() => []) : null;
  const nextPlanned = planned ? new Map(planned.map((event, i) => [event, planned[i + 1]])) : null;
  if (planned) for (const event of planned) byPhrase[event.phraseId].push(event);
  return { p, gap, technical, phrasePlan, calibrated, trackSustain, sustainLanes, revised,
    localAccents, groups, calibration, layeredAccents, planned, byPhrase, nextPlanned, textures };
}

export function composeV3(
  timeline,
  options = {},
  variation = 0,
  rhythmEvidence,
  intent,
  prepared
) {
  const { difficulty = 'normal', seed = 1337, mode = 'balanced' } = options;
  const { p, gap, technical, phrasePlan, calibrated, trackSustain, sustainLanes, revised,
    localAccents, groups, calibration, layeredAccents, planned, byPhrase, nextPlanned, textures } =
    prepared ?? prepareV3Composition(timeline, options, rhythmEvidence);
  const selectedAttacks = revised ? new Map() : null;
  const optionalChordNotes = phrasePlan ? new Set() : null;
  const notes = [],
    available = [0, 0, 0, 0],
    lastPress = Array(4).fill(-Infinity),
    load = [0, 0, 0, 0],
    tails = [0, 0, 0, 0];
  let lastTime = -Infinity,
    lastHold = -Infinity,
    lastChord = -Infinity,
    lastJack = -Infinity,
    lastRoll = -Infinity,
    lastLane = -1;
  let previousEvent = null, previousLane = -1;
  let previousWasChord = false;
  let lastChordEvent, lastChordFingers;
  const figureLanes = new Map();
  for (const phrase of timeline.phrases) {
    const group = groups[phrase.id];
    // Rank within each phrase before enforcing spacing so a ghost note just
    // before a strong accent cannot displace that accent by arriving first.
    const section = timeline.sections[phrase.sectionId];
    const phrasePolicy = calibration?.[phrase.id];
    const spacing = gap * (phrasePolicy?.gapScale ?? 1) * (section.texture === 'thinning' ? 1.1 : 1);
    const selected = planned ? byPhrase[phrase.id] :
      technical ? selectTechnicalPhrase(group, spacing, lastTime, difficulty, p.threshold) : [];
    const accentPool = technical ? group.filter(x => x.accent >= p.threshold * 0.72) : group.slice();
    accentPool.sort((a, b) => b.accent - a.accent || a.e.timeMs - b.e.timeMs);
    const accentRank = accentPool[Math.max(0, Math.ceil(accentPool.length * p.chord) - 1)]?.accent ?? Infinity;
    const accents = new Set();
    for (const { e, accent, arrival } of accentPool) {
      // A local accent needs either a marked pulse or a broader-band attack.
      // Sparse and low-contrast phrases can remain entirely single notes.
      if (
        p.chord &&
        accent >= accentRank &&
        e.salience >= 0.39 &&
        (e.pulse > 0.27 || (difficulty !== 'normal' && e.bandSpread > 0.3))
      )
        accents.add(e);
      const readableGap = phrasePlan && !technical && phrasePolicy.active && arrival >= 0.14
        ? Math.max(difficulty === 'easy' ? 200 : 125, spacing * 0.84) : spacing;
      if (!technical && e.timeMs - lastTime >= readableGap && selected.every((x) => Math.abs(x.timeMs - e.timeMs) >= readableGap))
        selected.push(e);
    }
    selected.sort((a, b) => a.timeMs - b.timeMs);
    const nextOf = nextPlanned ?? new Map(selected.map((event, i) => [event, selected[i + 1]]));
    const key = mix(seed ^ phrase.motif ^ Math.imul(variation, 2654435761));
    const shape = SHAPES[key % p.motifs];
    for (let j = 0; j < selected.length; j++) {
      const e = selected[j],
        t = Math.round(e.timeMs);
      let preferred = shape[(j + (key >>> 8)) % 4] ^ ((key >>> 16) & 1);
      // Keep a two-hand trill for a quick repeated timbre. For a register
      // change, continue from the actual preceding lane, even across phrases.
      const delta = e.timeMs - lastTime;
      const next = nextPlanned ? nextPlanned.get(e) : selected[j + 1];
      const ahead = (next?.timeMs ?? Infinity) - e.timeMs;
      const sustained = e.trackedSustain?.state === 'release' ||
        Math.max(e.holdEvidence?.endTimeMs ?? t, e.tonalHoldEvidence?.endTimeMs ?? t) - t >= e.period * 0.65;
      const localAccent = phrasePolicy?.active && p.chord && !sustained && mode !== 'beat' && mode !== 'relax' &&
        e.bandSpread >= (technical ? 0.38 : 0.46) &&
        e.confidence >= (technical ? 0.20 : 0.22) &&
        e.salience >= Math.max(0.21, phrasePolicy.median * (technical ? 1.20 : 1.37));
      const jackRecovery = JACK_RECOVERY[difficulty];
      if (phrasePlan && technical && t >= lastRoll + e.period &&
          !sustained) {
        const figure = phraseFingering(e, nextPlanned, p.laneGap, difficulty, key & 1, options.compositionRevision === V3_SPECTRAL_REVISION);
        if (figure) {
          const order = [figure.fingers, figure.fingers.map(finger => 3 - finger)].find(fingers =>
            figure.attacks.every((attack, i) => Math.round(attack.timeMs) >= available[fingers[i]]));
          if (order) {
            figure.attacks.forEach((attack, i) => figureLanes.set(attack, { lane: order[i], family: figure.family }));
            lastRoll = Math.round(figure.attacks.at(-1).timeMs);
            if (intent && figure.family !== 'roll') intent[figure.family] = (intent[figure.family] ?? 0) + 1;
          }
        }
      } else if (!phrasePlan && calibrated && technical && mode !== 'relax' && t >= lastRoll + e.period * 2) {
        const run = rollingFigure(e, nextPlanned, p.laneGap);
        if (run) {
          const order = key & 1 ? [0,1,2,3] : [3,2,1,0];
          if (run.every((attack, i) => Math.round(attack.timeMs) >= available[order[i]])) {
            run.forEach((attack, i) => figureLanes.set(attack, { lane: order[i], family: 'roll' }));
            lastRoll = Math.round(run.at(-1).timeMs);
          }
        }
      }
      const figure = figureLanes.get(e);
      const figureLane = figure?.lane;
      const jack = calibrated && difficulty !== 'easy' && mode !== 'relax' && mode !== 'beat' && !previousWasChord &&
        figureLane === undefined && !sustained && !localAccent && !accents.has(e) && !layeredAccents?.get(e)?.layered &&
        t - lastJack >= e.period * (difficulty === 'expert' ? 1.4 : 2) &&
        repeatedFigure(previousEvent, e, nextPlanned ? next : selected[j + 1], jackRecovery, difficulty);
      if (technical && previousEvent && delta < e.period * 0.85) {
        const direction = Math.sign(e.band - previousEvent.band);
        if (direction) {
          const step = direction * ((key & 1) ? 1 : -1);
          preferred = lastLane + step;
          if (preferred < 0 || preferred > 3) preferred = lastLane - step;
        } else if (delta < e.period * 0.45 && previousLane >= 0 && (previousLane >> 1) !== (lastLane >> 1)) {
          preferred = previousLane;
        } else if (Number.isInteger(e.slot)) {
          preferred = shape[(e.slot + (key >>> 8)) % 4];
        }
      }
      const lanes = [0, 1, 2, 3].filter((l) =>
        available[l] <= t || jack && l === lastLane && t - lastPress[l] >= jackRecovery);
      const oppositeReady = technical && delta < p.laneGap && lanes.some(l => (l >> 1) !== (lastLane >> 1));
      const laneScore = (l) => {
        const shapeScore = (l === preferred ? 1 : 0) - load[l] * 0.12 -
          (l === lastLane ? 1.4 : l >> 1 === lastLane >> 1 ? 0.35 : 0);
        const intentionalRepeat = jack && l === lastLane;
        if (!revised || !technical)
          return shapeScore - (oppositeReady && (l >> 1) === (lastLane >> 1) ? 1.6 : 0) + (intentionalRepeat ? 3.15 : 0);
        // Compare actual finger/hand recovery, including the previous chord's
        // second key. A motif can retain its fingering when there is room.
        const fastHand = t - Math.max(lastPress[l], lastPress[l ^ 1]) < p.laneGap;
        const fastFinger = t - lastPress[l] < p.laneGap * 1.5;
        return shapeScore - (fastHand ? 2.2 : 0) - (fastFinger && !intentionalRepeat ? 1.35 : 0) +
          (intentionalRepeat ? 3.15 : 0) + (l === figureLane ? 2.6 : 0);
      };
      lanes.sort((a, b) => laneScore(b) - laneScore(a));
      const trace = options.eventTrace?.get(e);
      if (trace) trace.decision = 'finger-recovery';
      if (!lanes.length) continue;
      const lane = phrasePlan && lanes.includes(figureLane) ? figureLane : lanes[0],
        note = { id: 'v3-' + notes.length, timeMs: t, lane, type: 'tap' };
      const holdMs = Math.min(e.sustainEndMs - t, e.period * (p.holds + 1));
      if (
        !revised &&
        holdMs >= Math.max(220, e.period * 0.57) &&
        t - lastHold >= e.period * (p.holds === 1 ? 4 : 2) &&
        tails.filter((end) => end > t).length < p.holds
      ) {
        note.type = 'hold';
        note.endTimeMs = Math.min(Math.round(timeline.durationMs), Math.round(t + holdMs));
        tails[lane] = note.endTimeMs;
        lastHold = t;
      }
      available[lane] = Math.max(t + p.laneGap, (note.endTimeMs || 0) + 45);
      lastPress[lane] = t;
      notes.push(note);
      if ((jack || figure?.family === 'jack') && lane === lastLane) {
        lastJack = t;
        if (intent && delta < p.laneGap * 1.5) intent.rapidJacks++;
      }
      if (intent && lane === figureLane && figure.family === 'roll') intent.rollSteps++;
      selectedAttacks?.set(t, e);
      for (let l = 0; l < 4; l++) load[l] *= 0.85;
      load[lane]++;
      const opposite = lanes.find((l) => l >> 1 !== lane >> 1);
      // At an accented jump entrance, look one press ahead before occupying
      // the other hand. The short transition needs an unused recovering key.
      const shortJump = calibrated && technical && next && localAccent && ahead >= (difficulty === 'expert' ? 96 : 135) &&
        delta >= p.laneGap * 1.25 && (mode === 'technical' || e.salience >= phrasePolicy.median * 1.4) &&
        lanes.some(l => l !== lane && l !== opposite &&
          Math.round(next.timeMs) - lastPress[l] >= p.laneGap);
      const chordCadence = calibrated
        ? (difficulty === 'expert' ? 0.9 : difficulty === 'hard' ? 1.6 : 2.25)
        : (difficulty === 'expert' ? 1 : 2);
      previousWasChord = false;
      const texture = textures?.[e.phraseId];
      const tonalTexture = texture?.tonalTexture;
      const accentDetail = layeredAccents?.get(e);
      const detail = (!sustained || accentDetail?.layered) && accentDetail;
      let detailFinger;
      let thirdFinger;
      const series = detail?.inSeries && technical;
      const chordGap = difficulty === 'normal' ? 185 : difficulty === 'hard' ? (series ? 93 : 109) : (series ? 59 : 75);
      const pulseCadence = difficulty === 'normal' ? 1.55 : difficulty === 'hard' ? 0.71 : 0.49;
      const cadence = series ? p.laneGap * 1.25
        : Math.max(p.laneGap * 2.05, e.period * pulseCadence * (mode === 'technical' ? 0.82 : 1));
      const distinctLayers = technical && detail?.layered;
      if (detail && (distinctLayers || Math.min(delta, ahead) >= chordGap) &&
          t - lastChord >= (distinctLayers ? Math.max(70, p.laneGap*.73) : cadence) &&
          (!jack || lane !== lastLane) && availableChordKeys(notes, nextOf, next, t) >= 1 &&
          (!technical || distinctLayers || next || delta <= e.period * 1.35)) {
        const fingers = lanes.filter(l => l !== lane &&
          leavesRoomForFigure(available, l, next, nextOf, t, p.laneGap, figureLanes));
        const bracket = difficulty === 'expert' && detail.compound && Math.min(delta, ahead) >= p.laneGap &&
          t - lastPress[lane ^ 1] >= p.laneGap * 1.3;
        // Keep a shared finger through a repeated compound accent when both
        // the figure's interval and the actual finger have time to recover.
        const repeat = difficulty === 'expert' && series && lastChordEvent?.band === e.band &&
          t - lastChord >= 160 && t - lastChord <= 245;
        const shared = repeat && !lastChordFingers.includes(lane)
          ? fingers.find(l => (l >> 1) !== (lane >> 1) && lastChordFingers.includes(l) &&
              t - lastPress[l] >= 160) : undefined;
        detailFinger = shared ?? (bracket && fingers.includes(lane ^ 1)
          ? lane ^ 1 : fingers.find(l => (l >> 1) !== (lane >> 1))) ?? (distinctLayers ? fingers[0] : undefined);
        if (repeat && intent && detailFinger !== undefined &&
            (lastChordFingers.includes(lane) || shared !== undefined))
          intent.chordjacks = (intent.chordjacks ?? 0) + 1;
        if (detailFinger !== undefined && difficulty === 'expert' && !figure &&
            detail.compound && e.components?.independentPitch && detail.prominence >= 1.2 &&
            availableChordKeys(notes, nextOf, next, t) >= 2 &&
            Math.min(delta, ahead) >= p.laneGap * 1.55) {
          thirdFinger = fingers.find(l => l !== detailFinger &&
            t - lastPress[l] >= p.laneGap * 1.5);
        }
      }
      if (
        detailFinger !== undefined || !tonalTexture && opposite !== undefined &&
        (!phrasePlan || leavesRoomForFigure(available, opposite, next, nextOf, t, p.laneGap, figureLanes) &&
          availableChordKeys(notes, nextOf, next, t) >= 1) &&
        (accents.has(e) || localAccents?.has(e) || localAccent) &&
        (!jack || lane !== lastLane) &&
        t - lastChord >= e.period * chordCadence &&
        mode !== 'relax' &&
        (!revised || !technical || delta >= p.laneGap ||
          e.salience >= 0.53 && e.bandSpread >= 0.42 && previousEvent.salience < e.salience) &&
        (!technical || ahead >= p.laneGap || shortJump) &&
        (!calibrated || technical || Math.min(delta, ahead) >= 150) &&
        note.type === 'tap'
      ) {
        const fingers = thirdFinger === undefined ? [detailFinger ?? opposite] : [detailFinger, thirdFinger];
        for (const finger of fingers) {
          const extra = { id: 'v3-' + notes.length, timeMs: t, lane: finger, type: 'tap' };
          notes.push(extra);
          if (detailFinger !== undefined) optionalChordNotes.add(extra);
          available[finger] = t + p.laneGap;
          lastPress[finger] = t;
          load[finger]++;
        }
        lastChord = t;
        if (phrasePlan) {
          lastChordEvent = e;
          lastChordFingers = [lane, ...fingers];
        }
        previousWasChord = true;
      }
      if (trace) {
        trace.decision = 'selected';
        trace.pattern = figure?.family ?? (jack && lane === lastLane ? 'jack' : 'single');
        trace.chordEligible = !!(detail || !tonalTexture && (accents.has(e) || localAccents?.has(e) || localAccent));
        trace.chordDecision = previousWasChord ? 'placed' : !p.chord ? 'difficulty' :
          sustained && !detail && layeredAccents?.has(e) ? 'reserved-sustain' : !trace.chordEligible ? 'no-accent-evidence' :
          lanes.length < 2 ? 'finger-recovery' : detail && Math.min(delta, ahead) < chordGap ? 'adjacent-head-spacing' :
          detail && t - lastChord < cadence ? 'chord-cadence' :
          availableChordKeys(notes, nextOf, next, t) < 1 ? 'one-second-key-limit' : 'voicing-or-lookahead';
        trace.plannedWidth = previousWasChord ? lastChordFingers?.length ?? 2 : 1;
      }
      previousLane = lastLane;
      previousEvent = e;
      lastLane = lane;
      lastTime = e.timeMs;
    }
  }
  return revised ? articulateHolds(notes, selectedAttacks, timeline, p, mode, sustainLanes, trackSustain, calibrated,
    optionalChordNotes, options.compositionRevision === V3_SPECTRAL_REVISION ? layeredAccents : null) : notes;
}

// First build a complete, playable attack layout, then give its strongest
// sustained sounds release gestures. A hold must fit the existing lanes.
function articulateHolds(notes, attacks, timeline, profile, mode, sustainLanes, trackSustain, calibrated, optionalChordNotes, hybridAccents) {
  const next = Array(4).fill(Infinity);
  const candidates = [];
  const headTimes = optionalChordNotes ? [...attacks.keys()] : null;
  let headIndex = (headTimes?.length ?? 0) - 1;
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i], t = note.timeMs;
    const nextOnLane = next[note.lane];
    next[note.lane] = t;
    if (notes[i - 1]?.timeMs === t) continue;
    const thirdHeadTime = headTimes ? headTimes[headIndex-- + 3] : notes[i + 3]?.timeMs;
    const chord = notes[i + 1]?.timeMs === t;
    const e = attacks.get(t);
    const tracked = trackSustain ? e.trackedSustain : undefined;
    if (tracked && tracked.state !== 'release') continue;
    let evidenceOptions = [e.holdEvidence];
    if (sustainLanes && e.tonalHoldEvidence && (!e.holdEvidence || e.holdEvidence.retrigger ||
        Math.abs(e.tonalHoldEvidence.endTimeMs - e.holdEvidence.endTimeMs) > 60))
      evidenceOptions.push(e.tonalHoldEvidence);
    if (tracked) {
      // A clear moving tone's decay supersedes an earlier broad or fixed-bin
      // endpoint. If the full gesture cannot fit, leave the attack as a tap.
      const agreeing = evidenceOptions.filter(evidence =>
        evidence && !evidence.retrigger && Math.abs(evidence.endTimeMs - tracked.endTimeMs) <= 35);
      evidenceOptions = agreeing.length ? agreeing : [tracked];
    }
    // In busy music, a sustained gesture needs more contrast than in an
    // exposed passage. Use the charted rhythm, even across phrase seams.
    const busy = (thirdHeadTime ?? Infinity) - t < Math.min(440, e.period);
    const floor = (mode === 'melodic' ? 0.38 : 0.44) + (busy ? 0.12 : 0);
    const maxLength = Math.max(sustainLanes ? 850 : 0, e.period * (profile.holds + 1));
    for (const evidence of evidenceOptions) {
      if (!evidence) continue;
      const endTimeMs = Math.min(Math.round(timeline.durationMs), Math.round(evidence.endTimeMs));
      const length = endTimeMs - t;
      const moving = evidence === tracked;
      const tonal = evidence === e.tonalHoldEvidence || moving;
      const minimum = tonal && !moving ? Math.max(300, e.period * 0.66) : Math.max(235, e.period * 0.57);
      const durationLimit = moving || tracked
        ? (profile.holds === 2 ? MAX_TRACKED_SUSTAIN_MS : Math.min(MAX_TRACKED_SUSTAIN_MS, Math.max(2000, e.period * 4)))
        : maxLength;
      if (length < minimum || length > durationLimit ||
          (!sustainLanes && endTimeMs + 45 > nextOnLane)) continue;
      if (sustainLanes && timeline.quietRanges?.some(r => r.startMs > t && r.startMs < endTimeMs - 30)) continue;
      const score = 0.65 * evidence.continuity + 0.35 * e.salience - (evidence.retrigger ? 0.06 : 0);
      if (score < floor) continue;
      // A strong sustained sound can take priority over a chord on the same attack.
      const clearRelease = calibrated && (tonal || tracked?.state === 'release') &&
        evidence.continuity >= 0.72 && score >= 0.58;
      if (chord && !clearRelease && (length < Math.max(tonal ? 450 : 350, e.period * 0.85) ||
          score < (tonal ? 0.73 : 0.68))) continue;
      const chordNotes = [];
      for (let n = i + 1; notes[n]?.timeMs === t; n++) chordNotes.push(notes[n]);
      candidates.push({ note, chordNotes, t, endTimeMs, score, spacing: e.period * (profile.holds === 1 ? 4 : 2) });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.t - b.t);
  const accepted = [];
  const replacedChords = new Set();
  const lanes = sustainLanes ? [0, 1, 2, 3].map(lane => notes.filter(note => note.lane === lane)) : null;
  for (const candidate of candidates) {
    const { note, chordNotes, t, endTimeMs, spacing, score } = candidate;
    if (note.type === 'hold' || replacedChords.has(note)) continue;
    const index = detailIndex(accepted, t);
    const previous = accepted[index - 1], following = accepted[index];
    if (previous && t - previous.timeMs < Math.max(previous.spacing, spacing) ||
        following && following.timeMs - t < Math.max(following.spacing, spacing)) continue;
    let overlap = 0;
    const lookback = trackSustain ? MAX_TRACKED_SUSTAIN_MS : 1850;
    for (let i = detailIndex(accepted, t - lookback); accepted[i]?.timeMs < endTimeMs; i++)
      if (accepted[i].endTimeMs > t) overlap++;
    if (overlap >= profile.holds) continue;
    if (lanes && !(optionalChordNotes
      ? placePhraseHold(lanes, note, endTimeMs, profile.laneGap, score >= 0.62 ? optionalChordNotes : null, replacedChords)
      : fitSustainLane(lanes, note, endTimeMs, profile.laneGap))) continue;
    note.type = 'hold';
    note.endTimeMs = endTimeMs;
    for (const chord of chordNotes) {
      if (hybridAccents?.get(attacks.get(t))?.layered && chord.lane !== note.lane &&
          !replacedChords.has(chord)) continue;
      replacedChords.add(chord);
      if (optionalChordNotes) {
        const lane = lanes[chord.lane];
        const at = detailIndex(lane, t);
        if (lane[at] === chord) lane.splice(at, 1);
      }
    }
    accepted.splice(index, 0, { timeMs: t, endTimeMs, spacing });
  }
  return replacedChords.size ? notes.filter(note => !replacedChords.has(note)) : notes;
}

function placePhraseHold(lanes, note, endTimeMs, recovery, optionalChords, removed) {
  const t = note.timeMs, home = lanes[note.lane], index = detailIndex(home, t);
  if (endTimeMs + 45 <= (home[index + 1]?.timeMs ?? Infinity)) return true;
  const order = [note.lane ^ 1, note.lane ^ 2, note.lane ^ 3, note.lane];
  for (const allowSwap of optionalChords ? [false, true] : [false]) {
    for (const finger of order) {
      const presses = lanes[finger], stay = presses === home;
      const at = detailIndex(presses, t);
      const nextIndex = at + Number(stay), next = presses[nextIndex];
      const previous = presses[at - 1];
      if (!stay && (t - (previous?.timeMs ?? -Infinity) < recovery * 1.5 ||
          t < (previous?.endTimeMs ?? -Infinity) + 45)) continue;
      const end = Math.max(endTimeMs + 45, t + recovery * 1.5);
      if ((next?.timeMs ?? Infinity) < end) {
        if (!allowSwap || !optionalChords.has(next) || (presses[nextIndex + 1]?.timeMs ?? Infinity) < end) continue;
        removed.add(next);
        presses.splice(nextIndex, 1);
      }
      if (!stay) {
        home.splice(index, 1);
        presses.splice(at, 0, note);
        note.lane = finger;
      }
      return true;
    }
  }
  return false;
}

function fitSustainLane(lanes, note, endTimeMs, recovery) {
  const t = note.timeMs;
  const home = lanes[note.lane];
  const index = detailIndex(home, t);
  if (endTimeMs + 45 <= (home[index + 1]?.timeMs ?? Infinity)) return true;

  // Move just the sustain entrance within its existing hand. Future heads
  // stay intact and the receiving finger keeps full recovery on both sides.
  const alternateLane = note.lane ^ 1;
  const alternate = lanes[alternateLane];
  const at = detailIndex(alternate, t);
  const previous = alternate[at - 1], next = alternate[at];
  if (t - (previous?.timeMs ?? -Infinity) < 1.5 * recovery ||
      t < (previous?.endTimeMs ?? -Infinity) + 45 ||
      (next?.timeMs ?? Infinity) < Math.max(endTimeMs + 45, t + 1.5 * recovery)) return false;
  home.splice(index, 1);
  alternate.splice(at, 0, note);
  note.lane = alternateLane;
  return true;
}

// The upper technical range can add detail around a completed 1× chart.
// Work in evidence order so a higher slider value extends the same plan.
export function addV3DensityDetail(timeline, notes, {difficulty, mode = 'balanced', densityScale, minConfidence = 0.1}, rhythmEvidence) {
  if (!notes.length) return notes;
  const profile = V3_PROFILES[difficulty];
  const personality = PERSONALITIES[mode];
  const recovery = Math.min(105, profile.laneGap);
  const shortGap = Math.max(difficulty === 'hard' ? 76 : 50, profile.gap * personality[0] * 0.7);
  const minimumScore = 0.42 - (densityScale - 1) / 0.45 * 0.22 +
    (mode === 'relax' || mode === 'beat' ? 0.035 : 0);
  const lanes = [0, 1, 2, 3].map(lane => notes.filter(note => note.lane === lane));
  const coreAt = new Map();
  for (const note of notes) {
    const chord = coreAt.get(note.timeMs);
    if (chord) chord.push(note);
    else coreAt.set(note.timeMs, [note]);
  }
  const occupied = [...coreAt.keys()];
  const heads = [...occupied];
  const chordTimes = occupied.filter(time => coreAt.get(time).length > 1);
  const candidates = [];
  const credible = timeline.events.map((event, index) => ({
    event, index, timeMs:Math.round(event.timeMs)
  })).filter(({event})=>event.confidence>=Math.max(minConfidence,0.14));
  const quiet = timeline.quietRanges || [];
  let quietIndex = 0;
  for (const [position, {event,index,timeMs}] of credible.entries()) {
    while (quiet[quietIndex]?.endMs <= timeMs) quietIndex++;
    if (quiet[quietIndex]?.startMs <= timeMs || timeMs > Math.round(timeline.durationMs)) continue;
    const at = detailIndex(occupied, timeMs);
    const core = coreAt.get(timeMs);
    if (core) {
      // An extra key can emphasize a prominent broadband attack. Keep the
      // existing jump width, and leave more space on both sides than a tap.
      const before = timeMs - (occupied[at - 1] ?? -Infinity);
      const after = (occupied[at + 1] ?? Infinity) - timeMs;
      if (mode !== 'relax' && core.length === 1 && core[0].type === 'tap' &&
          event.bandSpread >= 0.42 && event.confidence >= 0.23 &&
          event.salience >= Math.max(0.30, minimumScore) &&
          Math.min(before, after) >= profile.laneGap &&
          Math.min(before, after) <= event.period * 1.5)
        candidates.push({timeMs, score:event.salience, chordLane:core[0].lane,
          chordGap:event.period * (difficulty === 'hard' ? 2 : 1)});
      continue;
    }
    const before = timeMs - (occupied[at - 1] ?? -Infinity);
    const after = (occupied[at] ?? Infinity) - timeMs;
    if (before < shortGap || after < shortGap) continue;
    // A balanced slot is supported by two actual heads, or a clear attack
    // can complete a subdivision near an existing head. No grid notes are made.
    const between = Math.max(before, after) <= 225 &&
      Math.abs(before - after) <= Math.max(10, before * 0.10);
    const near = Math.min(before, after);
    const subdivision = [2, 3, 4, 6, 8].some(n => Math.abs(near - event.period / n) <= 11);
    const rhythm = rhythmEvidence[index] || 0;
    const continuing = near <= 225 && carriesSubdivision(credible, position);
    if (rhythm < 0.35 && !between && !continuing &&
        !(subdivision && event.confidence >= 0.28 && event.salience >= 0.25)) continue;
    const score = event.salience + 0.12 * rhythm + (between || continuing ? 0.055 : 0);
    if (score >= minimumScore) candidates.push({timeMs, score});
  }
  candidates.sort((a, b) => b.score - a.score || a.timeMs - b.timeMs);
  const added = [];
  const usedIds = new Set(notes.map(note => note.id));
  let nextId = notes.length;
  for (const {timeMs, chordLane, chordGap} of candidates) {
    const at = detailIndex(heads, timeMs);
    const chord = chordLane !== undefined;
    const after = heads[at + (chord ? 1 : 0)] ?? Infinity;
    const gap = chord ? profile.laneGap : shortGap;
    if (timeMs - (heads[at - 1] ?? -Infinity) < gap || after - timeMs < gap) continue;
    const chordAt = detailIndex(chordTimes, timeMs);
    if (!chord && (timeMs-(chordTimes[chordAt-1]??-Infinity)<profile.laneGap ||
      (chordTimes[chordAt]??Infinity)-timeMs<profile.laneGap)) continue;
    if (chord && (timeMs-(chordTimes[chordAt-1]??-Infinity)<chordGap ||
      (chordTimes[chordAt]??Infinity)-timeMs<chordGap)) continue;

    // Preserve original chord/hold placements, including the clearance before
    // the next existing press. Nearby same-hand presses exclude that hand.
    const open = [];
    for (const [lane, presses] of lanes.entries()) {
      if (chord && (lane >> 1) === (chordLane >> 1)) continue;
      const index = detailIndex(presses, timeMs);
      const prev = presses[index - 1], next = presses[index];
      const gap = timeMs - (prev?.timeMs ?? -Infinity);
      const ahead = (next?.timeMs ?? Infinity) - timeMs;
      if (gap < profile.laneGap || ahead < profile.laneGap ||
          timeMs < (prev?.endTimeMs ?? -Infinity) + 45) continue;
      const mate = lanes[lane ^ 1];
      const other = detailIndex(mate, timeMs);
      if (timeMs - (mate[other - 1]?.timeMs ?? -Infinity) < recovery ||
          (mate[other]?.timeMs ?? Infinity) - timeMs < recovery) continue;
      open.push({lane, index, clearance: Math.min(gap, ahead)});
    }
    if (!open.length) continue;

    // Respect the existing validator's rolling density warning threshold. The
    // only windows that can change contain the new timestamp.
    const nearby = lanes.flatMap(presses => presses.slice(
      detailIndex(presses, timeMs - 1000), detailIndex(presses, timeMs + 1001)
    ).map(note => note.timeMs)).sort((a, b) => a - b);
    let left = 0;
    if (nearby.some((t, i) => {
      while (t - nearby[left] > 1000) left++;
      return i - left + 1 >= 18 &&
        Math.max(t, timeMs) - Math.min(nearby[left], timeMs) <= 1000;
    })) continue;
    open.sort((a, b) => b.clearance - a.clearance || a.lane - b.lane);
    const {lane, index} = open[0];
    while (usedIds.has('v3-' + nextId)) nextId++;
    const note = {id: 'v3-' + nextId++, timeMs, lane, type: 'tap'};
    if (chord) chordTimes.splice(chordAt,0,timeMs);
    else heads.splice(at, 0, timeMs);
    lanes[lane].splice(index, 0, note);
    added.push(note);
  }
  return added.length ? [...notes, ...added].sort((a, b) => a.timeMs - b.timeMs) : notes;
}

// Four credible attacks can corroborate a straight or repeating short-long
// figure without depending on a single globally estimated pulse.
function carriesSubdivision(attacks, position) {
  for (let from = Math.max(0, position - 3); from <= position && from + 3 < attacks.length; from++) {
    const a = attacks[from + 1].timeMs - attacks[from].timeMs;
    const b = attacks[from + 2].timeMs - attacks[from + 1].timeMs;
    const c = attacks[from + 3].timeMs - attacks[from + 2].timeMs;
    if (Math.min(a, b, c) < 45 || Math.max(a, b, c) > 225) continue;
    if (Math.abs(a - c) > Math.max(10, a * 0.12)) continue;
    if (Math.abs(a-b) <= Math.max(10, a*0.12) || Math.abs(Math.max(a,b) / Math.min(a,b)-2) <= 0.22)
      return true;
  }
  return false;
}

function detailIndex(sorted, timeMs) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid].timeMs ?? sorted[mid]) < timeMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
