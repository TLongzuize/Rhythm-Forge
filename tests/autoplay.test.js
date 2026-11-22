import test from 'node:test';
import assert from 'node:assert/strict';
import { planAutoplay, planReplay } from '../autoplay.js';
import { judgeDelta } from '../core.js';
import { getJudgementAccuracyRatio } from '../score-v2.js';

const notes = Array.from({ length: 180 }, (_, i) => {
  const timeMs = i * 130;
  return i % 3 ? { timeMs, type: 'tap', lane: i % 4 } :
    { timeMs, type: 'hold', lane: i % 4, endTimeMs: timeMs + 420 };
});
const bounds = { start: 100, end: 23000 };

test('Autoplay scores heads and in-range hold tails at exact timing', () => {
  const plan = planAutoplay(notes, bounds, 100, false);
  assert.ok(plan.length > 180);
  assert.ok(plan.every(action => action.delta === 0 && !action.miss && action.time >= bounds.start && action.time < bounds.end));
  const heads = new Set();
  for (const action of plan) {
    if (action.tail) assert.ok(heads.has(action.note));
    else heads.add(action.note);
  }
  assert.equal(heads.size, notes.filter(n => n.timeMs >= bounds.start && n.timeMs < bounds.end).length);
});

test('Human autoplay approximates weighted score accuracy, including hold misses', () => {
  for (const accuracy of [0, 1, 30, 85, 97.5, 99.3, 100]) {
    let seed = 432;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const plan = planAutoplay(notes, bounds, accuracy, true, random);
    const counts = {};
    for (const action of plan) {
      const tier = action.miss ? 'miss' : judgeDelta(action.delta);
      counts[tier] = (counts[tier] ?? 0) + (action.miss && action.includesTail ? 2 : 1);
    }
    assert.ok(Math.abs(100 * getJudgementAccuracyRatio(counts) - accuracy) < 0.4, JSON.stringify(counts));
    if (accuracy === 100) assert.ok(plan.some(action => Math.abs(action.delta) > 5));
    assert.ok(plan.every((action, i) => !i || action.time >= plan[i - 1].time));
  }
});

test('Replay preserves recorded order, timed inputs, and missed hold tails', () => {
  const tap = { id: 'tap', type: 'tap', timeMs: 1000, lane: 0 };
  const hold = { id: 'hold', type: 'hold', timeMs: 1010, endTimeMs: 2200, lane: 1 };
  const events = [
    { noteId: 'hold', noteType: 'hold-head', actualTimeMs: 1015, judgement: 'marvelous' },
    { noteId: 'tap', noteType: 'tap', actualTimeMs: 1013, hitErrorMs: 13, judgement: 'marvelous' },
    { noteId: 'hold', noteType: 'hold-tail', actualTimeMs: null, eventTimestampMs: 1600, judgement: 'miss' },
  ];
  const plan = planReplay([tap, hold], events, { start: 0, end: 3000 });
  assert.deepEqual(plan.map(a => [a.note.id, a.time, a.delta, a.tail, a.miss]), [
    ['hold', 1015, 5, false, false], ['tap', 1015, 13, false, false], ['hold', 1600, 0, true, true],
  ]);
});
