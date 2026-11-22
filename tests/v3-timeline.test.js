import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeV3, interpretTimeline } from '../v3/timeline.js';
import { synthClicks } from './helpers.js';

test('repeated phrases share a motif and phase overrides preserve measured swing', () => {
  const { samples, sr } = synthClicks({ segments: [{ bpm: 120, ms: 20000 }], sr: 16000, startMs: 100 });
  for (let t = 433; t < 19800; t += 500) {
    for (let i = 0; i < 160; i++) samples[t * 16 + i] += 0.45 * Math.sin(i * 0.6) * Math.exp(-i / 40);
  }
  const analysis = analyzeV3(samples, sr);
  const a = interpretTimeline(analysis, { bpmOverride: 120, offsetOverrideMs: 100 });
  const b = interpretTimeline(analysis, { bpmOverride: 150, offsetOverrideMs: 220 });
  assert.equal(a.phrases[0].motif, a.phrases[1].motif);
  assert.ok(a.events.some((e) => Math.abs(e.timeMs - 433) < 2));
  assert.deepEqual(
    a.events.map((e) => e.timeMs),
    b.events.map((e) => e.timeMs)
  );
  assert.ok(a.events.every((e) => e.sustainEndMs - e.timeMs < 80));
});
test('a sustained tone releases near its actual tail and leaves silence empty', () => {
  const x = new Float32Array(48000);
  for (let i = 4000; i < 18000; i++) x[i] = 0.3 * Math.sin((i * 2 * Math.PI * 440) / 16000);
  const a = analyzeV3(x, 16000);
  assert.equal(a.events.length, 1);
  assert.ok(Math.abs(a.events[0].sustainEndMs - 1125) < 12);
});
test('sub-bass carrier cycles do not retrigger sustained attacks', () => {
  const x = new Float32Array(48000);
  for (let i = 4000; i < 36000; i++) x[i] = 0.3 * Math.sin(((i - 4000) * 35 * Math.PI) / 8000);
  assert.equal(analyzeV3(x, 16000).events.length, 1);
});

test('a new tone under same-band hits gets one supported release and the hits remain separate', () => {
  const sr = 16000;
  const pcm = Float32Array.from({ length: sr * 2 }, (_, i) => {
    const t = (i * 1000) / sr;
    const sine = hz => Math.sin((i * 2 * Math.PI * hz) / sr);
    const bed = 0.2 * sine(730);
    const tone = t >= 250 && t < 960 ? 0.16 * sine(410) : 0;
    const hit = (t >= 470 && t < 505) || (t >= 690 && t < 725) ? 0.44 * sine(610) : 0;
    return bed + hit + tone;
  });
  const analysis = analyzeV3(pcm, sr);
  const attacks = analysis.events;
  assert.deepEqual(attacks.map(e => Math.round(e.timeMs)), [0, 250, 470, 690]);
  assert.equal(attacks[1].holdEvidence, undefined);
  assert.ok(Math.abs(attacks[1].tonalHoldEvidence.endTimeMs - 960) <= 20);
  assert.ok(attacks.slice(2).every(e => !e.tonalHoldEvidence));
});

test('separate plucks on the same pitch do not turn into a continuous hold', () => {
  const sr = 16000;
  const pcm = Float32Array.from({ length: sr * 2 }, (_, i) => {
    const t = (i * 1000) / sr;
    if (t < 250 || t >= 950 || (t - 250) % 140 >= 59) return 0;
    return 0.33 * Math.sin((i * 2 * Math.PI * 410) / sr);
  });
  const analysis = analyzeV3(pcm, sr);
  assert.deepEqual(analysis.events.map(e => Math.round(e.timeMs)), [250, 390, 530, 670, 810]);
  assert.ok(analysis.events.every(e => !e.tonalHoldEvidence));
});
