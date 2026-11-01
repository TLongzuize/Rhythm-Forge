import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSamples } from '../core.js';
import { buildTempoMap } from '../tempomap.js';
import { buildBeatGrid, quantize, rhythmicLevel } from '../beatgrid.js';
import { generateSmart } from '../smartgen.js';
import { synthClicks } from './helpers.js';

const fixed = (bpm = 120) => ({ durationMs: 20000, segments: [{ startTime: 0, endTime: 20000, bpm, beatPeriod: 60000 / bpm, startBeat: 0, beatPhase: 0, confidence: 1 }] });
test('beat grid: số ô, accent, đo nhịp và khoảng cách đúng', () => {
  const g = buildBeatGrid(fixed(), 0, 4000, { subdivision: 4 }); assert.equal(g.length, 33);
  assert.equal(g[0].accent, 1); assert.equal(g[0].measureIndex, 0); assert.equal(g[16].measureIndex, 1);
  assert.ok(g.every((e, i) => i === 0 || Math.abs(e.time - g[i - 1].time - 125) < 1e-6));
  assert.equal(buildBeatGrid(fixed(), 0, 2000, { subdivision: 3 }).length, 13);               // triplet: 4 beat × 3 + 1
  const sw = buildBeatGrid(fixed(), 0, 1000, { subdivision: 2, swing: 1 }); assert.ok(sw[1].time > 250);   // swing trễ ô lẻ
});
test('quantize thích ứng: snap khi gần, giữ nguyên khi syncopation lệch xa', () => {
  const m = fixed(); assert.deepEqual([quantize(m, 1010).snapped, quantize(m, 1010).time], [true, 1000]);
  assert.equal(quantize(m, 1062).snapped, false);          // lệch 62ms ~ nửa ô 1/16 → giữ nguyên
  assert.equal(rhythmicLevel(m, 1000), 1); assert.equal(rhythmicLevel(m, 1250), 2); assert.equal(rhythmicLevel(m, 1125), 4); assert.equal(rhythmicLevel(m, 1062), 8); assert.equal(rhythmicLevel(m, 1040), 0);
});
test('lưới liên tục qua điểm đổi tempo (không reset phase)', () => {
  const a = synthClicks({ segments: [{ bpm: 120, ms: 30000 }, { bpm: 140, ms: 30000 }] }), m = buildTempoMap(analyzeSamples(a.samples, a.sr)), b = m.segments[1].startTime;
  const g = buildBeatGrid(m, b - 2000, b + 2000, { subdivision: 1 }); const gaps = g.slice(1).map((e, i) => e.time - g[i].time);
  assert.ok(gaps.every(x => x > 400 && x < 520), gaps.join());
});
test('generateSmart trên bài đổi tempo: có metric tempoMapAlignment và chart hợp lệ', () => {
  const a = synthClicks({ segments: [{ bpm: 120, ms: 30000 }, { bpm: 140, ms: 30000 }], startMs: 200 }), an = analyzeSamples(a.samples, a.sr);
  const c = generateSmart(an, 't', { difficulty: 'hard', seed: 3 }).chart, q = c.quality;
  console.log('tempoMapAlignment', q.metrics.tempoMapAlignment.why, '| overall', q.overall);
  assert.ok(c.notes.length > 20); assert.ok(q.metrics.tempoMapAlignment.score >= 0 && q.metrics.tempoMapAlignment.score <= 1);
  const half = (lo, hi) => { const ns = c.notes.filter(n => n.timeMs >= lo && n.timeMs < hi); return ns.length; };
  assert.ok(half(0, 30000) > 5 && half(31000, 60000) > 5);
});
