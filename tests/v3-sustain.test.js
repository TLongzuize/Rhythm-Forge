import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChart } from '../core.js';
import { generateV3 } from '../v3/engine.js';
import { addSustainEvidence } from '../v3/sustain.js';
import { analyzeV3, interpretTimeline } from '../v3/timeline.js';

const rate = 16000;
const startMs = 200;
function tone({ length = 2100, pitch = () => 440, gain = () => 0.28, cut = false, layer = () => 0 } = {}) {
  const stopMs = startMs + length;
  let phase = 0;
  return Float32Array.from({ length: (stopMs + (cut ? 0 : 280)) * rate / 1000 }, (_, i) => {
    const time = i * 1000 / rate - startMs;
    phase += 2 * Math.PI * pitch(time) / rate;
    return layer(time, phase) + (time >= 0 && time < length ? gain(time) * Math.sin(phase) : 0);
  });
}
const analyze = options => analyzeV3(tone(options), rate);
const generate = (analysis, options) => generateV3(interpretTimeline(analysis), 'Sustain fixture',
  { difficulty: 'expert', seed: 26, ...options }).chart;

test('an isolated weak attack can corroborate a new tone over accompaniment', () => {
  const entry = 650;
  const event = { timeMs: entry, confidence: 0.06, strength: 0.18 };
  const confirm = (samples, other = []) => {
    const events = [{ ...event }, ...other];
    addSustainEvidence(samples, rate, events, samples.length * 1000 / rate, () => {});
    assert.equal(events[0].timeMs, entry);
    assert.equal(events[0].confidence, event.confidence);
    return events[0].tonalEntry;
  };
  const samples = tone({ gain: () => 0.12, layer: t => t < entry - startMs ? 0 :
    0.16 * Math.sin(2 * Math.PI * 690 * (t + startMs - entry) / 1000) });
  assert.equal(confirm(samples), true);
  assert.equal(confirm(tone({ pitch: t => 440 + 22 * Math.sin(t * 2 * Math.PI * 0.005) })), undefined);
  assert.equal(confirm(samples, [{ ...event, timeMs: entry + 30 }]), undefined);
});

test('an observed release on either side of the old limit can produce a playable hold', () => {
  for (const length of [600, 1100, 1700, 1780, 1900, 2300, 3200]) {
    const analysis = analyze({ length });
    assert.equal(analysis.events.length, 1);
    const { trackedSustain } = analysis.events[0];
    assert.equal(trackedSustain.state, 'release');
    assert.ok(Math.abs(trackedSustain.endTimeMs - startMs - length) <= 30);
    const expert = generate(analysis);
    const [hold] = expert.notes;
    assert.equal(hold.type, 'hold');
    assert.ok(Math.abs(hold.endTimeMs - startMs - length) <= 30);
    assert.ok(validateChart(expert).valid);
    assert.deepEqual(generate(analysis), expert);
    if (length >= 1900)
      assert.equal(generate(analysis, { compositionRevision: 'articulation-2' }).notes[0].type, 'tap');
  }
  const long = analyze({ length: 3200 });
  assert.equal(generate(long, { difficulty: 'easy' }).notes[0].type, 'tap');
});

test('a planning limit or audio cut does not create an exact release', () => {
  for (const [expected, options] of [
    ['tracking-limit', { length: 4200 }],
    ['audio-end', { length: 900, cut: true }],
    ['audio-end', { length: 2200, cut: true }]
  ]) {
    const analysis = analyze(options);
    const evidence = analysis.events[0].trackedSustain;
    assert.equal(evidence.state, 'active');
    assert.equal(evidence.boundary, expected);
    assert.ok(evidence.observedThroughMs > startMs + 500);
    assert.equal(evidence.endTimeMs, undefined);
    assert.ok(generate(analysis).notes.every(n => n.type === 'tap'));
  }
});

test('a bounded ridge follows vibrato and gradual glides without cutting the hold early', () => {
  for (const pitch of [
    () => 440, t => 440 + 10 * Math.sin(t * 2 * Math.PI * 0.005),
    t => 440 + 25 * Math.sin(t * 2 * Math.PI * 0.005),
    t => 440 + 40 * t / 2100, t => 440 + 90 * t / 2100,
    t => 440 - 65 * t / 2100
  ]) {
    const analysis = analyze({ pitch });
    assert.equal(analysis.events[0].trackedSustain.state, 'release');
    const [hold] = generate(analysis).notes;
    assert.equal(hold.type, 'hold');
    assert.ok(Math.abs(hold.endTimeMs - 2300) <= 30);
  }
  const sweep = analyze({ pitch: t => 440 + 400 * t / 2100 });
  assert.equal(sweep.events[0].trackedSustain.state, 'ambiguous');
  assert.ok(generate(sweep).notes.every(n => n.type === 'tap'));
});

test('a confirmed reattack or separate nearby pitch does not extend the original gesture', () => {
  for (const [pitch, gain] of [
    [() => 440, t => t > 700 ? 0.50 : 0.26],
    [t => t > 700 ? 463 : 440, t => t > 700 ? 0.34 : 0.26]
  ]) {
    const analysis = analyze({ pitch, gain: t => t > 695 && t < 705 ? 0 : gain(t) });
    assert.equal(analysis.events.length, 2);
    const first = generate(analysis).notes.find(note => note.timeMs === 200);
    assert.ok(first && (first.type === 'tap' || first.endTimeMs <= 925));
  }
});

test('a short transient, near-silence, and reverberant decay do not acquire tracked holds', () => {
  for (const gain of [
    t => t < 25 ? 0.3 : 0,
    () => 0.00001,
    t => 0.3 * Math.exp(-t / 115)
  ]) {
    const analysis = analyze({ gain });
    assert.ok(analysis.events.every(e => e.trackedSustain?.state !== 'release'));
    assert.ok(generate(analysis).notes.every(n => n.type === 'tap'));
  }
});

test('an existing bed cannot be claimed by a transient and an arriving harmonic does not reset a real release', () => {
  const background = analyze({
    pitch: () => 660, gain: t => t < 70 ? 0.31 : 0,
    layer: t => 0.24 * Math.sin((t + startMs) * 2 * Math.PI * 0.44)
  });
  assert.ok(background.events.length >= 2);
  assert.ok(background.events.slice(1).every(e => !e.trackedSustain));
  const harmonic = analyze({ layer: (t, phase) => t > 450 && t < 2200 ? 0.15 * Math.sin(phase * 2) : 0 });
  assert.equal(harmonic.events[0].trackedSustain.state, 'release');
  assert.ok(Math.abs(harmonic.events[0].trackedSustain.endTimeMs - 2300) <= 30);
});

test('a stronger conflicting legacy endpoint cannot override a corroborated release', () => {
  const analysis = analyze({ length: 900 });
  const [event] = analysis.events;
  event.holdEvidence = { endTimeMs: 700, continuity: 1 };
  event.tonalHoldEvidence = { endTimeMs: 1110, continuity: 0.9 };
  const [hold] = generate(analysis).notes;
  assert.equal(hold.type, 'hold');
  assert.equal(hold.endTimeMs, 1110);
});
