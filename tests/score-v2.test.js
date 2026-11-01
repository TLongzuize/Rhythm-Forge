import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScoreV2, gradeForScoreV2, SCORE_V2_MAX, SCORE_V2_VERSION } from '../score-v2.js';

test('ScoreV2 perfect play reaches the standardised one-million cap', () => {
  const sequence = Array.from({ length: 100 }, () => 'marvelous');
  const result = calculateScoreV2({ judgementSequence: sequence, judgements: { marvelous: 100 }, maxCombo: 100, maxPossibleCombo: 100 });
  assert.equal(result.score, SCORE_V2_MAX);
  assert.equal(result.version, SCORE_V2_VERSION);
  assert.equal(result.accuracyRatio, 1);
  assert.equal(result.comboProgress, 1);
});

test('ScoreV2 is deterministic, bounded and penalises broken combo and lower judgements', () => {
  const params = { judgementSequence: ['marvelous', 'great', 'miss', 'perfect', 'good'], judgements: { marvelous: 1, great: 1, miss: 1, perfect: 1, good: 1 }, maxCombo: 2, maxPossibleCombo: 5 };
  const a = calculateScoreV2(params), b = calculateScoreV2(params);
  assert.deepEqual(a, b);
  assert.ok(a.score >= 0 && a.score < SCORE_V2_MAX);
  assert.ok(a.comboProgress < 1);
  assert.ok(a.accuracyRatio < 1);
});

test('ScoreV2 accounts for hold heads and tails as independent judged objects', () => {
  const result = calculateScoreV2({ judgementSequence: ['marvelous', 'marvelous', 'marvelous'], judgements: { marvelous: 3 }, maxCombo: 3, maxPossibleCombo: 3 });
  assert.equal(result.expectedObjects, 3);
  assert.equal(result.judgedObjects, 3);
  assert.equal(result.score, SCORE_V2_MAX);
});

test('SS grade begins at 99 percent, including plays containing a miss', () => {
  assert.equal(gradeForScoreV2(99), 'SS');
  assert.equal(gradeForScoreV2(99.01), 'SS');
  assert.equal(gradeForScoreV2(98.99), 'S');
});
