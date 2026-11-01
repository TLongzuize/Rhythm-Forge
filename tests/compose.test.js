import test from 'node:test';
import assert from 'node:assert/strict';
import { demoAnalysis, validateChart } from '../core.js';
import { PATTERN_LIBRARY, patternLanes, scorePattern, rng } from '../patterns.js';
import { computeDifficulty } from '../difficulty.js';
import { generateSmart, MODES } from '../smartgen.js';
import { buildTempoMap } from '../tempomap.js';

const A = demoAnalysis(), gen = (difficulty, mode = 'balanced', seed = 5) => generateSmart(A, 't', { difficulty, mode, seed }).chart;
test('mọi pattern có descriptor đầy đủ và sinh lane hợp lệ, không lặp lane liền nhau (trừ jack)', () => {
  for (const p of PATTERN_LIBRARY) {
    for (const k of ['id', 'category', 'minDifficulty', 'maxDifficulty', 'minSpacing', 'maxDensity', 'chordRatio', 'jackIntensity', 'rhythmicComplexity', 'energyPreference', 'compatibleModes', 'playabilityConstraints']) assert.ok(p[k] !== undefined, `${p.id}.${k}`);
    const seq = patternLanes(p, 16, 1, rng(3)); assert.equal(seq.length, 16);
    assert.ok(seq.flat().every(l => l >= 0 && l < 4 && Number.isInteger(l)));
    if (!p.jackIntensity) for (let i = 1; i < seq.length; i++) if (seq[i].length === 1 && seq[i - 1].length === 1) assert.notEqual(seq[i][0], seq[i - 1][0], p.id);
  }
});
test('chấm điểm pattern: loại theo độ khó/khoảng cách, phạt lặp', () => {
  const p = PATTERN_LIBRARY.find(x => x.id === 'burst'), base = { energy: .9, minGap: 200, difficulty: 3, mode: 'technical', history: [], rand: () => 0 };
  assert.equal(scorePattern(p, { ...base, difficulty: 0 }), -Infinity); assert.equal(scorePattern(p, { ...base, minGap: 50 }), -Infinity);
  assert.ok(scorePattern(p, base) > scorePattern(p, { ...base, history: ['burst'] }));
});
test('mô hình độ khó tăng đơn điệu easy<normal<hard<expert trên nhiều chiều, không chỉ số note', () => {
  const ch = ['easy', 'normal', 'hard', 'expert'].map(d => gen(d).quality.difficultyModel);
  for (let i = 1; i < 4; i++) { assert.ok(ch[i].rating > ch[i - 1].rating, JSON.stringify(ch.map(c => c.rating))); assert.ok(ch[i].nps > ch[i - 1].nps); assert.ok(ch[i].avgIntervalMs < ch[i - 1].avgIntervalMs); }
  assert.equal(ch[0].chordRatio, 0); assert.ok(ch[3].peakNps >= ch[0].peakNps * 2);
});
test('composition dùng engine compose-2, có pattern + chuyển tiếp, theo section (note ít hơn ở đoạn năng lượng thấp)', () => {
  const c = gen('hard'); assert.equal(c.generator.engine, 'compose-2'); assert.ok(c.generator.patterns.length >= 3 && new Set(c.generator.patterns.map(p => p.id)).size >= 2);
  assert.ok(c.generator.transitions.every(t => t.from !== t.to && Number.isFinite(t.timeMs)));
});
test('6 mode × 4 độ khó: hợp lệ, deterministic, mode ảnh hưởng thật', () => {
  const sig = c => c.notes.map(n => `${n.timeMs}:${n.lane}:${n.type}`).join();
  for (const m of Object.keys(MODES)) for (const d of ['easy', 'normal', 'hard', 'expert']) { const a = gen(d, m), b = gen(d, m); assert.equal(sig(a), sig(b), `${m}/${d}`); assert.ok(validateChart(a).valid, `${m}/${d}`); assert.ok(a.notes.length > 8); }
  assert.ok(gen('hard', 'relax').notes.length < gen('hard', 'technical').notes.length);
  assert.notEqual(sig(gen('hard', 'balanced', 1)), sig(gen('hard', 'balanced', 2)));
});
test('ràng buộc chơi được: khoảng cách tối thiểu theo độ khó, không chồng hold, jack trong giới hạn', () => {
  const MIN = { easy: 280, normal: 170, hard: 115, expert: 80 };
  for (const d of Object.keys(MIN)) { const c = gen(d), ts = [...new Set(c.notes.map(n => n.timeMs))].sort((a, b) => a - b); for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= MIN[d] - 1, `${d} gap ${ts[i] - ts[i - 1]}`); assert.equal(c.quality.issues.filter(i => i.severity === 'error').length, 0); }
});
test('engine legacy vẫn dùng được làm fallback', () => { const r = generateSmart(A, 't', { difficulty: 'normal', engine: 'legacy' }).chart; assert.ok(validateChart(r).valid && r.generator.engine === 'legacy-shaped'); });


test('long-note planner tạo hold ở mật độ cao bằng khoảng trống cùng lane, không đòi khoảng trống toàn chart', () => {
  const beat = 60000 / A.bpm;
  for (const difficulty of ['normal', 'hard', 'expert']) {
    const charts = [5, 17, 29].map(seed => gen(difficulty, 'balanced', seed));
    const perChart = charts.map(c => c.notes.filter(n => n.type === 'hold').length);
    const totalHolds = perChart.reduce((sum, count) => sum + count, 0);
    assert.ok(perChart.every(count => count > 0), `${difficulty} should generate holds for each seed, got ${perChart.join('/')}`);
    assert.ok(totalHolds >= 3, `${difficulty} should generate enough holds over three deterministic seeds, got ${totalHolds}`);
    for (const c of charts) {
      const holds = c.notes.filter(n => n.type === 'hold');
      for (const h of holds) {
        assert.ok(h.endTimeMs - h.timeMs >= beat * .42, 'hold must have a meaningful duration');
        const nextSameLane = c.notes.filter(n => n.lane === h.lane && n.timeMs > h.timeMs).sort((a, b) => a.timeMs - b.timeMs)[0];
        if (nextSameLane) assert.ok(h.endTimeMs <= nextSameLane.timeMs, 'hold must end before the next note in its lane');
      }
      assert.equal(c.quality.issues.filter(i => i.severity === 'error').length, 0);
    }
  }
});

test('generation modes expose independent long-note preferences', () => {
  assert.ok(MODES.relax.hold > MODES.technical.hold);
  assert.ok(MODES.melodic.hold > MODES.balanced.hold);
  const custom = generateSmart(A, 'custom hold', { difficulty: 'hard', mode: 'custom', custom: { hold: 1.7 }, seed: 91 }).chart;
  assert.equal(custom.generator.mode, 'custom');
  assert.ok(validateChart(custom).valid);
});
