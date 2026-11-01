// Composition Engine: phân tích → kế hoạch section → chọn slot theo nhạc → chọn pattern → lane → hold/chord → kiểm tra.
import { clamp } from './core.js';
import { buildBeatGrid } from './beatgrid.js';
import { getBeatTime, getBeatPosition } from './tempomap.js';
import { rng, choosePattern, patternById, patternLanes } from './patterns.js';
export const DIFF = {
  easy:   { idx: 0, nps: 1.3, gap: 280, chord: 0,   hold: .14, minAccent: .65, jack: 1, maxJump: 3 },
  normal: { idx: 1, nps: 2.4, gap: 170, chord: .06, hold: .18, minAccent: .5,  jack: 2, maxJump: 3 },
  hard:   { idx: 2, nps: 4.0, gap: 115, chord: .14, hold: .20, minAccent: .26, jack: 3, maxJump: 3 },
  expert: { idx: 3, nps: 6.2, gap: 80,  chord: .22, hold: .26, minAccent: .26, jack: 4, maxJump: 3 },
};
const hashStr = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

const MIN_JACK_GAP = { easy: 190, normal: 155, hard: 112, expert: 88 };
const laneCombinations = size => {
  const out = [];
  const visit = (start, picked) => {
    if (picked.length === size) { out.push(picked.slice()); return; }
    for (let lane = start; lane < 4; lane++) visit(lane + 1, [...picked, lane]);
  };
  visit(0, []);
  return out;
};

/** Smooths only pattern boundaries while preserving event times and chord sizes. */
export function smoothPatternTransitions(notes, patterns, difficulty = 'normal') {
  const ordered = notes.slice().sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);
  const minJackGap = MIN_JACK_GAP[difficulty] ?? MIN_JACK_GAP.normal;
  let adjusted = 0;
  for (let index = 1; index < patterns.length; index++) {
    const previousPattern = patterns[index - 1], nextPattern = patterns[index];
    const previousTime = ordered.reduce((best, note) => note.timeMs <= previousPattern.toMs + 1 ? Math.max(best, note.timeMs) : best, -Infinity);
    const nextTime = ordered.reduce((best, note) => note.timeMs >= nextPattern.fromMs - 1 ? Math.min(best, note.timeMs) : best, Infinity);
    if (!Number.isFinite(previousTime) || !Number.isFinite(nextTime) || nextTime < previousTime) continue;
    const previousGroup = ordered.filter(note => note.timeMs === previousTime);
    const nextGroup = ordered.filter(note => note.timeMs === nextTime);
    if (!previousGroup.length || !nextGroup.length) continue;
    const gap = nextTime - previousTime;
    const previousLanes = previousGroup.map(note => note.lane);
    const originalLanes = nextGroup.map(note => note.lane);
    const isSingleLaneJack = previousGroup.length === 1 && nextGroup.length === 1 && previousLanes[0] === originalLanes[0];
    const needsJackRepair = isSingleLaneJack && gap < minJackGap;
    const jumpLimit = gap < 160 ? 1 : 2; // A three-lane cross is never used at a pattern boundary.
    const originalJump = Math.max(...originalLanes.map(lane => Math.min(...previousLanes.map(prev => Math.abs(prev - lane)))));
    if (originalJump <= jumpLimit && !needsJackRepair) continue;

    const candidates = laneCombinations(nextGroup.length).map(lanes => {
      const distances = lanes.map(lane => Math.min(...previousLanes.map(prev => Math.abs(prev - lane))));
      const maxJump = Math.max(...distances);
      const sameLane = previousGroup.length === 1 && nextGroup.length === 1 && previousLanes[0] === lanes[0];
      const tooFastJack = sameLane && gap < minJackGap;
      const collides = lanes.some(lane => ordered.some(note => note.lane === lane && note.timeMs !== nextTime &&
        Math.abs(note.timeMs - nextTime) < 58 && note.timeMs >= previousTime));
      const cost = maxJump * 12 + distances.reduce((sum, value) => sum + value, 0) + (tooFastJack ? 40 : 0) + (collides ? 1000 : 0);
      return { lanes, maxJump, tooFastJack, collides, cost };
    }).sort((a, b) => a.cost - b.cost);
    const best = candidates.find(candidate => candidate.maxJump <= jumpLimit && !candidate.tooFastJack && !candidate.collides) || candidates.find(candidate => !candidate.collides) || candidates[0];
    if (!best) continue;
    const sortedGroup = [...nextGroup].sort((a, b) => a.lane - b.lane);
    const sortedLanes = best.lanes.slice().sort((a, b) => a - b);
    sortedGroup.forEach((note, i) => { if (note.lane !== sortedLanes[i]) { note.lane = sortedLanes[i]; adjusted++; } });
  }
  notes.sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);
  return { notes, adjusted };
}

export function compose(analysis, map, secs, { difficulty = 'normal', seed = 1, mode = {}, modeId = 'balanced' } = {}) {
  const D = DIFF[difficulty] || DIFF.normal, rand = rng(seed ^ 0x51ed270b), f = analysis.features || [], dur = analysis.durationMs || 0, hop = f.length > 1 ? (f[1].timeMs - f[0].timeMs) || 10 : 10;
  const at = t => f[clamp(Math.round(t / hop), 0, Math.max(0, f.length - 1)) | 0] || {};
  const onsetNear = t => { let m = 0; for (let k = -4; k <= 4; k++) m = Math.max(m, at(t + k * hop).onset || 0); return m; };
  const secAt = t => secs.find(s => t >= s.startMs && t < s.endMs) || secs[secs.length - 1] || { energy: .5, id: 'sec-0' };
  const density = (mode.density ?? 1), beatW = mode.beat ?? .5, resp = mode.response ?? .5, rnd = mode.randomness ?? .15, variety = mode.variety ?? 1;
  const slots = buildBeatGrid(map, 110, dur - 200, { subdivision: 4 }).filter(s => s.accent >= D.minAccent - 1e-9);
  // Extended subdivisions require real onset evidence: triplets for Hard+, 1/32 for Expert, and at least 30 ms from a 1/16 slot.
  const stats = { triplet: 0, thirtysecond: 0 }, extra = [];
  if (D.idx >= 2) for (const [sub, key, acc, thr] of [[3, 'triplet', .3, .7], ...(D.idx >= 3 ? [[8, 'thirtysecond', .27, .8]] : [])]) for (const s of buildBeatGrid(map, 110, dur - 200, { subdivision: sub })) {
    if (sub === 3 ? s.subdivisionIndex === 0 : s.subdivisionIndex % 2 === 0) continue;
    if (slots.some(x => Math.abs(x.time - s.time) < 30) || extra.some(x => Math.abs(x.time - s.time) < 30)) continue;
    if (onsetNear(s.time) < thr) continue; extra.push({ ...s, accent: acc, ext: key });
  }
  if (extra.length) slots.push(...extra); slots.sort((p, q) => p.time - q.time);
  const bars = new Map(); for (const s of slots) { const a = bars.get(s.measureIndex) || []; a.push(s); bars.set(s.measureIndex, a); }
  const notes = [], patterns = [], transitions = [], holdHints = new Map(); let prevLane = 1, hist = [], prevPat = null, lastT = -1e9, motif = new Map(), barInSec = new Map(), prevChord = false, idx = 0;
  for (const [bar, bs] of [...bars].sort((a, b) => a[0] - b[0])) {
    const t0 = bs[0].time, t1 = getBeatTime(map, (bar + 1) * 4), barS = Math.max(.2, (t1 - getBeatTime(map, bar * 4)) / 1000), sec = secAt(t0), energy = sec.energy ?? .5;
    const rms = at(t0 + (t1 - t0) / 2).rms ?? 1; if (energy < .06 && rms < .02) continue;
    const quota = Math.min(bs.length, Math.round(D.nps * barS * density * (1 + (energy - .5) * resp * 1.6) * (sec.label === 'Build-up' ? 1.15 : 1))); if (quota < 1) continue;
    const scored = bs.map(s => ({ s, v: .45 * s.accent * (.5 + beatW) + .4 * onsetNear(s.time) + .15 * (at(s.time).low || 0) + rand() * rnd * .3 })).sort((a, b) => b.v - a.v), acc = [];
    for (const { s } of scored) { if (acc.length >= quota) break; if (Math.abs(s.time - lastT) < D.gap && s.time > lastT && false) continue; if (s.time - lastT < D.gap) continue; if (acc.some(a => Math.abs(a.time - s.time) < D.gap)) continue; acc.push(s); }
    acc.sort((a, b) => a.time - b.time); if (!acc.length) continue;
    let minGap = 9999; for (let i = 1; i < acc.length; i++) minGap = Math.min(minGap, acc[i].time - acc[i - 1].time); if (acc.length === 1) minGap = 9999;
    // Section motif: choose a new pattern, repeat it, then mirror it on alternating bars.
    const bi = barInSec.get(sec.id) ?? 0; barInSec.set(sec.id, bi + 1);
    let pat, mirror = false, key = `${sec.id}:${Math.floor(bi / 4)}`;
    if (bi % 4 === 0 || !motif.has(key)) { pat = choosePattern({ energy, minGap, difficulty: D.idx, mode: modeId, history: hist, variety, randomness: rnd, rand, jackOk: D.jack >= 2 }); motif.set(key, pat); }
    else { pat = motif.get(key); mirror = bi % 2 === 1; if (minGap < pat.minSpacing) pat = patternById('alternate'); }
    const lanes = patternLanes(pat, acc.length, prevLane, rng(hashStr(key) ^ seed), { mirror, chordEvery: D.idx === 1 ? 4 : D.idx === 0 ? 1e9 : 1 });
    if (prevPat && prevPat.id !== pat.id) transitions.push({ from: prevPat.id, to: pat.id, timeMs: Math.round(t0) });
    patterns.push({ id: pat.id, fromMs: Math.round(acc[0].time), toMs: Math.round(acc[acc.length - 1].time), section: sec.id }); hist.push(pat.id); if (hist.length > 4) hist.shift(); prevPat = pat;
    acc.forEach((s, i) => {
      let ls = lanes[i].slice(); if (ls.length === 1 && i && ls[0] === lanes[i - 1][0] && s.time - acc[i - 1].time < 260 && D.jack < 2) ls = [(ls[0] + 1) % 4];
      const chordP = D.chord * (mode.chord ?? 1) * (s.accent >= .8 ? 1.8 : .4) * (onsetNear(s.time) > .5 ? 1.2 : .6);
      if (ls.length === 1 && !prevChord && s.accent >= .65 && D.chord && rand() < chordP) ls.push((ls[0] + 2) % 4);
      prevChord = ls.length > 1; holdHints.set(Math.round(s.time), s); for (const l of ls) notes.push({ id: `cp-${difficulty}-${String(idx++).padStart(4, '0')}`, timeMs: Math.round(s.time), lane: l, type: 'tap' });
      if (s.ext) stats[s.ext]++; prevLane = ls[0]; lastT = s.time;
    });
  }
  // Repair pattern edges before hold planning so moved notes cannot conflict with hold tails.
  const transitionRepair = smoothPatternTransitions(notes, patterns, difficulty);
  // Music-aware hold planner: use the same-lane gap, not a chart-wide gap.
  // This lets Normal/Hard/Expert charts retain long notes while other lanes remain active.
  const holdLimits = {
    easy:   { minBeats: .5, maxBeats: 2.5, maxActive: 1 },
    normal: { minBeats: .5, maxBeats: 3,   maxActive: 2 },
    hard:   { minBeats: .5, maxBeats: 3.5, maxActive: 3 },
    expert: { minBeats: .5, maxBeats: 4,   maxActive: 3 },
  }[difficulty] || { minBeats: .5, maxBeats: 3, maxActive: 2 };
  const holdP = D.hold, laneQueues = [0, 1, 2, 3].map(l => notes.filter(n => n.lane === l).sort((a, b) => a.timeMs - b.timeMs));
  const nextSameLane = new Map();
  for (const laneNotes of laneQueues) for (let i = 0; i < laneNotes.length - 1; i++) nextSameLane.set(laneNotes[i].id, laneNotes[i + 1]);
  const activeHolds = [], laneHoldEnd = [-Infinity, -Infinity, -Infinity, -Infinity];
  const eventGroups = new Map();
  for (const n of notes) { const group = eventGroups.get(n.timeMs) || []; group.push(n); eventGroups.set(n.timeMs, group); }
  const sortedEventTimes = [...eventGroups.keys()].sort((a, b) => a - b); let eventWindowStart = 0, eventWindowEnd = 0;
  const estimateSustainMs = (t, beatMs) => {
    const ref = at(t + 40).rms || at(t).rms || 0;
    if (ref < .025) return 0;
    const floor = Math.max(.025, ref * .62); let sustained = 0;
    const stride = Math.max(30, hop * 3), limit = beatMs * 4;
    for (let dt = 60; dt <= limit; dt += stride) {
      const frame = at(t + dt), rms = frame.rms || 0;
      if (rms < floor) break;
      if (dt > 180 && (frame.onset || 0) > .82 && rms < ref * .82) break;
      sustained = dt;
    }
    return sustained;
  };
  for (const t of sortedEventTimes) {
    while (eventWindowStart < sortedEventTimes.length && sortedEventTimes[eventWindowStart] < t - 1000) eventWindowStart++;
    if (eventWindowEnd < eventWindowStart) eventWindowEnd = eventWindowStart;
    while (eventWindowEnd < sortedEventTimes.length && sortedEventTimes[eventWindowEnd] <= t + 1000) eventWindowEnd++;
    const group = eventGroups.get(t);
    if (group.length !== 1) continue; // Do not convert a chord into a hold.
    const n = group[0], hint = holdHints.get(t), localBeatMs = getBeatTime(map, getBeatPosition(map, t) + 1) - t;
    if (!hint || hint.ext || hint.subdivisionIndex > 1 || t <= laneHoldEnd[n.lane] + 35) continue;
    while (activeHolds.length && activeHolds[0].end <= t) activeHolds.shift();
    if (activeHolds.filter(h => h.end > t).length >= holdLimits.maxActive) continue;
    const next = nextSameLane.get(n.id), availableMs = Math.min((next?.timeMs ?? dur) - t - 55, dur - t - 90);
    const startBeat = getBeatPosition(map, t), maxAvailableBeats = getBeatPosition(map, t + Math.max(0, availableMs)) - startBeat;
    if (maxAvailableBeats < holdLimits.minBeats) continue;
    const sustainBeats = estimateSustainMs(t, localBeatMs) / Math.max(1, localBeatMs), section = secAt(t), energy = section.energy ?? .5;
    const sustainEvidence = clamp((sustainBeats - .35) / 1.8), spaceEvidence = clamp((maxAvailableBeats - .55) / 2.2);
    const beatEvidence = clamp((hint.accent - .32) / .68), subdivisionWeight = hint.subdivisionIndex === 0 ? 1 : .82;
    const localEvents = eventWindowEnd - eventWindowStart;
    const densityWeight = clamp(1.18 - Math.max(0, localEvents - 5) * .045, .58, 1.08);
    const evidenceWeight = .72 + sustainEvidence * .72 + spaceEvidence * .16;
    const energyWeight = 1.08 - energy * .22;
    const probability = Math.min(.48, holdP * (mode.hold ?? 1) * evidenceWeight * (.78 + beatEvidence * .34) * subdivisionWeight * densityWeight * energyWeight);
    if (rand() >= probability) continue;

    // Prefer 1–4 beat tails when sustained audio is present; use shorter holds for transient audio,
    // but only when the lane has enough space to preserve the next note.
    const roll = rand();
    let targetBeats;
    if (sustainBeats >= 2.1 && maxAvailableBeats >= 2) targetBeats = Math.min(holdLimits.maxBeats, 2 + roll * 2.1, Math.max(1.5, sustainBeats));
    else if (sustainBeats >= .9 && maxAvailableBeats >= 1) targetBeats = Math.min(2, 1 + roll * .9, Math.max(.9, sustainBeats));
    else targetBeats = .65 + roll * .6;
    targetBeats = Math.min(targetBeats, holdLimits.maxBeats, maxAvailableBeats - .08);
    const snappedBeats = Math.floor(targetBeats * 4) / 4;
    if (snappedBeats < holdLimits.minBeats) continue;
    const snappedEnd = getBeatTime(map, startBeat + snappedBeats), endTimeMs = Math.min(snappedEnd, t + availableMs);
    if (endTimeMs - t < localBeatMs * .42) continue;
    n.type = 'hold'; n.endTimeMs = Math.round(endTimeMs); laneHoldEnd[n.lane] = n.endTimeMs;
    activeHolds.push({ lane: n.lane, end: n.endTimeMs }); activeHolds.sort((a, b) => a.end - b.end);
  }
  return { notes, patterns, transitions, stats, transitionRepair };
}
