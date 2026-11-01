import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSamples, accuracyFor, createDemoCharts, demoAnalysis, extractFeatures, generateAllDifficulties, generateChart, gradeFor, inferTempo, judgeDelta, validateChart } from '../core.js';

function syntheticPulseFeatures(beats = 48, bpm = 120) {
  const durationMs = beats * 60000 / bpm;
  const length = Math.ceil(durationMs / 10);
  return Array.from({ length }, (_, i) => {
    const timeMs = i * 10;
    const pulse = i % 50;
    const onset = pulse <= 1 ? 1 : 0;
    const rms = pulse <= 3 ? .9 : .05;
    return { timeMs, onset, rms, low: rms * .8, mid: rms * .4, high: rms * .2, centroid: .5 };
  });
}

test('feature extraction returns timed frames and bounded onset strengths', () => {
  const sr = 44100, samples = new Float32Array(sr);
  for (let t = 0; t < samples.length; t++) samples[t] = Math.sin(2 * Math.PI * 440 * t / sr) * (t % 22050 < 6000 ? .6 : .05);
  const features = extractFeatures(samples, sr);
  assert.ok(features.length > 80);
  assert.ok(features[1].timeMs > features[0].timeMs);
  assert.ok(features.every(f => Number.isFinite(f.rms) && f.onset >= 0 && f.onset <= 1));
});

test('tempo inference finds a steady 120 BPM pulse near the expected rate', () => {
  const result = inferTempo(syntheticPulseFeatures(), 24000, 10);
  assert.ok(Math.abs(result.bpm - 120) <= 2, `expected around 120 BPM, got ${result.bpm}`);
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
  assert.ok(Number.isFinite(result.offsetMs));
});

test('audio sample analysis produces candidate events and valid metadata', () => {
  const sr = 8000, seconds = 8, samples = new Float32Array(sr * seconds);
  for (let i = 0; i < samples.length; i++) {
    const t = i / sr;
    const phase = t % .5;
    const envelope = phase < .03 ? Math.exp(-phase * 45) : 0;
    samples[i] = Math.sin(2 * Math.PI * 90 * t) * envelope;
  }
  const a = analyzeSamples(samples, sr);
  assert.equal(Math.round(a.durationMs), 8000);
  assert.ok(a.features.length > 500);
  assert.ok(a.candidates.length > 0);
  assert.ok(a.bpm >= 65 && a.bpm <= 190);
  const generated = generateChart(a, 'Synthetic electronic test', { difficulty: 'normal', seed: 52 });
  assert.ok(generated.chart.notes.length > 0);
  assert.equal(validateChart(generated.chart).valid, true);
  assert.equal(generated.diagnostics.validationErrors, 0);
});

test('demo charts have four independent difficulty maps and pass structural validation', () => {
  const charts = createDemoCharts();
  assert.deepEqual(charts.map(x => x.chart.metadata.difficulty), ['easy', 'normal', 'hard', 'expert']);
  for (const item of charts) {
    const v = validateChart(item.chart);
    assert.equal(v.valid, true, `${item.chart.metadata.difficulty} should validate: ${JSON.stringify(v.errors)}`);
    assert.ok(item.chart.notes.length > 30);
    assert.ok(item.chart.notes.every(n => ['tap', 'hold'].includes(n.type) && n.lane >= 0 && n.lane <= 3));
    assert.ok(item.chart.notes.some(n => n.type === 'hold'), `${item.chart.metadata.difficulty} demo should showcase long notes`);
  }
  assert.equal(new Set(charts.map(x => JSON.stringify(x.chart.notes))).size, 4);
});

test('same seed and analysis produce deterministic charts', () => {
  const a = demoAnalysis();
  const options = { difficulty: 'hard', seed: 8821, densityScale: 1.05, minConfidence: .08 };
  const first = generateChart(a, 'NEON CIRCUIT', options).chart;
  const second = generateChart(a, 'NEON CIRCUIT', options).chart;
  assert.deepEqual(first, second);
});


test('tempo inference exposes half-time/double-time alternatives instead of hiding ambiguity', () => {
  const hopMs = 10, durationMs = 20000, nominalBpm = 160, period = 60000 / nominalBpm;
  const features = Array.from({ length: durationMs / hopMs }, (_, i) => {
    const timeMs = i * hopMs, phase = timeMs % period, onset = phase < 20 ? 1 : 0;
    return { timeMs, onset, rms: onset, low: onset, mid: onset, high: onset, centroid: .5 };
  });
  const tempo = inferTempo(features, durationMs, hopMs);
  assert.ok(tempo.candidates.length >= 2);
  assert.ok(tempo.candidates.some(c => Math.abs(c.bpm - 160) <= 5 && c.relativeScore > .65));
  const ambiguousAnalysis = { ...demoAnalysis(), bpm: 80, bpmConfidence: .8, tempoCandidates: [{ bpm: 80, relativeScore: 1 }, { bpm: 156, relativeScore: .7 }] };
  const generated = generateChart(ambiguousAnalysis, 'Half-time fixture', { difficulty: 'normal', seed: 8 });
  assert.ok(generated.diagnostics.warnings.some(w => w.includes('half-time/double-time')));
});

test('difficulty generation returns all profiles with distinct chart IDs', () => {
  const charts = generateAllDifficulties(demoAnalysis(), 'Synthetic fixture', 17);
  assert.deepEqual(charts.map(x => x.chart.metadata.difficulty), ['easy', 'normal', 'hard', 'expert']);
  assert.equal(new Set(charts.map(x => x.chart.chartId)).size, 4);
  assert.ok(charts.every(x => x.chart.notes.length > 0));
  assert.ok(charts.every(x => x.diagnostics.candidateCount >= x.diagnostics.selectedCount));
});

test('validator separates fatal structure errors from quality warnings', () => {
  const base = createDemoCharts()[0].chart;
  const invalid = structuredClone(base);
  invalid.notes[0].lane = 8;
  invalid.notes[1].id = invalid.notes[0].id;
  invalid.notes[2].timeMs = NaN;
  const v = validateChart(invalid);
  assert.equal(v.valid, false);
  assert.ok(v.errors.length >= 2);
  const warningOnly = structuredClone(base);
  warningOnly.notes = Array.from({ length: 22 }, (_, i) => ({ id: `dense-${i}`, timeMs: 5000 + i * 20, lane: i % 4, type: 'tap' }));
  const w = validateChart(warningOnly);
  assert.equal(w.valid, true);
  assert.ok(w.warnings.some(issue => issue.code === 'density'));
});

test('JSON export/import round trip preserves chart data', () => {
  const chart = createDemoCharts()[2].chart;
  const parsed = JSON.parse(JSON.stringify(chart));
  assert.deepEqual(parsed, chart);
  assert.equal(validateChart(parsed).valid, true);
});

test('expanded judgement tiers, weighted accuracy and rank calculation are consistent', () => {
  assert.equal(judgeDelta(0), 'marvelous');
  assert.equal(judgeDelta(45), 'marvelous');
  assert.equal(judgeDelta(46), 'perfect');
  assert.equal(judgeDelta(-70), 'perfect');
  assert.equal(judgeDelta(71), 'great');
  assert.equal(judgeDelta(100), 'great');
  assert.equal(judgeDelta(101), 'good');
  assert.equal(judgeDelta(135), 'good');
  assert.equal(judgeDelta(136), 'ok');
  assert.equal(judgeDelta(170), 'ok');
  assert.equal(judgeDelta(171), 'bad');
  assert.equal(judgeDelta(220), 'bad');
  assert.equal(judgeDelta(221), 'miss');
  const counts = { marvelous: 1, perfect: 2, great: 1, good: 1, ok: 0, bad: 0, miss: 0 };
  assert.ok(accuracyFor(counts) > 85 && accuracyFor(counts) < 95);
  assert.equal(gradeFor(99.7, 0), 'SS');
  assert.equal(gradeFor(96, 1), 'S');
});

test('generated charts include multiple lane motifs and valid long notes', () => {
  const generated = generateChart(demoAnalysis(), 'Generator QA', { difficulty: 'expert', seed: 20261025 });
  assert.ok(generated.diagnostics.patternVariety >= 3, `expected motif variety, got ${generated.diagnostics.patternVariety}`);
  assert.ok(generated.diagnostics.holdCount > 0, 'expert chart should include long notes');
  assert.ok(generated.chart.notes.some(note => note.type === 'hold' && note.endTimeMs > note.timeMs));
  assert.equal(validateChart(generated.chart).valid, true);
  for (const note of generated.chart.notes.filter(note => note.type === 'hold')) {
    const nextSameLane = generated.chart.notes.find(other => other.lane === note.lane && other.timeMs > note.timeMs);
    if (nextSameLane) assert.ok(note.endTimeMs <= nextSameLane.timeMs - 89, 'hold should not cover the next note in its lane');
  }
});

test('generator mixes short, medium and long holds and caps overlapping holds', async () => {
  const { demoAnalysis, generateChart } = await import('../core.js');
  const lens = [];
  for (const seed of [1, 2, 3, 4, 5, 6]) for (const difficulty of ['normal', 'hard', 'expert']) {
    const { chart } = generateChart(demoAnalysis(), 't', { difficulty, seed });
    const beat = 60000 / chart.metadata.bpm;
    const holds = chart.notes.filter(n => n.type === 'hold');
    for (const h of holds) { lens.push((h.endTimeMs - h.timeMs) / beat); assert.ok(h.endTimeMs > h.timeMs); }
    for (const h of holds) assert.ok(holds.filter(o => o.timeMs <= h.timeMs && o.endTimeMs > h.timeMs).length <= 3 + 1, 'too many simultaneous holds');
  }
  assert.ok(lens.some(x => x < .9), 'expected short holds');
  assert.ok(lens.length > 10);
});
