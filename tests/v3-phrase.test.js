import assert from 'node:assert/strict';
import test from 'node:test';
import { validateChart } from '../core.js';
import { composeV3, V3_PHRASE_REVISION } from '../v3/composer.js';
import { generateV3, generateV3Set } from '../v3/engine.js';
import { analyzeV3 } from '../v3/timeline.js';

const sampleRate = 22050;
function maskedFixture(vibrato) {
  const pcm = new Float32Array(sampleRate * 6);
  let phase = 0;
  for (let i = 0; i < pcm.length; i++) {
    const t = i / sampleRate;
    phase += 2 * Math.PI * (488 + (vibrato ? 22 * Math.sin(t * 2 * Math.PI * 6) : 0)) / sampleRate;
    pcm[i] = 0.55 * Math.sin(phase) + 0.14 * Math.sin(2 * phase);
    const elapsed = t % 0.5;
    if (!vibrato && t >= 0.5 && elapsed < 0.07)
      pcm[i] += 0.072 * Math.sin(2 * Math.PI * 1038 * elapsed) * Math.min(1, elapsed / 0.003, (0.07 - elapsed) / 0.012);
  }
  return pcm;
}

test('masked pitched entries have measured heads without charting steady vibrato', () => {
  const pcm = maskedFixture(false);
  const analysis = analyzeV3(pcm, sampleRate);
  const reference = Array.from({ length:11 }, (_, i) => (i + 1) * 500);
  const closeToReference = time => reference.some(target => Math.abs(target - time) <= 8);
  assert.ok(!analysis.events.some(event => closeToReference(event.timeMs)), 'the broadband path should miss the masked entries');
  assert.equal(analysis.spectralAttacks.length, reference.length);
  assert.ok(analysis.spectralAttacks.every(event => closeToReference(event.timeMs)));
  const [result] = generateV3Set(analysis, 'Masked entries', { difficulty:'expert' });
  assert.ok(reference.every(target => result.chart.notes.some(n => Math.abs(target - n.timeMs) <= 8)));
  assert.deepEqual(analyzeV3(maskedFixture(true), sampleRate).spectralAttacks, []);
});

function phraseFixture(times, changes = () => ({})) {
  return {
    durationMs: times.at(-1) + 400,
    events: times.map((timeMs, i) => ({
      timeMs, period:480, phraseId:0, pulse:0, band:1, salience:0.42,
      confidence:0.72, strength:0.48, bandSpread:0.04, sustainEndMs:timeMs, ...changes(i)
    })),
    phrases:[{ id:0, motif:2, sectionId:0, startMs:0, eventCount:times.length }],
    sections:[{ texture:'steady' }],
    quietRanges:[],
    tempoMap:{ globalBpm:125, firstBeatMs:0, segments:[] }
  };
}

test('Expert can voice a compound accent as three keys while a uniform single arrival stays single', () => {
  const fixture = phraseFixture([100,300,500,700,900,1100,1300], index => index === 3 ? {
    salience:0.64, components:{ pitched:0.22, impact:0.1, independentPitch:true }
  } : {});
  for (const [difficulty, width] of [['easy',1], ['normal',2], ['hard',2], ['expert',3]]) {
    const notes = composeV3(fixture, { difficulty, compositionRevision:V3_PHRASE_REVISION });
    assert.equal(notes.filter(n => n.timeMs === 700).length, width);
    assert.ok(notes.filter(n => n.timeMs !== 700).every(n => !notes.some(other =>
      other !== n && other.timeMs === n.timeMs)));
  }
});

test('measured uneven groups can map to a gallop while preserving all head timestamps', () => {
  const times = [100,180,365,445];
  const fixture = phraseFixture(times);
  const intent = { rapidJacks:0, rollSteps:0 };
  const notes = composeV3(fixture, { difficulty:'expert', compositionRevision:V3_PHRASE_REVISION },
    0, undefined, intent);
  assert.equal(intent.gallop, 1);
  assert.deepEqual(notes.map(n => n.timeMs), times);
  assert.equal(new Set(notes.map(n => n.lane)).size, 4);
});

test('repeated compound accents can share a recovering finger across chords', () => {
  const times = Array.from({ length:20 }, (_, i) => 100 + i * 90);
  const fixture = phraseFixture(times, i => i % 2 ? {
    band:1, salience:0.2, strength:0.25, confidence:0.2
  } : {
    band:0, coattack:0.64, bandSpread:0.58, salience:0.54, strength:0.55, confidence:0.65,
    components:{ pitched:0.24, impact:0.2 }
  });
  fixture.events.forEach(event => { event.period = 360; });
  const intent = { rapidJacks:0, rollSteps:0 };
  const notes = composeV3(fixture, { difficulty:'expert', compositionRevision:V3_PHRASE_REVISION },
    0, undefined, intent);
  assert.ok(intent.chordjacks > 0);
  assert.ok(times.some(time => {
    const a = notes.filter(n => n.timeMs === time);
    const b = notes.filter(n => n.timeMs === time + 180);
    return a.length === 2 && b.length === 2 && a.some(n => b.some(other => n.lane === other.lane));
  }));
  const last = Array(4).fill(-Infinity);
  for (const { lane, timeMs } of notes) {
    assert.ok(timeMs - last[lane] >= 105);
    last[lane] = timeMs;
  }
});

test('sustained 51 ms attack runs respect the chart key limit and keep heavy accents', () => {
  const fixture = phraseFixture(Array.from({ length:130 }, (_, i) => 100 + i * 51), i => ({
    salience: i % 8 === 0 ? 0.9 : 0.28,
    band: i % 3
  }));
  const { chart } = generateV3(fixture, 'Dense attacks', { difficulty:'expert', mode:'technical' });
  const validation = validateChart(chart);
  assert.ok(validation.valid);
  assert.deepEqual(validation.warnings, []);
  assert.ok(fixture.events.filter(event => event.salience === 0.9).every(event =>
    chart.notes.some(note => note.timeMs === event.timeMs)));
  assert.ok(chart.notes.length > 80);
  assert.deepEqual(generateV3(fixture, 'Dense attacks', { difficulty:'expert', mode:'technical' }).chart, chart);
});
