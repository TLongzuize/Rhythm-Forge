import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePlay, normalizePerformanceEvents, updatePlayerSkillProfile, comparePerformances } from '../performance-analysis.js';

const makeEvents = (n, error = 0) => Array.from({ length: n }, (_, i) => ({ id: String(i), noteId: String(i), expectedTimeMs: i * 125, actualTimeMs: i * 125 + error, lane: i % 4, type: i % 13 === 0 ? 'hold-head' : 'tap', judgement: Math.abs(error) < 10 ? 'marvelous' : 'great', combo: i + 1, difficulty: 'normal' }));

test('normalises signed hit error as actual minus expected', () => {
  const events = normalizePerformanceEvents([{ expectedTimeMs: 100, actualTimeMs: 92, lane: 0 }]);
  assert.equal(events[0].hitErrorMs, -8);
});

test('analyses accuracy, timing, lane splits and evidence confidence without fake samples', () => {
  const analysis = analyzePlay({ events: makeEvents(80, -7), maxCombo: 80, maxPossibleCombo: 80, chartMetadata: { difficulty: 'normal', difficultyRating: 4 } });
  assert.equal(analysis.summary.sampleSize, 80);
  assert.equal(analysis.timing.overall.meanMs, -7);
  assert.equal(analysis.timing.overall.bias, 'early');
  assert.equal(Object.keys(analysis.lanes.lanes).length, 4);
  assert.equal(analysis.skills.hold.status, 'insufficient-data');
  assert.ok(analysis.rating.value > 0);
});

test('insufficient evidence does not produce a performance rating or recommendations', () => {
  const analysis = analyzePlay({ events: makeEvents(3), maxCombo: 3, maxPossibleCombo: 3 });
  assert.equal(analysis.rating.status, 'insufficient-data');
  assert.equal(analysis.timing.overall.sampleSize, 3);
  assert.equal(analysis.recommendations.length, 0);
});

test('profile updates preserve input and aggregate measured skills only', () => {
  const analysis = analyzePlay({ events: makeEvents(80), maxCombo: 80, maxPossibleCombo: 80 });
  const previous = { schemaVersion: 1, plays: 2, skills: {} };
  const next = updatePlayerSkillProfile(previous, analysis);
  assert.equal(previous.plays, 2);
  assert.equal(next.plays, 3);
  assert.ok(next.updatedAt > 0);
});

test('performance comparison returns measurable deltas', () => {
  const a = analyzePlay({ events: makeEvents(40, -5), maxCombo: 40, maxPossibleCombo: 40 });
  const b = analyzePlay({ events: makeEvents(40, 5), maxCombo: 40, maxPossibleCombo: 40 });
  const diff = comparePerformances({ analysis: a }, { analysis: b });
  assert.equal(diff.meanTimingDeltaMs, 10);
});
