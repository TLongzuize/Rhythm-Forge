// Additional quality metrics computed from chart and audio data.
// Metrics that cannot be evaluated from available data are marked applicable: false
// and excluded from the overall score. Structural validity is separate from musical quality.
import { getBeatPosition, getLocalBeatPeriod } from './tempomap.js';
const clp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const gridAccent = (map, t) => { const bp = getBeatPosition(map, t), per = getLocalBeatPeriod(map, t); for (const [n, a] of [[1, 1], [2, .72], [3, .55], [4, .42]]) { const x = bp * n; if (Math.abs(x - Math.round(x)) * per / n <= 28) return a; } return .12; };
const msToBeat = (map, t) => getBeatPosition(map, t);
export function extraMetrics(chart, analysis, map, fmt) {
  const notes = chart.notes || [], f = analysis.features || [], hop = f.length > 1 ? (f[1].timeMs - f[0].timeMs) || 10 : 10, dur = analysis.durationMs || 1, metrics = {}, issues = [];
  const onsetAt = t => { let m = 0; const c = Math.round(t / hop); for (let k = -4; k <= 4; k++) m = Math.max(m, f[c + k]?.onset || 0); return m; };
  // 1. Beat alignment: fraction of notes landing on strong beat positions (1, 1/2, 1/4, 1/8).
  const beatAligned = notes.filter(n => gridAccent(map, n.timeMs) >= 0.72).length;
  metrics.beatAlignment = notes.length >= 8 ? { score: clp(beatAligned / notes.length / 0.7), applicable: true, why: `${((beatAligned / Math.max(1, notes.length)) * 100).toFixed(0)}% of notes land on beat/eighth positions (target ≥70%).` } : { score: 0, applicable: true, why: 'Too few notes to evaluate beat alignment.' };
  // 2. Tempo-map alignment: fraction of notes within ±30 ms of the local 1/16 grid slot.
  const tempoOk = notes.filter(n => { const p = msToBeat(map, n.timeMs) * 4; return Math.abs(p - Math.round(p)) * getLocalBeatPeriod(map, n.timeMs) / 4 <= 30; }).length;
  metrics.tempoMapAlignment = notes.length >= 8 ? { score: clp(tempoOk / notes.length / 0.85), applicable: true, why: `${((tempoOk / Math.max(1, notes.length)) * 100).toFixed(0)}% of notes within ±30 ms of tempo-map grid (target ≥85%).` } : { score: 0, applicable: true, why: 'Too few notes to evaluate tempo-map alignment.' };
  // 3. Onset coverage: fraction of strong audio onsets that have a note within ±40 ms.
  const strongOnsets = f.filter((x, i) => { const prev = f[i - 1]?.onset ?? 0; const next = f[i + 1]?.onset ?? 0; return x.onset >= 0.3 && x.onset > prev && x.onset > next; }).map(x => x.timeMs);
  let coveredOnsets = 0;
  for (const ot of strongOnsets) { if (notes.some(n => Math.abs(n.timeMs - ot) <= 40)) coveredOnsets++; }
  metrics.onsetCoverage = strongOnsets.length >= 5 ? { score: clp(coveredOnsets / strongOnsets.length / 0.6), applicable: true, why: `${((coveredOnsets / Math.max(1, strongOnsets.length)) * 100).toFixed(0)}% of strong onsets have a note nearby (target ≥60%).` } : { score: 0, applicable: true, why: 'Too few strong onsets to evaluate coverage.' };
  // 4. Density consistency: coefficient of variation of per-section NPS.
  const secs = (chart.generator?.sections || []).filter(s => s.endMs - s.startMs >= 1000);
  if (secs.length >= 3) {
    const secNps = secs.map(s => notes.filter(n => n.timeMs >= s.startMs && n.timeMs < s.endMs).length / ((s.endMs - s.startMs) / 1000));
    const meanNps = secNps.reduce((a, b) => a + b, 0) / secNps.length;
    const cv = meanNps > 0 ? Math.sqrt(secNps.reduce((a, v) => a + (v - meanNps) ** 2, 0) / secNps.length) / meanNps : 0;
    metrics.densityConsistency = { score: clp(1 - cv), applicable: true, why: `Per-section NPS coefficient of variation: ${(cv * 100).toFixed(0)}% (lower is more consistent).` };
  } else metrics.densityConsistency = { score: 0, applicable: true, why: 'At least three sections of one second or longer are required.' };
  // 5. Lane balance: how evenly notes are distributed across the 4 lanes.
  const laneCounts = [0, 0, 0, 0];
  for (const n of notes) { if (n.lane >= 0 && n.lane < 4) laneCounts[n.lane]++; }
  const meanLane = notes.length / 4;
  const laneDev = meanLane > 0 ? laneCounts.reduce((a, c) => a + Math.abs(c - meanLane), 0) / 4 / meanLane : 0;
  metrics.laneBalance = notes.length >= 8 ? { score: clp(1 - laneDev), applicable: true, why: `Lane distribution deviation: ${(laneDev * 100).toFixed(0)}% (lower is more balanced).` } : { score: 0, applicable: true, why: 'Too few notes to evaluate lane balance.' };
  // 6. Pattern diversity: unique patterns vs total pattern segments.
  const pats = chart.generator?.patterns || [];
  const uniquePatIds = pats.length ? [...new Set(pats.map(p => p.id))].length : 0;
  metrics.patternDiversity = pats.length >= 3 ? { score: clp(uniquePatIds / Math.min(pats.length, 6)), applicable: true, why: `${uniquePatIds} unique patterns across ${pats.length} pattern segments.` } : { score: 0, applicable: true, why: 'At least three pattern segments are required.' };
  // 7. Repetition: fraction of consecutive same-pattern transitions.
  let repeatTransitions = 0, totalTransitions = 0;
  for (let i = 1; i < pats.length; i++) { totalTransitions++; if (pats[i].id === pats[i - 1].id) repeatTransitions++; }
  metrics.repetition = totalTransitions >= 2 ? { score: clp(1 - repeatTransitions / totalTransitions), applicable: true, why: `${((1 - repeatTransitions / Math.max(1, totalTransitions)) * 100).toFixed(0)}% pattern transition variety.` } : { score: 0, applicable: true, why: 'At least two pattern transitions are required.' };
  // 8. Playability: no impossible jack gaps or overlapping holds.
  const minJackGap = ({ easy: 190, normal: 155, hard: 112, expert: 88 })[chart.metadata?.difficulty] || 155;
  const sorted = notes.slice().sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);
  let playable = 0, totalPlayable = 0;
  const lastTimeByLane = [-1, -1, -1, -1];
  for (const n of sorted) {
    if (n.lane < 0 || n.lane > 3) continue;
    totalPlayable++;
    if (n.timeMs - lastTimeByLane[n.lane] >= minJackGap * 0.7) playable++;
    lastTimeByLane[n.lane] = n.timeMs;
  }
  metrics.playability = totalPlayable >= 8 ? { score: clp(playable / totalPlayable / 0.85), applicable: true, why: `${((playable / Math.max(1, totalPlayable)) * 100).toFixed(0)}% of notes respect minimum jack gaps (target ≥85%).` } : { score: 0, applicable: true, why: 'Too few notes to evaluate playability.' };
  // 9. Accent alignment: strong onsets should align to strong beat/eighth-note positions.
  const sc = notes.map(n => ({ n, o: onsetAt(n.timeMs), a: gridAccent(map, n.timeMs) }));
  const strong = sc.filter(x => x.o >= 0.6);
  if (strong.length >= 8) { const ok = strong.filter(x => x.a >= 0.72).length / strong.length; metrics.accentAlignment = { score: clp(ok / 0.8), applicable: true, why: `${(ok * 100).toFixed(0)}% of notes on strong onsets land on a beat/eighth note (target ≥80%).` }; const bad = strong.filter(x => x.a < 0.3); if (ok < 0.5) issues.push({ severity: 'warning', from: bad[0]?.n.timeMs ?? 0, to: bad.at(-1)?.n.timeMs ?? dur, message: `Many strong-onset notes are off the beat/eighth-note grid (${(ok * 100).toFixed(0)}%).`, suggestion: 'Regenerate this range or verify the BPM/offset.' }); }
  else metrics.accentAlignment = { score: 0, applicable: true, why: 'Too few strong-onset notes to evaluate.' };
  // 10. Transition quality: evaluate playable lane movement at adjacent pattern boundaries.
  const minJackGapT = ({ easy: 190, normal: 155, hard: 112, expert: 88 })[chart.metadata?.difficulty] || 155;
  if (pats.length >= 3) {
    let good = 0, tot = 0;
    for (let i = 1; i < pats.length; i++) {
      const previousPattern = pats[i - 1], nextPattern = pats[i];
      const prevTime = sorted.reduce((best, note) => note.timeMs <= previousPattern.toMs + 1 ? Math.max(best, note.timeMs) : best, -Infinity);
      const nextTime = sorted.reduce((best, note) => note.timeMs >= nextPattern.fromMs - 1 ? Math.min(best, note.timeMs) : best, Infinity);
      if (!Number.isFinite(prevTime) || !Number.isFinite(nextTime) || nextTime < prevTime) continue;
      const prev = sorted.filter(note => note.timeMs === prevTime), next = sorted.filter(note => note.timeMs === nextTime);
      if (!prev.length || !next.length) continue;
      tot++;
      const gap = nextTime - prevTime;
      const jumps = next.map(note => Math.min(...prev.map(source => Math.abs(source.lane - note.lane))));
      const jump = Math.max(...jumps);
      const sameQuickJack = prev.length === 1 && next.length === 1 && prev[0].lane === next[0].lane && gap < minJackGapT;
      const maxAllowed = gap < 160 ? 1 : 2;
      if (jump <= maxAllowed && !sameQuickJack) good++;
      else issues.push({ severity: 'warning', from: prevTime, to: nextTime,
        message: `${fmt(prevTime)}: abrupt ${previousPattern.id} → ${nextPattern.id} transition (${jump}-lane move in ${Math.round(gap)} ms${sameQuickJack ? ', repeated-lane hit' : ''}).`,
        suggestion: 'Move the first event of the next pattern closer to the previous pattern boundary.' });
    }
    metrics.transitionQuality = tot ? { score: good / tot, applicable: true, why: `${good}/${tot} pattern transitions meet the playability limits.` } : { score: 0, applicable: true, why: 'Not enough pattern boundaries to evaluate.' };
  } else metrics.transitionQuality = { score: 0, applicable: true, why: 'This chart has no pattern metadata (legacy generator).' };
  // 11. Section intensity: chart NPS should positively correlate with section energy
  const secs2 = (chart.generator?.sections || []).filter(s => s.endMs - s.startMs >= 2000);
  if (secs2.length >= 3) {
    const xs = secs2.map(s => s.energy), ys = secs2.map(s => notes.filter(n => n.timeMs >= s.startMs && n.timeMs < s.endMs).length / ((s.endMs - s.startMs) / 1000)), mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0), sx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0)), sy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0)), r = sx > 1e-9 && sy > 1e-9 ? sxy / (sx * sy) : 0;
    metrics.sectionIntensity = { score: clp((r + 0.2) / 0.8), applicable: true, why: `Section energy ↔ NPS correlation: r=${r.toFixed(2)} across ${secs2.length} sections.` };
    secs2.forEach((s, i) => { if (s.energy >= 0.7 && ys[i] < my * 0.6 && my > 0.5) issues.push({ severity: 'suggestion', from: s.startMs, to: s.endMs, message: `${fmt(s.startMs)}: high-energy section has sparse notes (${ys[i].toFixed(1)}/s).`, suggestion: 'Regenerate this section with higher density.' }); if (s.energy <= 0.3 && ys[i] > my * 1.5) issues.push({ severity: 'warning', from: s.startMs, to: s.endMs, message: `${fmt(s.startMs)}: low-energy section is too dense (${ys[i].toFixed(1)}/s).`, suggestion: 'Reduce density in this section.' }); });
  } else metrics.sectionIntensity = { score: 0, applicable: true, why: 'At least three sections of two seconds or longer are required.' };
  return { metrics, issues };
}
