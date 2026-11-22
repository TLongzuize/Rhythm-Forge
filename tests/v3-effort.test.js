import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeV3, interpretTimeline } from '../v3/timeline.js';
import { generateV3 } from '../v3/engine.js';
import { effortBudget } from '../v3/effort.js';
import { synthClicks } from './helpers.js';
import { validateChart } from '../core.js';
const { samples, sr } = synthClicks({ segments: [{ bpm: 160, ms: 32000 }], eighths: true, sr: 16000 });
const t = interpretTimeline(analyzeV3(samples, sr));
test('effort explores distinct layouts under fixed difficulty and retains its incumbent', () => {
  let previous = -Infinity;
  for (const effort of ['low', 'medium', 'high', 'ultra', 'max']) {
    const { chart, diagnostics } = generateV3(t, 'Clicks', { effort, difficulty: 'easy' });
    assert.equal(chart.metadata.difficulty, 'easy');
    assert.equal(validateChart(chart).valid, true);
    assert.equal(diagnostics.report.counts.collisions, 0);
    assert.ok(diagnostics.utility >= previous);
    assert.equal(diagnostics.report.counts.chords, 0);
    assert.deepEqual(chart, generateV3(t, 'Clicks', { effort, difficulty: 'easy' }).chart);
    previous = diagnostics.utility;
  }
  assert.ok(effortBudget('max', 20000, 'compact').limit < effortBudget('max', 20000).limit);
});

test('automatic keeps Medium timing and layout with reproducible generation metadata', async () => {
  const { generateV3Set } = await import('../v3/engine.js');
  const analysis = analyzeV3(samples, sr);
  for (const resourceClass of ['standard', 'compact']) {
    const options = { seed: 41, mode: 'technical', densityScale: 0.8, bpmOverride: 160,
      offsetOverrideMs: 35, resourceClass };
    const automatic = generateV3Set(analysis, 'Clicks', { ...options, compositionRevision: 'event-1' });
    const legacy = generateV3Set(analysis, 'Clicks', { ...options, effort: 'medium' });
    automatic.forEach(({chart, diagnostics}, i) => {
      const {policyRevision, generationOptions, ...generator} = chart.generator;
      assert.equal(policyRevision, 'automatic-1');
      assert.deepEqual(generationOptions, {densityScale:0.8, minConfidence:0.1, bpmOverride:160, offsetOverrideMs:35});
      assert.deepEqual({...chart, generator:{...generator, effort:'medium'}}, legacy[i].chart);
      assert.equal(diagnostics.candidates, legacy[i].diagnostics.candidates);
    });
  }
  assert.deepEqual(effortBudget(undefined, 6000, 'standard'), {limit:2, patience:2});
  assert.deepEqual(effortBudget(undefined, 6000, 'compact'), {limit:1, patience:2});
  assert.deepEqual(effortBudget(undefined, 1, 'standard'), {limit:4, patience:2});
});
