import test from 'node:test';
import assert from 'node:assert/strict';
import { demoAnalysis, validateChart, generateChart } from '../core.js';
import { generateSmart, generateAllSmart, regenerateRange, analyzeStructure, tempoInterpretations, evaluateChart, MODES, sanitize } from '../smartgen.js';

const A = demoAnalysis();
const sig = c => (c = c.chart || c) && c.notes.map(n => `${n.timeMs}:${n.lane}:${n.type}`).join('|');

test('seed xác định: cùng seed+mode cho cùng chart, khác seed thì khác', () => {
  const a = generateSmart(A, 't', { difficulty: 'hard', seed: 5 }), b = generateSmart(A, 't', { difficulty: 'hard', seed: 5 }), c = generateSmart(A, 't', { difficulty: 'hard', seed: 6 });
  assert.equal(sig(a), sig(b)); assert.notEqual(sig(a), sig(c));
});
test('mọi mode × độ khó cho chart hợp lệ, không chồng hold', () => {
  for (const mode of Object.keys(MODES)) for (const difficulty of ['easy', 'normal', 'hard', 'expert']) {
    const c = generateSmart(A, 't', { difficulty, mode, seed: 9 }).chart;
    assert.ok(c.notes.length > 5, `${mode}/${difficulty} quá ít note`);
    assert.ok(validateChart(c).valid, `${mode}/${difficulty} invalid`);
    assert.equal(c.quality.issues.filter(i => i.severity === 'error').length, 0, `${mode}/${difficulty}`);
  }
});
test('bốn độ khó khác biệt về NPS tăng dần', () => {
  const nps = generateAllSmart(A, 't', 3).map(c => c.chart.quality.meanNps);
  for (let i = 1; i < 4; i++) assert.ok(nps[i] > nps[i - 1], nps.join(','));
});
test('relax thưa hơn technical', () => {
  const r = generateSmart(A, 't', { difficulty: 'hard', mode: 'relax', seed: 2 }).chart, t = generateSmart(A, 't', { difficulty: 'hard', mode: 'technical', seed: 2 }).chart;
  assert.ok(r.notes.length < t.notes.length);
});
test('regenerateRange giữ nguyên ngoài khoảng, vùng khóa và note manual', () => {
  const base = generateSmart(A, 't', { difficulty: 'normal', seed: 1 }).chart;
  base.notes[3] = { ...base.notes[3], manual: true };
  const from = 6000, to = 14000, lockedR = [{ from: 9000, to: 10000 }];
  const out = regenerateRange(base, A, 't', { from, to, seed: 77, locked: lockedR });
  const pick = (c, f) => c.notes.filter(f).map(n => `${n.timeMs}:${n.lane}`).join();
  assert.equal(pick(out, n => n.timeMs < from || n.timeMs > to), pick(base, n => n.timeMs < from || n.timeMs > to));
  assert.equal(pick(out, n => n.timeMs >= 9000 && n.timeMs <= 10000), pick(base, n => n.timeMs >= 9000 && n.timeMs <= 10000));
  assert.ok(out.notes.some(n => n.id === base.notes[3].id) || base.notes[3].timeMs < from || base.notes[3].timeMs > to);
  assert.ok(validateChart(out).valid);
});
test('analyzeStructure & tempoInterpretations trả dữ liệu thật', () => {
  const s = analyzeStructure(A); assert.ok(s.length >= 1);
  for (const x of s) { assert.ok(x.endMs > x.startMs && x.confidence >= 0 && x.confidence <= 1); }
  const t = tempoInterpretations(A); assert.ok(t.some(x => x.kind === 'half-time') && t.some(x => x.kind === 'double-time'));
});
test('evaluator bắt lỗi: lane lặp, hold chồng, timestamp sai', () => {
  const c = generateSmart(A, 't', { difficulty: 'normal', seed: 1 }).chart;
  const broken = { ...c, notes: [...Array.from({ length: 10 }, (_, i) => ({ id: 'j' + i, timeMs: 1000 + i * 120, lane: 0, type: 'tap' })), { id: 'h', timeMs: 5000, lane: 1, type: 'hold', endTimeMs: 6000 }, { id: 'x', timeMs: 5500, lane: 1, type: 'tap' }, { id: 'bad', timeMs: -5, lane: 2, type: 'tap' }] };
  const q = evaluateChart(broken, A);
  assert.ok(q.issues.some(i => /repeat on the same lane/i.test(i.message))); assert.ok(q.issues.some(i => /hold/.test(i.message))); assert.ok(q.issues.some(i => /invalid/i.test(i.message)));
  assert.ok(q.overall <= 50);
});
test('chart cũ (không có generator.*) vẫn đánh giá được; sanitize loại trùng', () => {
  const old = generateChart(A, 't', { difficulty: 'easy', seed: 1 }).chart; assert.ok(evaluateChart(old, A).overall >= 0);
  assert.equal(sanitize([{ id: 'a', timeMs: 100, lane: 1, type: 'tap' }, { id: 'b', timeMs: 100, lane: 1, type: 'tap' }]).length, 1);
});
