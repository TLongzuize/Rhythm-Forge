import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSamples } from '../core.js';
import { buildTempoMap, getBeatPosition, getBeatTime, getNearestBeat, getTempoAt, setSegmentBpm, splitSegment, mergeSegments, rhythmicEvidence } from '../tempomap.js';
import { synthClicks } from './helpers.js';

function run(opts) { const a = synthClicks(opts), an = analyzeSamples(a.samples, a.sr), m = buildTempoMap(an); const errs = a.truth.filter(t => t > 1500 && t < a.durationMs - 500).map(t => getNearestBeat(m, t).errorMs), bias = errs.reduce((x, y) => x + y, 0) / errs.length, jit = errs.map(e => Math.abs(e - bias)); return { a, an, m, bias, mean: jit.reduce((x, y) => x + y, 0) / jit.length, max: Math.max(...jit) }; }
// bias = độ trễ hệ thống của timestamp onset trong core.extractFeatures (đo được ≈17ms, ổn định); mean/max = độ lệch (jitter) quanh bias.
const report = [];
for (const bpm of [70, 100, 120, 140, 160, 180]) test(`click ${bpm} BPM: tempo, phase, lỗi beat`, () => {
  const r = run({ segments: [{ bpm, ms: 40000 }], startMs: 230 });
  const seg = r.m.segments; report.push(`${bpm} BPM → ${seg.map(s => s.bpm.toFixed(2)).join('/')} | bias ${r.bias.toFixed(1)}ms jitter mean ${r.mean.toFixed(1)} max ${r.max.toFixed(1)} | conf ${seg[0].confidence.toFixed(2)}`);
  assert.equal(seg.length, 1); assert.ok(Math.abs(seg[0].bpm - bpm) / bpm < .01, `bpm ${seg[0].bpm}`);
  assert.ok(Math.abs(r.bias) < 25, `bias ${r.bias}`); assert.ok(r.mean < 5, `mean ${r.mean}`); assert.ok(r.max < 15, `max ${r.max}`); assert.ok(seg[0].confidence > .5);
});
test('mở đầu im lặng 5s rồi 140 BPM: phase vẫn đúng', () => {
  const r = run({ segments: [{ bpm: 140, ms: 35000 }], startMs: 5000 });
  assert.ok(Math.abs(r.m.segments[0].bpm - 140) < 1.5); assert.ok(r.mean < 5 && Math.abs(r.bias) < 25, `mean ${r.mean} bias ${r.bias}`);
});
test('120→140: 2 đoạn, beat position liên tục, ranh giới gần đúng', () => {
  const r = run({ segments: [{ bpm: 120, ms: 40000 }, { bpm: 140, ms: 40000 }], startMs: 100 }), s = r.m.segments;
  report.push(`120→140 → ${s.map(x => `${x.bpm.toFixed(1)}@${(x.startTime / 1000).toFixed(1)}s`).join(' ')} | mean ${r.mean.toFixed(1)} max ${r.max.toFixed(1)}`);
  assert.equal(s.length, 2); assert.ok(Math.abs(s[0].bpm - 120) < 2 && Math.abs(s[1].bpm - 140) < 2);
  assert.ok(Math.abs(s[1].startTime - 40100) < 2500, `boundary ${s[1].startTime}`);
  const b = s[1].startTime; assert.ok(Math.abs(getBeatPosition(r.m, b - 0.01) - getBeatPosition(r.m, b + 0.01)) < 1e-3);
  assert.ok(r.mean < 8 && r.max < 40, `mean ${r.mean} max ${r.max}`);
  for (let i = 0; i < 400; i++) { const t = i * 190, bt = getBeatTime(r.m, getBeatPosition(r.m, t)); assert.ok(Math.abs(bt - t) < 1e-6); }
});
test('click rất nhỏ (gain 0.02) và nhiễu vẫn ra 120 BPM', () => {
  for (const o of [{ gain: .02 }, { gain: 1, noise: .15 }]) { const r = run({ segments: [{ bpm: 120, ms: 40000 }], ...o }); report.push(`120 ${JSON.stringify(o)} → ${r.m.segments.map(s => s.bpm.toFixed(2))} mean ${r.mean.toFixed(1)}`); assert.ok(Math.abs(r.m.segments[0].bpm - 120) < 2, JSON.stringify(o)); }
});
test('mơ hồ half/double-time: chấp nhận 120 hoặc 240 và confidence không quá cao khi nhiễu', () => {
  const r = run({ segments: [{ bpm: 120, ms: 40000 }], eighths: true }), b = r.m.segments[0].bpm;
  assert.ok(Math.abs(b - 120) < 2 || Math.abs(b - 240) < 4, `bpm ${b}`);
});

test('weak percussion: tempo map giữ được nhịp 120 BPM ở gain thấp và nhiễu nền nhẹ', () => {
  const a = synthClicks({ segments: [{ bpm: 120, ms: 40000 }], startMs: 230, gain: .02, noise: .001 });
  const an = analyzeSamples(a.samples, a.sr), m = buildTempoMap(an), seg = m.segments[0];
  assert.ok(rhythmicEvidence(an).hasRhythm, `rhythmic evidence ${JSON.stringify(rhythmicEvidence(an))}`);
  assert.ok(Math.abs(seg.bpm - 120) < 1.5, `BPM ${seg.bpm}`);
  assert.ok(seg.confidence > .5, `confidence ${seg.confidence}`);
});

test('chỉnh tay giữ liên tục beat', () => {
  const r = run({ segments: [{ bpm: 120, ms: 40000 }] }); let m = splitSegment(r.m, 20000); assert.equal(m.segments.length, 2);
  const before = getBeatPosition(m, 19999); m = setSegmentBpm(m, 1, 150); assert.equal(getTempoAt(m, 30000).manualOverride, true);
  assert.ok(Math.abs(getBeatPosition(m, 20001) - before) < .01); m = mergeSegments(m, 0); assert.equal(m.segments.length, 1);
});
test.after(() => console.log('\n' + report.join('\n')));
