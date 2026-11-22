import test from 'node:test';
import assert from 'node:assert/strict';
import { synthClicks } from './helpers.js';
import { detectAttacks, trackTempo } from '../v3/timing.js';

for (const [label, segments] of Object.entries({
  steady: [{ bpm: 120, ms: 24000 }],
  fractional: [{ bpm: 127.43, ms: 32000 }],
  transition: [
    { bpm: 90, ms: 16000 },
    { bpm: 144, ms: 16000 }
  ],
  slow: [{ bpm: 70, ms: 20000 }],
  long: [{ bpm: 138.6, ms: 180000 }]
}))
  test('V3 PCM timing and drift • ' + label, () => {
    const { samples, sr, truth, durationMs } = synthClicks({ segments, startMs: 137, sr: 16000 });
    const { events } = detectAttacks(samples, sr);
    assert.equal(events.length, truth.length);
    events.forEach((e, i) => assert.ok(Math.abs(e.timeMs - truth[i]) <= 1.5));
    const map = trackTempo(events, durationMs);
    for (const seg of map.segments.filter((s) => s.endTime - s.startTime > 7500)) {
      const target = segments.length === 1 || seg.startTime < 16000 ? segments[0].bpm : segments[1].bpm;
      assert.ok(Math.abs(seg.bpm - target) < 1, JSON.stringify(seg));
    }
  });
test('V3 silence and short trailing frame', () => {
  const { events, durationMs } = detectAttacks(new Float32Array(13), 44100);
  assert.deepEqual(events, []);
  assert.equal(trackTempo(events, durationMs).confidence, 0);
});
test('accent ambiguity retains alternate pulse hypotheses and confidence', () => {
  const { samples, sr, durationMs } = synthClicks({
    segments: [{ bpm: 80, ms: 20000 }],
    eighths: true,
    accentEvery: 4,
    sr: 16000
  });
  const { events } = detectAttacks(samples, sr);
  const seg = trackTempo(events, durationMs).segments[0];
  assert.ok(seg.hypotheses.some((h) => Math.abs(h.bpm - 80) < 1));
  assert.ok(seg.hypotheses.some((h) => Math.abs(h.bpm - 160) < 1));
  assert.ok(seg.confidence > 0 && seg.confidence < 0.95);
});

test('syncopated low-energy attacks survive long gaps and a dense 80 ms fill', () => {
  const truth = [127, 460, 1127, 1460, 5000, ...Array.from({ length: 14 }, (_, i) => 6000 + i * 80)];
  for (const sr of [11025, 44100, 48000]) {
    const pcm = new Float32Array(sr * 8);
    for (const t of truth) {
      const first = Math.round((t * sr) / 1000);
      for (let i = 0; i < 0.03 * sr; i++) {
        pcm[first + i] += 0.045 * Math.sin((i * 2 * Math.PI * 830) / sr) * Math.exp(-i / (0.005 * sr));
      }
    }
    const { events } = detectAttacks(pcm, sr);
    assert.equal(events.length, truth.length);
    events.forEach((event, i) => assert.ok(Math.abs(event.timeMs - truth[i]) < 2));
  }
});
