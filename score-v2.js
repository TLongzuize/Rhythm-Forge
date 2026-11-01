/**
 * Rhythm Forge ScoreV2 — 4K adaptation of the current osu!lazer mania score model.
 * It keeps the lazer split (150k combo + 850k accuracy) and logarithmic combo
 * weighting. RF's seven judgement tiers are mapped to osu!mania-style hit values.
 * This is not a byte-identical osu! ruleset: RF timing windows and rank policy remain RF-owned.
 */
export const SCORE_V2_VERSION = 'rf-score-v2-lazer-mania-adapted-3';
export const SCORE_V2_MAX = 1_000_000;
export const SCORE_V2_COMBO_PORTION = 150_000;
export const SCORE_V2_ACCURACY_PORTION = 850_000;
export const SCORE_V2_COMBO_BASE = 4;
export const SCORE_V2_MAX_COMBO_LOG = Math.log(400) / Math.log(SCORE_V2_COMBO_BASE);

// osu!lazer mania uses 305 for PERFECT, 300 for GREAT, 200/100/50 for
// lower judgements. RF's extra precision tiers are mapped onto that scale.
export const SCORE_V2_JUDGEMENT_VALUES = Object.freeze({
  marvelous: 305,
  perfect: 300,
  great: 200,
  good: 100,
  ok: 50,
  bad: 25,
  miss: 0,
});
const HIT_VALUES = SCORE_V2_JUDGEMENT_VALUES;
const finiteNonNegative = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const comboBreak = judgement => judgement === 'miss' || judgement === 'bad';

function comboScoreFor(judgement, comboAfter) {
  const value = HIT_VALUES[judgement] ?? 0;
  if (value <= 0 || comboAfter <= 0) return 0;
  const comboFactor = Math.min(Math.max(.5, Math.log(comboAfter) / Math.log(SCORE_V2_COMBO_BASE)), SCORE_V2_MAX_COMBO_LOG);
  // A top RF judgement carries 300 combo points in lazer mania; the extra 5
  // points on PERFECT are accuracy-only, matching ManiaScoreProcessor.
  return (judgement === 'marvelous' ? 300 : judgement === 'perfect' ? 300 : value) * comboFactor;
}

export function getJudgementAccuracyRatio(judgements = {}, expectedObjects) {
  const judged = Object.entries(HIT_VALUES).reduce((sum, [key]) => sum + finiteNonNegative(judgements?.[key]), 0);
  const expected = Math.max(judged, finiteNonNegative(expectedObjects) || judged);
  if (!expected) return 1;
  const weighted = Object.entries(HIT_VALUES).reduce((sum, [key, value]) => sum + finiteNonNegative(judgements?.[key]) * value, 0);
  return Math.max(0, Math.min(1, weighted / (305 * expected)));
}

function normaliseSequence(sequence, counts) {
  if (Array.isArray(sequence) && sequence.length) return sequence.map(item => typeof item === 'string' ? item : item?.judgement).filter(key => Object.hasOwn(HIT_VALUES, key));
  // Legacy callers may only have aggregate counts. Reconstruct a deterministic
  // conservative sequence; exact combo score requires the recorded event order.
  const result = [];
  for (const key of Object.keys(HIT_VALUES)) for (let i = 0; i < finiteNonNegative(counts?.[key]); i++) result.push(key);
  return result;
}

export function calculateScoreV2({ judgements = {}, judgementSequence = [], maxCombo = 0, maxPossibleCombo = 0, expectedObjects, bonusScore = 0 } = {}) {
  const sequence = normaliseSequence(judgementSequence, judgements);
  const expected = Math.max(sequence.length, finiteNonNegative(expectedObjects), finiteNonNegative(maxPossibleCombo));
  const counts = { ...judgements };
  if (!Object.keys(counts).length) for (const key of Object.keys(HIT_VALUES)) counts[key] = 0;
  const accuracyRatio = getJudgementAccuracyRatio(counts, expected || sequence.length);
  const completedForCombo = sequence.slice(0, expected || sequence.length);

  let combo = 0, comboEarned = 0;
  for (const judgement of completedForCombo) {
    if (comboBreak(judgement)) combo = 0;
    else combo++;
    comboEarned += comboScoreFor(judgement, combo);
  }
  let comboMaximum = 0;
  const comboObjects = Math.max(1, expected || sequence.length);
  for (let i = 1; i <= comboObjects; i++) comboMaximum += comboScoreFor('marvelous', i);
  const comboProgress = comboMaximum > 0 ? Math.max(0, Math.min(1, comboEarned / comboMaximum)) : 1;
  const accuracyProgress = accuracyRatio;
  const accuracyExponent = 2 + 2 * accuracyRatio;
  const accuracyContribution = Math.pow(accuracyRatio, accuracyExponent) * accuracyProgress;
  const score = Math.max(0, Math.min(SCORE_V2_MAX, Math.round(
    SCORE_V2_COMBO_PORTION * comboProgress + SCORE_V2_ACCURACY_PORTION * accuracyContribution + finiteNonNegative(bonusScore),
  )));
  const suppliedMaxCombo = finiteNonNegative(maxCombo);
  const comboRatio = expected ? Math.min(1, suppliedMaxCombo / expected) : 1;
  return {
    version: SCORE_V2_VERSION,
    score,
    standardisedScore: score,
    bonusScore: finiteNonNegative(bonusScore),
    maxStandardisedScore: SCORE_V2_MAX,
    accuracyRatio,
    accuracyProgress,
    accuracyExponent,
    comboProgress,
    comboRatio,
    comboContribution: Math.round(SCORE_V2_COMBO_PORTION * comboProgress),
    accuracyContribution: Math.round(SCORE_V2_ACCURACY_PORTION * accuracyContribution),
    judgedObjects: sequence.length,
    expectedObjects: expected,
    exactComboSequence: Array.isArray(judgementSequence) && judgementSequence.length > 0,
  };
}

export function gradeForScoreV2(accuracyPercent) {
  const accuracy = Math.max(0, Math.min(100, Number(accuracyPercent) || 0));
  if (accuracy >= 99) return 'SS';
  if (accuracy >= 95) return 'S';
  if (accuracy >= 90) return 'A';
  if (accuracy >= 80) return 'B';
  if (accuracy >= 70) return 'C';
  return 'D';
}
