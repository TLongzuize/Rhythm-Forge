// Additional quality metrics: accent alignment, transition quality, and section intensity (computed from chart and audio data).
import { getBeatPosition, getLocalBeatPeriod } from './tempomap.js';
const clp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const gridAccent = (map, t) => { const bp = getBeatPosition(map, t), per = getLocalBeatPeriod(map, t); for (const [n, a] of [[1, 1], [2, .72], [3, .55], [4, .42]]) { const x = bp * n; if (Math.abs(x - Math.round(x)) * per / n <= 28) return a; } return .12; };
export function extraMetrics(chart, analysis, map, fmt) {
  const notes = chart.notes || [], f = analysis.features || [], hop = f.length > 1 ? (f[1].timeMs - f[0].timeMs) || 10 : 10, dur = analysis.durationMs || 1, metrics = {}, issues = [];
  const onsetAt = t => { let m = 0; const c = Math.round(t / hop); for (let k = -4; k <= 4; k++) m = Math.max(m, f[c + k]?.onset || 0); return m; };
  // 1. Accent alignment: strong onsets should align to strong beat/eighth-note positions.
  const sc = notes.map(n => ({ n, o: onsetAt(n.timeMs), a: gridAccent(map, n.timeMs) })), strong = sc.filter(x => x.o >= .6);
  if (strong.length >= 8) { const ok = strong.filter(x => x.a >= .72).length / strong.length; metrics.accentAlignment = { score: clp(ok / .8), applicable: true, why: `${(ok * 100).toFixed(0)}% of notes on strong onsets land on a beat/eighth note (target ≥80%).` }; const bad = strong.filter(x => x.a < .3); if (ok < .5) issues.push({ severity: 'warning', from: bad[0]?.n.timeMs ?? 0, to: bad.at(-1)?.n.timeMs ?? dur, message: `Many strong-onset notes are off the beat/eighth-note grid (${(ok * 100).toFixed(0)}%).`, suggestion: 'Regenerate this range or verify the BPM/offset.' }); }
  else metrics.accentAlignment = { score: 1, applicable: false, why: 'Too few strong-onset notes to evaluate.' };
  // 2. Transition quality: evaluate playable lane movement at adjacent pattern boundaries.
  const pats = chart.generator?.patterns || [], sorted = notes.slice().sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);
  const minJackGap = ({ easy: 190, normal: 155, hard: 112, expert: 88 })[chart.metadata?.difficulty] || 155;
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
      const sameQuickJack = prev.length === 1 && next.length === 1 && prev[0].lane === next[0].lane && gap < minJackGap;
      const maxAllowed = gap < 160 ? 1 : 2;
      if (jump <= maxAllowed && !sameQuickJack) good++;
      else issues.push({ severity: 'warning', from: prevTime, to: nextTime,
        message: `${fmt(prevTime)}: abrupt ${previousPattern.id} → ${nextPattern.id} transition (${jump}-lane move in ${Math.round(gap)} ms${sameQuickJack ? ', repeated-lane hit' : ''}).`,
        suggestion: 'Move the first event of the next pattern closer to the previous pattern boundary.' });
    }
    metrics.transitionQuality = tot ? { score: good / tot, applicable: true, why: `${good}/${tot} pattern transitions meet the playability limits.` } : { score: 1, applicable: false, why: 'Not enough pattern boundaries to evaluate.' };
  } else metrics.transitionQuality = { score: 1, applicable: false, why: 'This chart has no pattern metadata (legacy generator).' };
  // 3. section intensity: chart NPS should positively correlate with section energy
  const secs = (chart.generator?.sections || []).filter(s => s.endMs - s.startMs >= 2000);
  if (secs.length >= 3) {
    const xs = secs.map(s => s.energy), ys = secs.map(s => notes.filter(n => n.timeMs >= s.startMs && n.timeMs < s.endMs).length / ((s.endMs - s.startMs) / 1000)), mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0), sx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0)), sy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0)), r = sx > 1e-9 && sy > 1e-9 ? sxy / (sx * sy) : 0;
    metrics.sectionIntensity = { score: clp((r + .2) / .8), applicable: true, why: `Section energy ↔ NPS correlation: r=${r.toFixed(2)} across ${secs.length} sections.` };
    secs.forEach((s, i) => { if (s.energy >= .7 && ys[i] < my * .6 && my > .5) issues.push({ severity: 'suggestion', from: s.startMs, to: s.endMs, message: `${fmt(s.startMs)}: high-energy section has sparse notes (${ys[i].toFixed(1)}/s).`, suggestion: 'Regenerate this section with higher density.' }); if (s.energy <= .3 && ys[i] > my * 1.5) issues.push({ severity: 'warning', from: s.startMs, to: s.endMs, message: `${fmt(s.startMs)}: low-energy section is too dense (${ys[i].toFixed(1)}/s).`, suggestion: 'Reduce density in this section.' }); });
  } else metrics.sectionIntensity = { score: 1, applicable: false, why: 'At least three sections of two seconds or longer are required.' };
  return { metrics, issues };
}
