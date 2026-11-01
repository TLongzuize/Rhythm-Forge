import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzePlay, analyzeTiming, analyzeLanes, analyzeSkills, analyzeSections,
  analyzePatterns, calculateRFPerformanceRating, generatePracticeRecommendations,
  normalizePerformanceEvents, getPerformanceHistory, migrateLegacyPerformanceRecord,
  updatePlayerSkillProfile,
} from '../performance-analysis.js';

function makeEvents(count, options = {}) {
  const {
    error = 0, judgement = 'marvelous', laneAt = i => i % 4,
    noteTypeAt = () => 'tap', interval = 125, patternAt = () => null,
    errorAt = () => error, judgementAt = () => judgement, actualAt = () => true,
    sectionAt = () => null, difficulty = 'normal', density = 8,
  } = options;
  return Array.from({ length: count }, (_, i) => {
    const expectedTimeMs = i * interval;
    const hitJudgement = judgementAt(i);
    const hasInput = actualAt(i, hitJudgement);
    const actualTimeMs = hasInput ? expectedTimeMs + errorAt(i) : null;
    return {
      id: `n${i}`, noteId: `n${i}`, expectedTimeMs, actualTimeMs,
      hitErrorMs: hasInput ? errorAt(i) : null, lane: laneAt(i),
      noteType: noteTypeAt(i), judgement: hitJudgement, combo: hitJudgement === 'miss' ? 0 : i + 1,
      patternId: patternAt(i), chartSection: sectionAt(i), difficulty, density,
    };
  });
}

test('perfect play reports 100% accuracy, no timing bias and bounded values', () => {
  const result = analyzePlay({ events: makeEvents(100), maxCombo: 100, maxPossibleCombo: 100, chartMetadata: { difficultyRating: 6 } });
  assert.equal(result.summary.accuracy, 100);
  assert.equal(result.timing.overall.bias, 'centred');
  assert.equal(result.summary.total, 100);
  assert.ok(Number.isFinite(result.rating.value));
});

test('consistent early timing is distinguished from random variance', () => {
  const early = analyzeTiming(makeEvents(50, { error: -18 }));
  const noisy = analyzeTiming(makeEvents(50, { errorAt: i => i % 2 ? -35 : 35 }));
  assert.equal(early.overall.bias, 'early');
  assert.equal(early.overall.standardDeviationMs, 0);
  assert.equal(noisy.overall.bias, 'centred');
  assert.ok(noisy.overall.standardDeviationMs > early.overall.standardDeviationMs);
});

test('consistent late timing and early/late percentages are calculated from signed error', () => {
  const timing = analyzeTiming(makeEvents(40, { error: 12 }));
  assert.equal(timing.overall.bias, 'late');
  assert.equal(timing.overall.latePercent, 100);
  assert.equal(timing.overall.earlyPercent, 0);
});

test('timing histogram conserves all timed samples', () => {
  const timing = analyzeTiming(makeEvents(51, { errorAt: i => (i - 25) * 5 })).overall;
  assert.equal(timing.histogram.bins.reduce((sum, bin) => sum + bin.count, 0), timing.sampleSize);
});

test('weak lane detection uses lane-normalised performance, not note count alone', () => {
  const events = makeEvents(80, { laneAt: i => i % 4, judgementAt: i => i % 4 === 2 ? 'good' : 'marvelous' });
  const lanes = analyzeLanes(events);
  assert.equal(lanes.weakLane, 2);
  assert.equal(lanes.lanes[0].total, lanes.lanes[2].total);
});

test('equal lane performance does not invent a weak lane', () => {
  const lanes = analyzeLanes(makeEvents(80));
  assert.equal(lanes.weakLane, null);
  assert.equal(lanes.strongLane, null);
});

test('stream analysis requires continuous observable sequences', () => {
  const events = makeEvents(40, { interval: 120 });
  const skill = analyzeSkills(events).stream;
  assert.equal(skill.status, 'measured');
  assert.ok(skill.sampleSize >= 30);
});

test('jack analysis detects repeated-lane sequences', () => {
  const skill = analyzeSkills(makeEvents(30, { laneAt: () => 1, interval: 150 })).jack;
  assert.equal(skill.status, 'measured');
});

test('chord analysis detects simultaneous multi-lane groups', () => {
  const events = Array.from({ length: 24 }, (_, i) => ({
    id: `c${i}`, expectedTimeMs: Math.floor(i / 2) * 250, actualTimeMs: Math.floor(i / 2) * 250,
    lane: i % 2, noteType: 'tap', judgement: 'marvelous',
  }));
  const skills = analyzeSkills(events);
  assert.equal(skills.chord.status, 'measured');
  assert.ok(skills.evidence.chordGroups >= 10);
});

test('burst analysis detects short high-density sequences', () => {
  const skill = analyzeSkills(makeEvents(30, { interval: 80 })).burst;
  assert.equal(skill.status, 'measured');
});

test('hold skill needs independently observed head and tail judgements', () => {
  const events = [];
  for (let i = 0; i < 6; i++) {
    events.push({ id: `h${i}`, expectedTimeMs: i * 500, actualTimeMs: i * 500, lane: i % 4, noteType: 'hold-head', judgement: 'marvelous' });
    events.push({ id: `t${i}`, expectedTimeMs: i * 500 + 300, actualTimeMs: i * 500 + 300, lane: i % 4, noteType: 'hold-tail', judgement: i === 0 ? 'great' : 'marvelous' });
  }
  const skill = analyzeSkills(events).hold;
  assert.equal(skill.status, 'measured');
  assert.equal(skill.sampleSize, 6);
});

test('section analysis partitions events by expected chart time', () => {
  const sections = analyzeSections(makeEvents(40, { interval: 100 }), [
    { id: 'a', startTimeMs: 0, endTimeMs: 2000, startBeat: 0, endBeat: 16 },
    { id: 'b', startTimeMs: 2000, endTimeMs: 4000, startBeat: 16, endBeat: 32 },
  ]);
  assert.equal(sections.sections[0].noteCount + sections.sections[1].noteCount, 40);
});

test('pattern analysis attributes skill only when chart metadata is present', () => {
  const withTags = analyzePatterns(makeEvents(20, { patternAt: () => 'jackPair' }));
  const withoutTags = analyzePatterns(makeEvents(20));
  assert.equal(withTags.jackPair.occurrenceCount, 20);
  assert.deepEqual(withoutTags, {});
});

test('gradual timing deterioration is observable in rolling windows', () => {
  const events = makeEvents(96, { interval: 100, errorAt: i => i * .35 });
  const result = analyzePlay({ events });
  assert.ok(result.stability.windows.length >= 3);
  assert.ok(result.stability.timingDriftMs > 15);
});

test('sudden accuracy drop appears in progression windows', () => {
  const events = makeEvents(80, { judgementAt: i => i < 40 ? 'marvelous' : 'bad', actualAt: (i, j) => j !== 'miss' });
  const result = analyzePlay({ events });
  assert.ok(result.progression.changePercentagePoints < -50);
  assert.equal(result.progression.possiblePerformanceDeterioration, true);
});

test('miss clusters are counted and recovery is measured from later recorded hits', () => {
  const events = makeEvents(60, { judgementAt: i => i >= 20 && i <= 22 ? 'miss' : 'marvelous', actualAt: (i, j) => j !== 'miss' });
  const result = analyzePlay({ events });
  assert.equal(result.stability.recovery.missEvents, 3);
  assert.equal(result.stability.recovery.recoveredCount, 3);
});

test('short incomplete plays do not produce confident ratings', () => {
  const result = analyzePlay({ events: makeEvents(4), maxCombo: 4, maxPossibleCombo: 100 });
  assert.equal(result.rating.status, 'insufficient-data');
  assert.equal(result.consistency.score, null);
});

test('failed plays remain analyzable without inventing successful combo', () => {
  const result = analyzePlay({ events: makeEvents(40, { judgementAt: i => i % 3 === 0 ? 'miss' : 'great', actualAt: (i, j) => j !== 'miss' }), maxCombo: 2, maxPossibleCombo: 40 });
  assert.ok(result.summary.counts.miss > 0);
  assert.ok(result.rating.value >= 0);
  assert.ok(result.rating.components.combo < 100);
});

test('legacy chart without pattern metadata keeps pattern analysis empty', () => {
  const result = analyzePlay({ events: makeEvents(40), chartMetadata: {} });
  assert.deepEqual(result.patterns, {});
  assert.ok(result.limitations.some(item => item.includes('pattern metadata')));
});

test('legacy results without recorded events preserve summary and expose no invented timing', () => {
  const migrated = migrateLegacyPerformanceRecord({ score: 420000, accuracy: 87.5, grade: 'B', counts: { great: 20 } });
  assert.equal(migrated.events.length, 0);
  assert.equal(migrated.analysisAvailable, false);
  assert.equal(migrated.legacySummary.accuracy, 87.5);
  assert.equal(migrated.dataCompleteness, 0);
});

test('history filter sorts newest first and preserves original records', () => {
  const records = [{ id: 'a', playedAt: 100, chartId: 'one' }, { id: 'b', playedAt: 300, chartId: 'two' }, { id: 'c', playedAt: 200, chartId: 'one' }];
  const copy = structuredClone(records);
  const result = getPerformanceHistory(records, { chartId: 'one', limit: 1 });
  assert.equal(result[0].id, 'c');
  assert.deepEqual(records, copy);
});

test('invalid timestamps and malformed events are safely ignored', () => {
  const events = normalizePerformanceEvents([null, {}, { expectedTimeMs: NaN }, { expectedTimeMs: 100, actualTimeMs: 'invalid' }, { expectedTimeMs: 200, actualTimeMs: 210, lane: 8 }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].lane, null);
});

test('duplicate IDs remain observable instead of silently deleting chart objects', () => {
  const events = normalizePerformanceEvents([{ id: 'same', expectedTimeMs: 0, judgement: 'great' }, { id: 'same', expectedTimeMs: 100, judgement: 'great' }]);
  assert.equal(events.length, 2);
});

test('rating is deterministic, bounded and confidence-aware when timing is missing', () => {
  const args = { accuracy: 95, maxCombo: 60, maxPossibleCombo: 100, sampleSize: 60, hasTimingData: false };
  const a = calculateRFPerformanceRating(args), b = calculateRFPerformanceRating(args);
  assert.deepEqual(a, b);
  assert.ok(a.value >= 0 && a.value <= 100);
  assert.equal(a.confidence, 0.55);
});

test('practice recommendations require adequate evidence', () => {
  const insufficient = analyzePlay({ events: makeEvents(8, { error: -25 }) });
  assert.equal(generatePracticeRecommendations(insufficient).length, 0);
  const enough = analyzePlay({ events: makeEvents(50, { error: -25 }) });
  assert.ok(generatePracticeRecommendations(enough).some(item => item.target === 'Timing control'));
});

test('skill profile aggregates measured skills but leaves unsupported skills absent', () => {
  const analysis = analyzePlay({ events: makeEvents(50, { interval: 100, laneAt: () => 0 }) });
  const profile = updatePlayerSkillProfile({ plays: 2, skills: { chord: { score: 70, sampleSize: 5 } } }, analysis);
  assert.equal(profile.plays, 3);
  assert.equal(profile.skills.hold, undefined);
  assert.equal(profile.skills.chord.score, 70);
});
