// Smart Chart Generator 2.0 — music-aware extension built on the existing generateChart() API (core.js).
// Keep the existing schema compatible; add only optional `generator.*` and `quality` chart fields.
import { DIFFICULTIES, clamp, generateChart } from './core.js';
import { compose } from './compose.js';
import { rng } from './patterns.js';
import { computeDifficulty } from './difficulty.js';
import { buildTempoMap, getBeatPosition, getLocalBeatPeriod, rhythmicEvidence } from './tempomap.js';
import { extraMetrics } from './quality-extra.js';
import { applySavedSections, lockedRangesFrom, mergeLockedNotes } from './sections.js';
const tempoMapOf = a => a.tempoMap || (a.tempoMap = buildTempoMap(a));

export const GEN_VERSION = '2.0';
export const MODES = {
  balanced:  { density: 1,    response: .5, jack: 0,  beat: .5, hold: 1.0,  label: 'Balanced' },
  beat:      { density: .85,  response: .4, jack: -1, beat: 1,  hold: 1.18, label: 'Beat Focus' },
  melodic:   { density: 1.05, response: .6, jack: 0,  beat: .3, hold: 1.28, label: 'Melodic' },
  technical: { density: 1.15, response: .7, jack: 1,  beat: .3, hold: .82,  label: 'Technical' },
  relax:     { density: .7,   response: .3, jack: -1, beat: .8, hold: 1.32, label: 'Relax' },
  custom:    { density: 1,    response: .5, jack: 0,  beat: .5, hold: 1.0,  label: 'Custom' },
};
const MAX_JACK = { easy: 1, normal: 2, hard: 3, expert: 4 };

const resolveMode = (mode, custom = {}) => ({ ...(MODES[mode] || MODES.balanced), ...(mode === 'custom' ? custom : {}) });

/* ---------- Section and tempo analysis (measured audio features) ---------- */
export function analyzeStructure(analysis, windowMs = 2000) {
  const f = analysis.features || [], dur = analysis.durationMs || 0;
  if (!f.length || dur < windowMs) return [];
  const hop = f.length > 1 ? (f[1].timeMs - f[0].timeMs) || 10 : 10, per = Math.max(1, Math.round(windowMs / hop));
  const wins = [];
  for (let i = 0; i < f.length; i += per) {
    const s = f.slice(i, i + per); let e = 0, o = 0;
    for (const x of s) { e += x.rms || 0; o += x.onset > .5 ? 1 : 0; }
    wins.push({ startMs: s[0].timeMs, endMs: Math.min(dur, s[0].timeMs + windowMs), energy: e / s.length, density: o / (windowMs / 1000) });
  }
  const maxE = Math.max(1e-6, ...wins.map(w => w.energy)), maxD = Math.max(1e-6, ...wins.map(w => w.density));
  wins.forEach(w => { w.energy /= maxE; w.activity = w.density / maxD; w.level = w.energy < .35 ? 0 : w.energy < .7 ? 1 : 2; });
  const secs = [];
  for (const w of wins) { const last = secs[secs.length - 1]; if (last && last.level === w.level) { last.endMs = w.endMs; last.n++; last.energy += w.energy; last.activity += w.activity; } else secs.push({ ...w, n: 1 }); }
  return secs.map((s, i, a) => {
    const energy = s.energy / s.n, activity = s.activity / s.n, prev = a[i - 1], next = a[i + 1];
    const rising = next && next.level > s.level && s.level < 2 && (s.endMs - s.startMs) <= 12000;
    const label = rising ? 'Build-up' : s.level === 2 ? 'High Energy' : s.level === 0 ? 'Low Energy' : 'Medium Energy';
    const contrast = prev ? Math.abs(energy - prev.energy / prev.n) : .5;
    return { id: `sec-${i}`, startMs: Math.round(s.startMs), endMs: Math.round(s.endMs), energy, activity, rhythmicDensity: activity, label, confidence: clamp(.3 + contrast + Math.min(.3, (s.endMs - s.startMs) / 30000), 0, 1) };
  });
}
export function tempoInterpretations(analysis) {
  const bpm = analysis.bpm || 120, c = analysis.bpmConfidence ?? .5;
  const out = [{ bpm, confidence: c, kind: 'detected' }];
  for (const [k, r, f] of [['half-time', .5, .55], ['double-time', 2, .55]]) if (bpm * r >= 60 && bpm * r <= 240) out.push({ bpm: +(bpm * r).toFixed(2), confidence: c * f, kind: k });
  for (const t of analysis.tempoCandidates || []) if (t.bpm && !out.some(o => Math.abs(o.bpm - t.bpm) < 1)) out.push({ bpm: t.bpm, confidence: c * clamp(t.confidence ?? t.relativeScore ?? t.score ?? 0), kind: 'candidate' });
  return out.sort((a, b) => b.confidence - a.confidence);
}

/* ---------- Context-aware post-processing: section density, jacks and holds ---------- */
const secAt = (secs, t) => secs.find(s => t >= s.startMs && t < s.endMs) || secs[secs.length - 1];
const inRanges = (rs, t) => rs.some(r => t >= r.from && t <= r.to);
export function sanitize(notes) {
  const out = notes.slice().sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane), lastEnd = [-1, -1, -1, -1], seen = new Set(), res = [];
  for (const n of out) {
    if (!Number.isFinite(n.timeMs) || n.timeMs < 0 || !(n.lane >= 0 && n.lane < 4)) continue;
    const key = n.lane + ':' + n.timeMs; if (seen.has(key)) continue;
    if (n.timeMs <= lastEnd[n.lane]) continue;       // overlaps an existing hold body
    seen.add(key);
    let m = n;
    if (n.type === 'hold') { const nxt = out.find(o => o.lane === n.lane && o.timeMs > n.timeMs); const end = nxt ? Math.min(n.endTimeMs, nxt.timeMs - 40) : n.endTimeMs; m = end - n.timeMs >= 120 ? { ...n, endTimeMs: end } : { id: n.id, timeMs: n.timeMs, lane: n.lane, type: 'tap' }; }
    if (m.type === 'hold') lastEnd[m.lane] = m.endTimeMs;
    res.push(m);
  }
  return res;
}
function shapeNotes(notes, a, o) {
  const { difficulty, mode, secs, rand, locked } = o, keep = [];
  const maxJack = clamp(MAX_JACK[difficulty] + (mode.jack || 0), 1, 6);
  for (const n of notes) {
    const sec = secAt(secs, n.timeMs), bp = getBeatPosition(o.map, n.timeMs), onBeat = Math.abs(bp - Math.round(bp)) * getLocalBeatPeriod(o.map, n.timeMs) < 35;
    const lowness = sec ? 1 - sec.energy : 0;
    const dropP = onBeat ? 0 : clamp(lowness * mode.response * .9 + (mode.beat - .5) * .25, 0, .7);
    if (!inRanges(locked, n.timeMs) && rand() < dropP) continue;
    keep.push(n);
  }
  // Limit jack runs by changing lanes after maxJack consecutive repeats.
  const busy = (lane, t, ns) => ns.some(x => x.lane === lane && x.type === 'hold' && t >= x.timeMs - 30 && t <= x.endTimeMs + 30);
  const prevAt = new Map(); let run = 0, lastLane = -1; const res = [];
  for (const n of keep.sort((a, b) => a.timeMs - b.timeMs)) {
    const sameTime = res.some(r => r.timeMs === n.timeMs);
    let m = n;
    if (!sameTime) {
      run = n.lane === lastLane ? run + 1 : 1;
      if (run > maxJack && n.type !== 'hold' && !inRanges(locked, n.timeMs)) {
        const alts = [0, 1, 2, 3].filter(l => l !== n.lane && !busy(l, n.timeMs, keep) && !res.some(r => r.timeMs === n.timeMs && r.lane === l)).sort((x, y) => Math.abs(x - lastLane) - Math.abs(y - lastLane) || rand() - .5);
        if (alts.length) { m = { ...n, lane: alts[0] }; run = 1; }
      }
      lastLane = m.lane;
    }
    res.push(m);
  }
  return sanitize(res);
}

/* ---------- Sinh chart ---------- */
export function annotateSections(secs, map) { return secs.map(s => ({ ...s, startBeat: +getBeatPosition(map, s.startMs).toFixed(3), endBeat: +getBeatPosition(map, s.endMs).toFixed(3), startMeasure: Math.floor(getBeatPosition(map, s.startMs) / 4), endMeasure: Math.floor(getBeatPosition(map, s.endMs) / 4) })); }
export function generateSmart(analysis, title, { difficulty = 'normal', mode = 'balanced', custom, seed = 1337, locked = [], engine = 'compose', sections: savedSections, baseChart, ...rest } = {}) {
  const m = resolveMode(mode, custom), map0 = tempoMapOf(analysis), detected = analysis.sections2 || analyzeStructure(analysis), secs = annotateSections(applySavedSections(detected, savedSections || baseChart?.generator?.sectionEdits), map0);
  locked = [...locked, ...lockedRangesFrom(secs)];
  const gen = generateChart(analysis, title, { ...rest, difficulty, seed, densityScale: (rest.densityScale ?? 1) * m.density });
  delete rest.densityScale;
  const chart = gen.chart;
  const map = tempoMapOf(analysis); let comp = null, notes;
  if (engine === 'compose') { comp = compose(analysis, map, secs, { difficulty, seed, mode: { ...m, density: m.density * (rest.densityScale ?? 1) }, modeId: mode }); notes = sanitize(comp.notes); if (notes.length < 4) { comp = null; notes = null; } }
  if (!notes) notes = shapeNotes(chart.notes, analysis, { difficulty, mode: m, secs, rand: rng(seed ^ 0x9e3779b9), locked, map });
  const evidence = rhythmicEvidence(analysis); if (!evidence.hasRhythm) { comp = null; notes = []; } // No rhythmic evidence: do not fabricate notes.
  const out = { ...chart, notes, generator: { ...(chart.generator || {}), version: GEN_VERSION, mode, seed, custom: mode === 'custom' ? custom : undefined, sections: secs, tempoInterpretations: tempoInterpretations(analysis), engine: comp ? 'compose-2' : 'legacy-shaped', patterns: comp?.patterns, transitions: comp?.transitions, subdivisionUsage: comp?.stats, rhythmicEvidence: evidence, tempoMap: map } };
  if (baseChart && locked.length) out.notes = sanitize(mergeLockedNotes(baseChart.notes, out.notes, locked));
  out.generator.sectionEdits = secs.some(x => x.locked || x.userEdited) ? secs.filter(x => x.locked || x.userEdited) : undefined; out.generator.lockedRanges = locked.length ? locked : undefined;
  // Resolve BPM octave aliases: the tempo map is preferred when its octave-aware confidence is reliable.
  const dom = map.segments.reduce((b, x) => (!b || x.endTime - x.startTime > b.endTime - b.startTime ? x : b), null);
  if (dom && !map.lowConfidence && dom.confidence >= .5 && !(rest.bpmOverride > 0)) { const r = dom.bpm / (out.metadata.bpm || dom.bpm); if (Math.abs(r - 2) < .06 || Math.abs(r - .5) < .03) { out.generator.bpmCorrection = { from: out.metadata.bpm, to: +dom.bpm.toFixed(2), source: 'tempomap' }; out.metadata = { ...out.metadata, bpm: +dom.bpm.toFixed(2) }; } }
  out.metadata = { ...out.metadata, difficultyRating: computeDifficulty(out.notes, analysis.durationMs, map).rating };
  out.quality = evaluateChart(out, analysis);
  out.quality.difficultyModel = computeDifficulty(out.notes, analysis.durationMs, map);
  return { chart: out, diagnostics: { ...gen.diagnostics, noteCount: out.notes.length, holdCount: out.notes.filter(n => n.type === 'hold').length, notesPerSecond: out.quality.meanNps, quality: out.quality } };
}
export function generateAllSmart(analysis, title, seed = 1337, opts = {}) { return DIFFICULTIES.map((d, i) => generateSmart(analysis, title, { ...opts, difficulty: d, seed: seed + i * 101 })); }
export function generateVariations(analysis, title, opts, count = 3) { return Array.from({ length: count }, (_, i) => generateSmart(analysis, title, { ...opts, seed: (opts.seed ?? 1337) + i * 7919 })); }

// Regenerate a time range while preserving notes outside it, locked ranges and manual edits.
export function regenerateRange(chart, analysis, title, { from, to, seed = 4242, locked = [], keepManual = true, ...opts } = {}) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new Error('Invalid regeneration range. Expected from < to, with values in milliseconds.');
  locked = [...locked, ...lockedRangesFrom(chart.generator?.sectionEdits || [])];
  const fresh = generateSmart(analysis, title, { ...opts, difficulty: chart.metadata.difficulty, mode: opts.mode || chart.generator?.mode || 'balanced', seed, locked }).chart;
  const frozen = n => n.timeMs < from || n.timeMs > to || inRanges(locked, n.timeMs) || (keepManual && n.manual);
  const kept = chart.notes.filter(frozen);
  const added = fresh.notes.filter(n => n.timeMs >= from && n.timeMs <= to && !inRanges(locked, n.timeMs)).map((n, i) => ({ ...n, id: `rg${seed}-${i}` })).filter(n => !(keepManual && chart.notes.some(k => k.manual && Math.abs(k.timeMs - n.timeMs) < 60 && k.lane === n.lane)));
  const notes = sanitize([...kept, ...added]), out = { ...chart, notes, generator: { ...chart.generator, lastRegen: { from, to, seed } } };
  out.quality = evaluateChart(out, analysis); return out;
}

/* ---------- Quality evaluation (all scores are derived from measured metrics) ---------- */
export function evaluateChart(chart, analysis) {
  const notes = chart.notes || [], dur = analysis.durationMs || chart.metadata?.audioDurationMs || 1, bpm = chart.metadata?.bpm || analysis.bpm || 120, beat = 60000 / bpm, step = beat / 4, off = analysis.beatOffsetMs || 0;
  const issues = [], metrics = {}, add = (severity, from, to, message) => issues.push({ severity, from, to, message });
  const fmt = t => `${String(Math.floor(t / 60000)).padStart(2, '0')}:${String(Math.floor(t / 1000) % 60).padStart(2, '0')}`;
  const bad = notes.filter(n => !Number.isFinite(n.timeMs) || n.timeMs < 0 || n.timeMs > dur + 50 || !(n.lane >= 0 && n.lane < 4));
  if (bad.length) add('error', bad[0].timeMs, bad[0].timeMs, `${bad.length} notes have an invalid timestamp or lane.`);
  const sorted = notes.slice().sort((a, b) => a.timeMs - b.timeMs);
  // 1. Align to the 1/16 grid.
  const dev = n => { const r = (((n.timeMs - off) % step) + step) % step; return Math.min(r, step - r); };
  const aligned = notes.filter(n => dev(n) <= Math.max(25, step * .12)).length / Math.max(1, notes.length);
  metrics.beatAlignment = { score: aligned, why: `${(aligned * 100).toFixed(0)}% of notes are within ±${Math.round(Math.max(25, step * .12))} ms of the 1/16 grid.` };
  // 1b. Align to the local tempo map, including tempo changes.
  const tm = tempoMapOf(analysis), tdev = n => { const p = getBeatPosition(tm, n.timeMs) * 4; return Math.abs(p - Math.round(p)) * getLocalBeatPeriod(tm, n.timeMs) / 4; };
  const tAl = notes.filter(n => tdev(n) <= 30).length / Math.max(1, notes.length), segN = tm.segments.length;
  metrics.tempoMapAlignment = { score: tAl, why: `${(tAl * 100).toFixed(0)}% of notes are within ±30 ms of the local 1/16 tempo-map grid (${segN} tempo segments).` };
  if (tAl < .7 && notes.length > 20) add('warning', 0, dur, `Only ${(tAl * 100).toFixed(0)}% of notes align with the local tempo map. A tempo change may not be reflected in the chart.`);
  // 2. Strong-onset coverage.
  const f = analysis.features || [], peaks = [];
  for (let i = 2; i < f.length - 2; i++) if (f[i].onset > .6 && f[i].onset >= f[i - 1].onset && f[i].onset >= f[i + 1].onset) peaks.push(f[i].timeMs);
  const cov = peaks.length ? peaks.filter(t => notes.some(n => Math.abs(n.timeMs - t) <= 90)).length / peaks.length : 1;
  metrics.onsetCoverage = { score: cov, why: `${(cov * 100).toFixed(0)}% of ${peaks.length} strong onsets have a nearby note (±90 ms).` };
  // 3. Density consistency (four-second windows).
  const W = 4000, nw = Math.max(1, Math.ceil(dur / W)), nps = new Array(nw).fill(0);
  notes.forEach(n => { const w = Math.min(nw - 1, Math.floor(n.timeMs / W)); if (w >= 0) nps[w] += 1 / (W / 1000); });
  const act = nps.filter(x => x > 0), mean = act.reduce((a, b) => a + b, 0) / Math.max(1, act.length), sd = Math.sqrt(act.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, act.length));
  const cv = mean ? sd / mean : 0; metrics.densityConsistency = { score: clamp(1 - Math.max(0, cv - .35) / .8), why: `Average NPS ${mean.toFixed(2)}, peak ${Math.max(0, ...nps).toFixed(2)}, coefficient of variation ${cv.toFixed(2)}.` };
  nps.forEach((v, i) => { const nb = [nps[i - 1], nps[i + 1]].filter(x => x !== undefined), avg = nb.reduce((a, b) => a + b, 0) / Math.max(1, nb.length); if (v > 3 && v > avg * 2.2 + 1) add('warning', i * W, (i + 1) * W, `${fmt(i * W)}–${fmt((i + 1) * W)}: note density (${v.toFixed(1)}/s) is much higher than the surrounding sections.`); });
  // 4. Lane balance.
  const cnt = [0, 0, 0, 0]; notes.forEach(n => cnt[n.lane]++); const tot = Math.max(1, cnt.reduce((a, b) => a + b, 0)), ent = -cnt.reduce((a, c) => a + (c ? c / tot * Math.log2(c / tot) : 0), 0) / 2;
  metrics.laneBalance = { score: ent, why: `Lane distribution ${cnt.join('/')} (normalized entropy ${ent.toFixed(2)}).` };
  // 5. Pattern diversity and repetition.
  const sing = sorted.filter((n, i) => i === 0 || n.timeMs !== sorted[i - 1].timeMs), grams = new Map();
  for (let i = 0; i + 4 < sing.length; i++) { const k = [1, 2, 3, 4].map(j => sing[i + j].lane - sing[i + j - 1].lane).join(','); grams.set(k, (grams.get(k) || 0) + 1); }
  const total = [...grams.values()].reduce((a, b) => a + b, 0), top = Math.max(0, ...grams.values());
  metrics.patternDiversity = { score: total ? clamp(grams.size / Math.min(40, total) * 1.2) : 1, why: `${grams.size} distinct four-note patterns across ${total} sequences.` };
  metrics.repetition = { score: total ? clamp(1 - Math.max(0, top / total - .15) / .5) : 1, why: `The most repeated pattern accounts for ${total ? (top / total * 100).toFixed(0) : 0}% of all sequences.` };
  // 6. Same-lane repetition and hold conflicts.
  let run = 1, worst = 0, conflicts = 0;
  for (let i = 1; i < sing.length; i++) { run = sing[i].lane === sing[i - 1].lane && sing[i].timeMs - sing[i - 1].timeMs < 400 ? run + 1 : 1; if (run === 6) { worst++; add('warning', sing[i - 5].timeMs, sing[i].timeMs, `${fmt(sing[i - 5].timeMs)}–${fmt(sing[i].timeMs)}: too many consecutive notes repeat on the same lane.`); } }
  for (const h of notes.filter(n => n.type === 'hold')) { if (!(h.endTimeMs > h.timeMs)) { conflicts++; add('error', h.timeMs, h.timeMs, `${fmt(h.timeMs)}: hold note has an invalid end time.`); } else if (notes.some(n => n !== h && n.lane === h.lane && n.timeMs > h.timeMs && n.timeMs <= h.endTimeMs)) { conflicts++; add('error', h.timeMs, h.endTimeMs, `${fmt(h.timeMs)}: another note overlaps a hold on the same lane.`); } }
  metrics.playability = { score: clamp(1 - worst * .1 - conflicts * .3), why: `${worst} excessive same-lane repetition sequences and ${conflicts} hold conflicts.` };
  if (aligned < .75) add('warning', 0, dur, `Only ${(aligned * 100).toFixed(0)}% of notes align with the beat grid. Check the BPM and beat offset.`);
  if (cov < .4 && peaks.length > 10) add('suggestion', 0, dur, 'Many strong onsets have no nearby notes. This may be intentional at lower difficulties.');
  if (!rhythmicEvidence(analysis).hasRhythm) add('warning', 0, dur, 'The audio contains almost no reliable rhythmic events (ambient, silence, or noise), so a musically meaningful chart cannot be generated.');
  const ex = extraMetrics(chart, analysis, tm, fmt); Object.assign(metrics, ex.metrics); issues.push(...ex.issues);
  const w = { beatAlignment: .12, tempoMapAlignment: .12, onsetCoverage: .12, densityConsistency: .12, laneBalance: .08, patternDiversity: .08, repetition: .08, playability: .1, accentAlignment: .08, transitionQuality: .06, sectionIntensity: .04 };
  const used = Object.keys(w).filter(k => metrics[k].applicable !== false), wsum = used.reduce((a, k) => a + w[k], 0);
  let overall = used.reduce((a, k) => a + metrics[k].score * w[k], 0) / wsum; if (issues.some(i => i.severity === 'error')) overall = Math.min(overall, .5);
  return { overall: Math.round(overall * 100), metrics, issues, noteCount: notes.length, meanNps: +mean.toFixed(2), generatorVersion: GEN_VERSION };
}

// Regenerate one section by ID. Locked sections are rejected and notes outside the section remain unchanged.
export function regenerateSection(chart, analysis, title, sectionId, opts = {}) {
  const sec = (chart.generator?.sections || []).find(x => x.id === sectionId); if (!sec) throw new Error(`Section "${sectionId}" was not found in this chart.`);
  if (sec.locked || (chart.generator?.sectionEdits || []).some(x => x.id === sectionId && x.locked)) throw new Error(`Section "${sectionId}" is locked.`);
  return regenerateRange(chart, analysis, title, { ...opts, from: sec.startMs, to: sec.endMs - 1 });
}
