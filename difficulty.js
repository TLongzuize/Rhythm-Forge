// Mô hình độ khó: nhiều chiều, không chỉ đếm note.
import { getLocalBeatPeriod } from './tempomap.js';
import { rhythmicLevel } from './beatgrid.js';
export function computeDifficulty(notes, durationMs, map) {
  const ns = notes.slice().sort((a, b) => a.timeMs - b.timeMs), dur = Math.max(1, durationMs) / 1000, times = [...new Set(ns.map(n => n.timeMs))];
  const win = (w) => { let mx = 0, j = 0; for (let i = 0; i < times.length; i++) { while (times[i] - times[j] > w) j++; mx = Math.max(mx, (i - j + 1) / (w / 1000)); } return mx; };
  const nps = ns.length / dur, peak = win(1000), burst = win(2000);
  const gaps = times.slice(1).map((t, i) => t - times[i]), avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const chord = 1 - times.length / Math.max(1, ns.length), hold = ns.filter(n => n.type === 'hold').length / Math.max(1, ns.length);
  const single = ns.filter((n, i) => i === 0 || n.timeMs !== ns[i - 1].timeMs); let jack = 0, trans = 0;
  for (let i = 1; i < single.length; i++) { const g = single[i].timeMs - single[i - 1].timeMs; if (single[i].lane === single[i - 1].lane && g < 260) jack++; trans += Math.abs(single[i].lane - single[i - 1].lane); }
  const jackI = jack / Math.max(1, single.length), transC = trans / Math.max(1, single.length - 1) / 3;
  let sub = 0; if (map) { const lv = ns.map(n => rhythmicLevel(map, n.timeMs)); sub = lv.filter(x => x >= 4 || x === 0).length / Math.max(1, lv.length); }
  const raw = .55 * nps + .25 * peak + .1 * burst + 3 * chord + 3 * jackI + 1.2 * transC + 1.5 * sub + 1.5 * hold;
  return { rating: +Math.min(10, raw).toFixed(2), nps: +nps.toFixed(2), peakNps: +peak.toFixed(2), burstNps: +burst.toFixed(2), avgIntervalMs: Math.round(avgGap), chordRatio: +chord.toFixed(3), holdRatio: +hold.toFixed(3), jackIntensity: +jackI.toFixed(3), laneTransition: +transC.toFixed(3), subdivisionComplexity: +sub.toFixed(3) };
}
