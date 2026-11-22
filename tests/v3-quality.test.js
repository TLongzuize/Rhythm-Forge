import test from 'node:test';
import assert from 'node:assert/strict';
import { assessV3 } from '../v3/quality.js';
import { V3_PROFILES } from '../v3/composer.js';

test('evaluator distinguishes missing attack support, quiet heads, hold overrun and a lane collision', () => {
  const timeline = {
    durationMs: 2000,
    events: [
      { timeMs: 100, confidence: 1, salience: 1, sustainEndMs: 390, phraseId: 0, slot: 0 },
      { timeMs: 300, confidence: 0.2, salience: 0.3, sustainEndMs: 305, phraseId: 0, slot: 2 }
    ],
    phrases: [{ id: 0, startMs: 0, eventCount: 2, motif: 5 }],
    quietRanges: [{ startMs: 500, endMs: 1200 }]
  };
  const report = assessV3(
    [
      { timeMs: 100, lane: 0, type: 'hold', endTimeMs: 490 },
      { timeMs: 300, lane: 0, type: 'tap' },
      { timeMs: 700, lane: 2, type: 'tap' }
    ],
    timeline,
    V3_PROFILES.normal
  );
  assert.equal(report.counts.collisions, 1);
  assert.equal(report.counts.quietHeads, 1);
  assert.equal(report.estimates.supportedHoldRate, 0);
  assert.equal(report.estimates.salienceCoverage, 1);
  assert.equal(report.estimates.unsupportedRate, 1 / 3);
  assert.equal(report.estimates.weakRate, 1 / 3);
  assert.equal(report.estimates.phraseAgreement, null);
});
