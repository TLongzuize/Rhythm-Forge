import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSamples, demoAnalysis, validateChart } from '../core.js';
import { buildTempoMap, getNearestBeat } from '../tempomap.js';
import { fingerprint, cacheKey, createAnalysisCache, memoryStore, ANALYSIS_VERSION } from '../cache.js';
import { setSectionLocked, splitSection, mergeSectionWithNext, renameSection, applySavedSections, lockedRangesFrom } from '../sections.js';
import { generateSmart, regenerateRange, regenerateSection, evaluateChart } from '../smartgen.js';
import { suggestFixes, previewFixes, applyFixes, undoFixes } from '../autofix.js';
import { generateAllSmartAsync, generateSmartAsync } from '../genclient.js';
import { synthClicks, synthRamp } from './helpers.js';

const A = demoAnalysis(), sig = c => c.notes.map(n => `${n.timeMs}:${n.lane}:${n.type}:${n.endTimeMs ?? ''}`).join('|');
const beatErr = (a, m) => { const e = a.truth.filter(t => t > 1500 && t < a.durationMs - 500).map(t => getNearestBeat(m, t).errorMs), b = e.reduce((x, y) => x + y, 0) / e.length, j = e.map(x => Math.abs(x - b)); return { mean: j.reduce((x, y) => x + y, 0) / j.length, max: Math.max(...j) }; };

/* ---- tempo đổi dần / đột ngột ---- */
for (const [name, o, dir] of [['tăng dần 100→140', { bpm0: 100, bpm1: 140, ms: 60000 }, 1], ['giảm dần 140→100', { bpm0: 140, bpm1: 100, ms: 60000 }, -1]]) test(`tempo ${name}: BPM đơn điệu, đánh dấu gradual, lỗi beat có giới hạn`, () => {
  const a = synthRamp(o), m = buildTempoMap(analyzeSamples(a.samples, a.sr)), s = m.segments, e = beatErr(a, m);
  assert.ok(s.length >= 4, `chỉ ${s.length} đoạn`); assert.ok(m.gradual && s.every(x => x.gradual));
  for (let i = 1; i < s.length; i++) assert.ok((s[i].bpm - s[i - 1].bpm) * dir > -2, `không đơn điệu tại ${i}`);
  assert.ok((s.at(-1).bpm - s[0].bpm) * dir > 25, `thay đổi quá nhỏ ${s[0].bpm}→${s.at(-1).bpm}`);
  assert.ok(Math.abs(s[0].bpm - o.bpm0) < 8 && Math.abs(s.at(-1).bpm - o.bpm1) < 8);
  assert.ok(e.mean < 35 && e.max < 80, `mean ${e.mean} max ${e.max}`);
});
test('tempo đột ngột 100→160: đúng 2 đoạn, không gắn gradual, ranh giới chính xác', () => {
  const a = synthClicks({ segments: [{ bpm: 100, ms: 30000 }, { bpm: 160, ms: 30000 }], startMs: 100 }), m = buildTempoMap(analyzeSamples(a.samples, a.sr));
  assert.equal(m.segments.length, 2); assert.ok(!m.gradual); assert.ok(Math.abs(m.segments[1].startTime - 30100) < 2500); assert.ok(beatErr(a, m).max < 10);
});

/* ---- cache ---- */
test('fingerprint: ổn định, đổi khi nội dung/độ dài đổi; cache key phụ thuộc cấu hình', () => {
  const a = new Uint8Array(5000).map((_, i) => i * 7 & 255), b = a.slice(); b[4999] ^= 1;
  assert.equal(fingerprint(a), fingerprint(a.slice())); assert.notEqual(fingerprint(a), fingerprint(b)); assert.notEqual(fingerprint(a), fingerprint(a.subarray(0, 4999)));
  const fp = fingerprint(a); assert.notEqual(cacheKey(fp, { x: 1 }), cacheKey(fp, { x: 2 })); assert.equal(cacheKey(fp, { a: 1, b: 2 }), cacheKey(fp, { b: 2, a: 1 }));
});
test('cache: lưu/đọc, từ chối analysis hỏng, xóa mục lỗi thời, LRU', async () => {
  const warns = [], c = createAnalysisCache({ store: memoryStore(), maxEntries: 2, warn: (...x) => warns.push(x) }), k = i => cacheKey('fp' + i, {});
  assert.equal(await c.set(k(0), { bpm: 0 }), false); assert.ok(c.errors.length === 1);
  for (let i = 1; i <= 3; i++) { assert.equal(await c.set(k(i), { ...A }), true); await new Promise(r => setTimeout(r, 3)); }
  assert.equal(await c.get(k(1)), null); assert.ok(await c.get(k(3))); assert.ok(await c.get(k(2)));
  const st = memoryStore(), c2 = createAnalysisCache({ store: st, warn: () => {} }); await st.set(k(9), { key: k(9), version: '0.0', analysis: A }); assert.equal(await c2.get(k(9)), null); assert.equal(await st.get(k(9)), undefined);
  assert.ok(ANALYSIS_VERSION);
});
test('cache: store lỗi → fallback bộ nhớ, lỗi được ghi nhận (không nuốt im lặng)', async () => {
  const bad = { kind: 'bad', get: async () => { throw new Error('boom'); }, set: async () => { throw new Error('boom'); }, delete: async () => {}, keys: async () => [], clear: async () => {} }, warns = [];
  const c = createAnalysisCache({ store: bad, warn: (...x) => warns.push(x) }), key = cacheKey('z', {});
  assert.equal(await c.set(key, { ...A }), true); assert.ok(await c.get(key)); assert.ok(c.errors.some(e => e.message === 'boom') && warns.length);
  const none = createAnalysisCache({ store: null }); assert.equal(none.kind, 'memory'); assert.equal(await none.set(key, { ...A }), true);
});

/* ---- section sửa/khóa ---- */
const S = () => [{ id: 's0', startMs: 0, endMs: 10000, energy: .3, activity: .3, rhythmicDensity: .3, confidence: .8, label: 'Low Energy' }, { id: 's1', startMs: 10000, endMs: 20000, energy: .9, activity: .8, rhythmicDensity: .8, confidence: .8, label: 'High Energy' }];
test('section: khóa/tách/ghép/đổi tên có kiểm tra, không đột biến input', () => {
  const s = S(), l = setSectionLocked(s, 's1'); assert.equal(s[1].locked, undefined); assert.deepEqual(lockedRangesFrom(l), [{ from: 10000, to: 20000 }]);
  assert.throws(() => splitSection(l, 's1', 15000), /locked/i); assert.throws(() => splitSection(s, 's0', 100), /500 ms/);
  const sp = splitSection(s, 's0', 4000); assert.equal(sp.length, 3); assert.equal(sp[0].endMs, 4000);
  assert.equal(mergeSectionWithNext(sp, 's0a').length, 2); assert.throws(() => mergeSectionWithNext(l, 's0'), /locked/i);
  assert.equal(renameSection(s, 's0', 'Intro').find(x => x.id === 's0').label, 'Intro'); assert.throws(() => renameSection(s, 'nope', 'x'), /not found/i);
});
test('section đã sửa/khóa không bị phân tích mới ghi đè', () => {
  const det = [{ id: 'd0', startMs: 0, endMs: 8000, energy: .5, label: 'Medium Energy' }, { id: 'd1', startMs: 8000, endMs: 24000, energy: .5, label: 'Medium Energy' }], saved = [{ ...S()[1], startMs: 6000, endMs: 14000, locked: true, userEdited: true }];
  const r = applySavedSections(det, saved), k = r.find(x => x.locked); assert.deepEqual([k.startMs, k.endMs, k.label], [6000, 14000, 'High Energy']);
  for (let i = 1; i < r.length; i++) assert.ok(r[i].startMs >= r[i - 1].endMs - 1, 'section chồng lấn'); assert.equal(new Set(r.map(x => x.id)).size, r.length);
});
test('baseChart + section khóa: note trong vùng khóa giữ nguyên tuyệt đối khi tạo lại với seed khác', () => {
  const base = generateSmart(A, 't', { difficulty: 'hard', seed: 1 }).chart, locked = [{ id: 'sec-x', startMs: 8000, endMs: 14000, energy: .5, locked: true, userEdited: true, label: 'Locked' }];
  const out = generateSmart(A, 't', { difficulty: 'hard', seed: 99, baseChart: base, sections: locked }).chart, pick = (c, f) => c.notes.filter(f).map(n => `${n.timeMs}:${n.lane}:${n.type}`).join();
  assert.equal(pick(out, n => n.timeMs >= 8000 && n.timeMs <= 14000), pick(base, n => n.timeMs >= 8000 && n.timeMs <= 14000));
  assert.notEqual(pick(out, n => n.timeMs < 8000), pick(base, n => n.timeMs < 8000)); assert.ok(out.generator.sectionEdits.some(s => s.locked)); assert.ok(validateChart(out).valid);
  const again = generateSmart(A, 't', { difficulty: 'hard', seed: 99, baseChart: out }).chart; assert.equal(sig(again), sig(out)); // sectionEdits được lưu trong chart và tự áp dụng lại
});
test('section có startBeat/endBeat/measure và regenerateSection tôn trọng khóa', () => {
  const c = generateSmart(A, 't', { difficulty: 'normal', seed: 3 }).chart, s0 = c.generator.sections[0];
  assert.ok(Number.isFinite(s0.startBeat) && s0.endBeat > s0.startBeat && Number.isInteger(s0.startMeasure));
  const id = c.generator.sections[1].id, out = regenerateSection(c, A, 't', id, { seed: 5 }), s = c.generator.sections[1];
  assert.equal(out.notes.filter(n => n.timeMs < s.startMs || n.timeMs >= s.endMs).map(n => n.id).join(), c.notes.filter(n => n.timeMs < s.startMs || n.timeMs >= s.endMs).map(n => n.id).join());
  const lk = { ...c, generator: { ...c.generator, sectionEdits: setSectionLocked(c.generator.sections, id) } }; assert.throws(() => regenerateSection(lk, A, 't', id), /locked/i);
  assert.throws(() => regenerateSection(c, A, 't', 'zzz'), /not found/i); assert.throws(() => regenerateRange(c, A, 't', { from: 5, to: 5 }), /invalid/i);
  const lr = regenerateRange(lk, A, 't', { from: 0, to: A.durationMs, seed: 8 }); assert.equal(lr.notes.filter(n => n.timeMs >= s.startMs && n.timeMs < s.endMs).map(n => n.id).join(), c.notes.filter(n => n.timeMs >= s.startMs && n.timeMs < s.endMs).map(n => n.id).join());
});

/* ---- metric mới ---- */
test('metric mới (accent/transition/sectionIntensity) có công thức thật: đổi theo chart', () => {
  const c = generateSmart(A, 't', { difficulty: 'hard', seed: 4 }).chart, q = c.quality.metrics;
  for (const k of ['accentAlignment', 'transitionQuality', 'sectionIntensity']) { assert.ok(q[k] && q[k].score >= 0 && q[k].score <= 1 && q[k].why, k); }
  assert.ok(q.accentAlignment.applicable && q.transitionQuality.applicable);
  const rnd = (() => { let s = 7; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
  const bad = { ...c, notes: c.notes.map(n => ({ ...n, timeMs: n.timeMs + 40 + Math.floor(rnd() * 60), lane: Math.floor(rnd() * 4) })), generator: { ...c.generator } }, qb = evaluateChart(bad, A);
  assert.ok(qb.metrics.accentAlignment.score < q.accentAlignment.score, 'accent phải giảm khi note lệch lưới');
  assert.ok(qb.metrics.transitionQuality.score < q.transitionQuality.score + 1e-9 && qb.overall < c.quality.overall);
  const inv = [1, 2, 3].map(() => evaluateChart({ ...c, generator: { ...c.generator, sections: [] } }, A)); assert.equal(inv[0].metrics.sectionIntensity.applicable, false);
});

/* ---- auto-fix preview/undo ---- */
test('autofix: đề xuất → preview (không đổi chart) → áp dụng → undo khôi phục chính xác; không chạm note manual/vùng khóa', () => {
  const mk = (id, t, lane, extra = {}) => ({ id, timeMs: t, lane, type: 'tap', ...extra });
  const notes = [mk('h', 1000, 0, { type: 'hold', endTimeMs: 2500 }), mk('x', 1800, 0), mk('hm', 5000, 1, { type: 'hold', endTimeMs: 6500, manual: true }), mk('y', 5600, 2, { manual: true }),
    ...Array.from({ length: 12 }, (_, i) => mk(`j${i}`, 8000 + i * 120, 2)), mk('bad', 9999999, 1), ...Array.from({ length: 14 }, (_, i) => mk(`d${i}`, 12000 + i * 70, i % 4))];
  const chart = { chartId: 'c1', metadata: { difficulty: 'normal', audioDurationMs: 20000 }, notes, generator: { lockedRanges: [{ from: 12000, to: 12300 }] } }, an = { ...A, durationMs: 20000 }, snap = JSON.stringify(chart);
  const fixes = suggestFixes(chart, an), kinds = new Set(fixes.map(f => f.kind)); for (const k of ['fix-hold-overlap', 'break-jack', 'remove-invalid', 'reduce-density']) assert.ok(kinds.has(k), k + ' ' + [...kinds]);
  const pv = previewFixes(chart, an, fixes); assert.equal(JSON.stringify(chart), snap); assert.ok(pv.after.noteCount < pv.before.noteCount);
  const r = applyFixes(chart, an, fixes); assert.equal(JSON.stringify(chart), snap);
  assert.ok(r.chart.notes.find(n => n.id === 'hm').endTimeMs === 6500 && r.chart.notes.some(n => n.id === 'y')); assert.ok(!r.chart.notes.some(n => n.id === 'bad'));
  assert.ok(['d0', 'd1', 'd2', 'd3', 'd4'].every(id => r.chart.notes.some(n => n.id === id) || !(chart.notes.find(x => x.id === id).timeMs <= 12300)), 'vùng khóa bị chạm');
  const h = r.chart.notes.find(n => n.id === 'h'); assert.ok(!h.endTimeMs || h.endTimeMs < 1800);
  const back = undoFixes(r.chart, r.undo); assert.equal(JSON.stringify(back.notes), JSON.stringify(chart.notes));
  assert.throws(() => undoFixes({ ...r.chart, chartId: 'other' }, r.undo), /different chart/i); assert.throws(() => undoFixes(r.chart, null), /invalid/i);
});

/* ---- subdivision mở rộng ---- */
test('triplet: click theo triplet 120 BPM → Hard tạo note trên ô triplet (có bằng chứng onset), Easy/Normal thì không', () => {
  const sr = 22050, dur = 40000, x = new Float32Array(dur / 1000 * sr), p = 500;
  const clk = (t, g) => { const i0 = Math.round(t / 1000 * sr); for (let i = 0; i < 660 && i0 + i < x.length; i++) x[i0 + i] += g * Math.sin(2 * Math.PI * 1000 * i / sr) * Math.exp(-i / (.006 * sr)); };
  for (let b = 0; b * p < dur - 200; b++) { clk(300 + b * p, 1); clk(300 + b * p + p / 3, .8); clk(300 + b * p + 2 * p / 3, .8); }
  const an = analyzeSamples(x, sr), hard = generateSmart(an, 't', { difficulty: 'expert', seed: 3 }).chart, easy = generateSmart(an, 't', { difficulty: 'easy', seed: 3 }).chart;
  assert.ok(validateChart(hard).valid); assert.equal(easy.generator.subdivisionUsage?.triplet ?? 0, 0);
  assert.ok(hard.generator.subdivisionUsage && hard.generator.subdivisionUsage.triplet > 5, JSON.stringify(hard.generator.subdivisionUsage));
});

/* ---- Worker client (Node không có Worker → fallback luồng chính, kết quả y hệt) ---- */
test('genclient: fallback luồng chính cho kết quả giống hệt bản đồng bộ', async () => {
  const { generateAllSmart, generateSmart: g1 } = await import('../smartgen.js');
  const a = await generateAllSmartAsync(A, 't', 11, { mode: 'melodic' }), b = generateAllSmart(A, 't', 11, { mode: 'melodic' });
  assert.equal(a.map(c => sig(c.chart)).join('#'), b.map(c => sig(c.chart)).join('#'));
  assert.equal(sig((await generateSmartAsync(A, 't', { difficulty: 'hard', seed: 2 })).chart), sig(g1(A, 't', { difficulty: 'hard', seed: 2 }).chart));
});

/* ---- 3 kịch bản còn thiếu: dense electronic, ambient, near-silence ---- */
import { rhythmicEvidence } from '../tempomap.js';
const SR = 22050, lcg = (s => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - .5) * 2)(11);
const denseElectronic = (bpm = 140, sec = 40) => { const x = new Float32Array(SR * sec), p = 60000 / bpm; for (let b = 0; b * p / 4 < sec * 1000 - 300; b++) { const i0 = Math.round(b * p / 4 / 1000 * SR), kick = b % 4 === 0, snare = b % 4 === 2, n = Math.round((kick ? .12 : .03) * SR); for (let i = 0; i < n && i0 + i < x.length; i++) x[i0 + i] += kick ? .9 * Math.sin(2 * Math.PI * (120 - 50 * Math.min(1, i / (.05 * SR))) * i / SR) * Math.exp(-i / (.02 * SR)) : (snare ? .5 : .18) * lcg() * Math.exp(-i / (.004 * SR)); } for (let i = 0; i < x.length; i++) x[i] += .15 * Math.sin(2 * Math.PI * 220 * i / SR) * Math.sin(2 * Math.PI * .25 * i / SR); return x; };
const ambient = (sec = 40) => { const x = new Float32Array(SR * sec); for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] = .05 * (Math.sin(2 * Math.PI * 110 * t) * (.6 + .4 * Math.sin(2 * Math.PI * .07 * t)) + .7 * Math.sin(2 * Math.PI * 165 * t)); } return x; };
const hiss = (sec, amp) => { const x = new Float32Array(SR * sec); if (amp) for (let i = 0; i < x.length; i++) x[i] = amp * lcg(); return x; };
test('dense electronic 140 BPM (16th hi-hat + kick/snare): tempo map đúng, chart hợp lệ, đủ note', () => {
  const an = analyzeSamples(denseElectronic(), SR), m = buildTempoMap(an); assert.ok(rhythmicEvidence(an).hasRhythm); assert.ok(!m.lowConfidence);
  assert.ok(Math.abs(m.segments[0].bpm - 140) < 3 && m.segments[0].confidence > .5, `bpm ${m.segments[0].bpm}`);
  const c = generateSmart(an, 't', { difficulty: 'hard', seed: 2 }).chart; assert.ok(validateChart(c).valid); assert.ok(c.notes.length > 60);
  assert.ok(c.quality.metrics.tempoMapAlignment.score > .9, c.quality.metrics.tempoMapAlignment.why);
});
test('ambient không có percussion: confidence bị hạ ≤0.1, không bịa note, có cảnh báo', () => {
  const an = analyzeSamples(ambient(), SR), m = buildTempoMap(an), r = generateSmart(an, 't', { difficulty: 'normal', seed: 1 }).chart;
  assert.equal(rhythmicEvidence(an).hasRhythm, false); assert.ok(m.lowConfidence && m.segments.every(s => s.confidence <= .1));
  assert.equal(r.notes.length, 0); assert.ok(r.quality.issues.some(i => /almost no reliable rhythmic events/i.test(i.message)));
});
test('im lặng tuyệt đối và gần im lặng (nhiễu −62 dB): không crash, không note, confidence thấp', () => {
  for (const x of [hiss(20, 0), hiss(20, .0008)]) { const an = analyzeSamples(x, SR), m = buildTempoMap(an), r = generateSmart(an, 't', { difficulty: 'hard', seed: 1 }).chart; assert.ok(m.segments.every(s => s.confidence <= .1)); assert.equal(r.notes.length, 0); assert.ok(Number.isFinite(r.quality.overall)); }
});
test('click rất nhỏ (biên độ 2%) vẫn có bằng chứng nhịp và có note (onset chuẩn hóa)', () => {
  const an = analyzeSamples(denseElectronic().map(v => v * .02), SR); assert.ok(rhythmicEvidence(an).hasRhythm); assert.ok(generateSmart(an, 't', { difficulty: 'normal', seed: 1 }).chart.notes.length > 20);
});

test('analysis.bpm và metadata.bpm thống nhất ở 160 BPM; bpmOverride của người dùng được tôn trọng', () => {
  const a = synthClicks({ segments: [{ bpm: 160, ms: 40000 }], startMs: 230 }), an = analyzeSamples(a.samples, a.sr), c = generateSmart(an, 't', { difficulty: 'normal', seed: 1 }).chart;
  assert.ok(Math.abs(an.bpm - 160) < 2, `analysis.bpm ${an.bpm}`); assert.ok(Math.abs(c.metadata.bpm - 160) < 2, `metadata.bpm ${c.metadata.bpm}`); assert.ok(validateChart(c).valid);
  const o = generateSmart(an, 't', { difficulty: 'normal', seed: 1, bpmOverride: 80 }).chart; assert.equal(o.metadata.bpm, 80); assert.equal(o.generator.bpmCorrection, undefined);
  const ok = synthClicks({ segments: [{ bpm: 120, ms: 40000 }], startMs: 230 }), c2 = generateSmart(analyzeSamples(ok.samples, ok.sr), 't', { difficulty: 'normal', seed: 1 }).chart; assert.equal(c2.generator.bpmCorrection, undefined);
});
test('syncopated 3-3-3-3-2-2 ở nền 120 BPM: tempo map không khóa nhầm vào triplet alias', () => {
  const sr = 22050, x = new Float32Array(sr * 40), steps = [1, 0, 0, .8, 0, 0, .8, 0, 0, .8, 0, 0, 1, 0, .7, 0], p = 125;
  for (let k = 0; k * p < 39700; k++) if (steps[k % 16]) { const i0 = Math.round((200 + k * p) / 1000 * sr); for (let i = 0; i < 660 && i0 + i < x.length; i++) x[i0 + i] += steps[k % 16] * Math.sin(2 * Math.PI * 1000 * i / sr) * Math.exp(-i / (.006 * sr)); }
  const an = analyzeSamples(x, sr), map = buildTempoMap(an), c = generateSmart(an, 't', { difficulty: 'hard', seed: 1 }).chart; assert.ok(validateChart(c).valid); assert.ok(c.notes.length > 30); assert.ok(Math.abs(an.bpm - 120) < 3, `analysis ${an.bpm}`); assert.ok(Math.abs(map.segments[0].bpm - 120) < 3, `map ${map.segments[0].bpm}`);
});
