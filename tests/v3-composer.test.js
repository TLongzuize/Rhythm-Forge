import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeV3, interpretTimeline } from '../v3/timeline.js';
import { composeV3, V3_COMPOSITION_REVISION, V3_PROFILES } from '../v3/composer.js';
import { synthClicks } from './helpers.js';

const { samples, sr } = synthClicks({
  segments: [{ bpm: 180, ms: 24000 }],
  sr: 16000,
  eighths: true,
  accentEvery: 4
});
const timeline = interpretTimeline(analyzeV3(samples, sr));
test('density, hands, spacing, chord and occupancy constraints across difficulties', () => {
  let previous = 0;
  for (const [difficulty, p] of Object.entries(V3_PROFILES)) {
    const opts = { difficulty, compositionRevision: V3_COMPOSITION_REVISION };
    const notes = composeV3(timeline, opts);
    assert.ok(notes.length >= previous);
    previous = notes.length;
    assert.deepEqual(composeV3(timeline, opts), notes);
    const free = [0, 0, 0, 0],
      lanes = new Set();
    for (const n of notes) {
      assert.ok(n.timeMs >= free[n.lane]);
      free[n.lane] = Math.max(n.timeMs + p.laneGap, (n.endTimeMs || 0) + 45);
      lanes.add(n.lane);
    }
    assert.equal(lanes.size, 4);
    if (difficulty === 'easy') assert.equal(new Set(notes.map((n) => n.timeMs)).size, notes.length);
  }
});
test('sustain evidence admits an actual hold and silence emits no notes', () => {
  const x = new Float32Array(32000);
  assert.deepEqual(composeV3(interpretTimeline(analyzeV3(x, 16000))), []);
  for (let i = 1600; i < 20000; i++) x[i] = 0.4 * Math.sin(i * 0.25);
  const [hold] = composeV3(interpretTimeline(analyzeV3(x, 16000)));
  assert.equal(hold.type, 'hold');
  assert.ok(hold.endTimeMs <= 1255);
});
test('all five personalities generate all four difficulties with bounded active holds', () => {
  for (const mode of ['balanced', 'beat', 'melodic', 'technical', 'relax']) {
    for (const [difficulty, p] of Object.entries(V3_PROFILES)) {
      const notes = composeV3(timeline, { mode, difficulty, compositionRevision: V3_COMPOSITION_REVISION });
      assert.ok(notes.length);
      const busy = [0, 0, 0, 0];
      for (const n of notes) {
        assert.ok(n.timeMs >= busy[n.lane]);
        if (n.type === 'hold') {
          assert.ok(n.endTimeMs > n.timeMs && n.endTimeMs <= timeline.durationMs);
          busy[n.lane] = n.endTimeMs;
          assert.ok(busy.filter((end) => end > n.timeMs).length <= p.holds);
        }
      }
    }
  }
  assert.ok(
    composeV3(timeline, { mode: 'technical' }).length > composeV3(timeline, { mode: 'relax' }).length
  );
});
test('prominent broadband accents can form chords off the estimated beat in technical charts', () => {
  const events = Array.from({ length: 20 }, (_, i) => ({
    timeMs: 100 + 200 * i,
    period: 500,
    phraseId: 0,
    pulse: 0,
    confidence: 0.75,
    bandSpread: i % 4 === 0 ? 0.7 : 0.05,
    salience: i % 4 === 0 ? 0.65 : 0.45,
    sustainEndMs: 105 + 200 * i
  }));
  const phrase = { id: 0, motif: 0x8888, sectionId: 0 };
  const song = { events, phrases: [phrase], sections: [{ texture: 'steady' }], durationMs: 4200 };
  const expert = composeV3(song, { difficulty: 'expert' });
  const chords = expert.filter((n, i) => i && n.timeMs === expert[i - 1].timeMs);
  assert.ok(chords.length >= 3);
  assert.ok(chords.every((n) => (n.timeMs - 100) % 800 === 0));
  const normal = composeV3(song, { difficulty: 'normal' });
  assert.equal(new Set(normal.map((n) => n.timeMs)).size, normal.length);
});

test('a measured 80 ms Hard fill can keep secondary attacks without continuing into a pause', () => {
  const events = [100,180,260,340,2100].map((timeMs,i)=>({
    timeMs, period:480, phraseId:0, slot:i, band:i%3, pulse:0, confidence:0.7,
    salience:i===1?0.19:0.6, sustainEndMs:timeMs+10
  }));
  const song={events,phrases:[{id:0,motif:7,sectionId:0}],sections:[{texture:'steady'}],durationMs:2400};
  const heads=difficulty=>[...new Set(composeV3(song,{difficulty}).map(n=>n.timeMs))];
  assert.deepEqual(heads('hard'),events.map(e=>e.timeMs));
  assert.ok(heads('normal').length<heads('hard').length);
});

test('Expert lane phrasing responds to register changes at identical attack times', () => {
  const events=Array.from({length:12},(_,i)=>({timeMs:150*i,period:500,phraseId:0,slot:i,
    band:1,pulse:0,confidence:0.8,salience:0.6,sustainEndMs:150*i+10}));
  const song={events,phrases:[{id:0,motif:13,sectionId:0}],sections:[{texture:'steady'}],durationMs:2000};
  const run=events=>composeV3({...song,events},{difficulty:'expert'});
  const trill=run(events), contour=run(events.map((e,i)=>({...e,band:i%3})));
  assert.deepEqual(trill.map(n=>n.timeMs),contour.map(n=>n.timeMs));
  assert.notDeepEqual(trill.map(n=>n.lane),contour.map(n=>n.lane));
});

test('low-pulse repeated attacks recover across phrases while sparse attacks retain the rank gate', () => {
  const events = Array.from({ length: 40 }, (_, i) => ({
    timeMs: 100 + 80 * i, phraseId: Number(i >= 20), period: 640,
    pulse: 0, band: i % 2, strength: 0.22, confidence: i === 19 ? 0.04 : 0.12,
    salience: 0.153, sustainEndMs: 110 + 80 * i
  }));
  const song = {
    events, durationMs: 4000,
    phrases: [{id: 0, motif: 3, sectionId: 0}, {id: 1, motif: 3, sectionId: 0}],
    sections: [{texture: 'steady'}]
  };
  const opts = { difficulty: 'hard' };
  const notes = composeV3(song, opts);
  assert.ok(notes.length > 30);
  assert.ok(notes.some(n => n.timeMs === events[20].timeMs));
  assert.ok(notes.every(n => n.timeMs !== events[19].timeMs));
  assert.deepEqual(composeV3(song, opts), notes);
  const sparse = events.map((e, i) => ({...e, timeMs: i * 400, sustainEndMs: i * 400 + 10}));
  assert.deepEqual(composeV3({...song, events: sparse, durationMs: 16000}, opts), []);
  assert.deepEqual(composeV3(song, {difficulty: 'normal'}), []);
});

test('fast Expert transitions alternate hands when an opposite lane is free', () => {
  const events = Array.from({length: 28}, (_, i) => ({
    timeMs: i * 76, period: 456, phraseId: 0, band: i % 3,
    strength: 0.42, salience: 0.45, pulse: 0, confidence: 0.3, sustainEndMs: i * 76 + 10
  }));
  const song = { events, durationMs: 3000, phrases: [{id: 0, motif: 25, sectionId: 0}],
    sections: [{texture: 'steady'}] };
  const notes = composeV3(song, {difficulty: 'expert'});
  assert.equal(notes.length, events.length);
  assert.ok(notes.slice(1).every((n, i) => (n.lane >> 1) !== (notes[i].lane >> 1)));
});

test('production timing selection compares competing accents across a phrase seam', async () => {
  const { generateV3, V3_ENGINE_REVISION } = await import('../v3/engine.js');
  const events = [100, 420, 465, 700, 950].map((timeMs, i) => ({
    timeMs, phraseId: Number(i >= 2), period: 500, band: 1, bandSpread: 0.1,
    pulse: 0, strength: 0.65, confidence: 0.6, salience: i === 1 ? 0.25 : 0.65,
    sustainEndMs: timeMs + 10
  }));
  const song = {
    events, durationMs: 1500, quietRanges: [{ startMs: 900, endMs: 1100 }],
    phrases: [{ id: 0, motif: 7, sectionId: 0 }, { id: 1, motif: 7, sectionId: 0 }],
    sections: [{ texture: 'steady' }], tempoMap: { globalBpm: 120, firstBeatMs: 100 }
  };
  const input = { difficulty: 'expert', seed: 42 };
  const previous = generateV3(song, 'Seam', { ...input, compositionRevision: 'event-1' }).chart;
  const current = generateV3(song, 'Seam', input).chart;
  assert.ok(previous.notes.some(n => n.timeMs === 420));
  assert.ok(!previous.notes.some(n => n.timeMs === 465));
  assert.deepEqual(current.notes.map(n => n.timeMs), [100, 465, 700]);
  assert.deepEqual(current.generator.tempoMap, previous.generator.tempoMap);
  assert.equal(current.generator.compositionRevision, V3_ENGINE_REVISION);
  assert.deepEqual(generateV3(song, 'Seam', input).chart, current);
});

test('production holds require attack-relative evidence and preserve future presses', () => {
  const tone = new Float32Array(64000);
  for (let i = 4000; i < 18000; i++) tone[i] = 0.3 * Math.sin(i * 2 * Math.PI * 440 / 16000);
  const song = interpretTimeline(analyzeV3(tone, 16000));
  const input = { difficulty: 'expert', compositionRevision: 'articulation-1' };
  const [supported] = composeV3(song, input);
  assert.equal(supported.type, 'hold');
  assert.ok(Math.abs(supported.endTimeMs - 1125) < 12);

  const event = song.events[0];
  delete event.holdEvidence;
  assert.equal(composeV3(song, input)[0].type, 'tap');

  const fill = [100, 260, 420, 580, 740, 900].map(timeMs => ({
    ...event, timeMs, period: 500, salience: 0.6, bandSpread: 0.2,
    sustainEndMs: timeMs + 10
  }));
  fill[0].holdEvidence = { endTimeMs: 950, continuity: 1 };
  const fast = { ...song, events: fill, quietRanges: [] };
  const notes = composeV3(fast, input);
  assert.deepEqual(notes.map(n => n.timeMs), fill.map(e => e.timeMs));
  assert.ok(notes.every(n => n.type === 'tap'));
});

test('a locally distinct broadband attack can form a technical chord without a trusted pulse', () => {
  const events = Array.from({ length: 9 }, (_, i) => ({
    timeMs: 200 * i, period: 500, phraseId: 0, band: 0, bandSpread: i === 4 ? 0.65 : 0.1,
    strength: 0.35, pulse: 0, confidence: 0.4, salience: i === 4 ? 0.35 : 0.22,
    sustainEndMs: 200 * i + 10
  }));
  const song = { events, durationMs: 1800, phrases: [{ id: 0, motif: 9, sectionId: 0 }],
    sections: [{ texture: 'steady' }] };
  const opts = { difficulty: 'expert', compositionRevision: V3_COMPOSITION_REVISION };
  const withAccent = composeV3(song, opts);
  assert.equal(withAccent.filter(n => n.timeMs === 800).length, 2);
  assert.equal(withAccent.length, events.length + 1);
  const even = { ...song, events: events.map(e => ({ ...e, salience: 0.33 })) };
  assert.equal(composeV3(even, opts).length, events.length);
  const relax = composeV3(song, { ...opts, mode: 'relax' });
  assert.equal(new Set(relax.map(n => n.timeMs)).size, relax.length);
});

test('a supported hold may use the other finger of the same hand without moving later attacks', () => {
  const events = [100, 260, 440, 610, 825, 1010].map(timeMs => ({
    timeMs, band: 1, bandSpread: 0.1, period: 500, pulse: 0, salience: 0.5,
    confidence: 0.6, strength: 0.5, phraseId: 0, sustainEndMs: timeMs + 10
  }));
  const song = {
    events, phrases: [{ id: 0, motif: 13, sectionId: 0 }],
    sections: [{ texture: 'steady' }], durationMs: 1600, quietRanges: []
  };
  const opts = { seed: 0, difficulty: 'expert', compositionRevision: 'articulation-3' };
  const taps = composeV3(song, opts);
  assert.equal(taps[0].lane, taps[2].lane);
  events[0].tonalHoldEvidence = { endTimeMs: 700, continuity: 1 };
  const held = composeV3(song, opts);
  assert.deepEqual(held[0], { ...taps[0], lane: taps[0].lane ^ 1, type: 'hold', endTimeMs: 700 });
  assert.deepEqual(held.slice(1), taps.slice(1));

  song.quietRanges = [{ startMs: 500, endMs: 590 }];
  assert.deepEqual(composeV3(song, opts), taps);
});

function difficultyFixture(times, transform = () => ({})) {
  return {
    events: times.map((timeMs, i) => ({
      timeMs, phraseId: 0, period: 500, band: 1, bandSpread: 0.10,
      pulse: 0, confidence: 0.24, strength: 0.32, salience: 0.24,
      sustainEndMs: timeMs + 10, ...transform(i)
    })),
    phrases: [{ id: 0, startMs: 0, motif: 13, sectionId: 0 }],
    sections: [{ texture: 'steady' }], durationMs: Math.max(...times) + 300, quietRanges: []
  };
}

test('Easy and Normal calibrate active low-contrast phrases while respecting the confidence floor', () => {
  const song = difficultyFixture(Array.from({length: 14}, (_, i) => 100 + i * 200),
    i => i === 4 ? { confidence: 0.05 } : {});
  for (const difficulty of ['easy', 'normal']) {
    const opts = { difficulty, compositionRevision: V3_COMPOSITION_REVISION };
    const baseline = composeV3(song, { ...opts, compositionRevision: 'articulation-3' });
    const notes = composeV3(song, opts);
    assert.equal(baseline.length, 0);
    assert.ok(notes.length >= 5 && notes.every(n => n.timeMs !== 900));
    assert.ok(notes.every(n => song.events.some(e => n.timeMs === e.timeMs)));
    assert.deepEqual(composeV3({ ...song, durationMs: 15000 }, opts), []);
  }
});

test('Normal can play an evidenced jack pair without weakening recovery for other presses', () => {
  const song = difficultyFixture([100, 305, 510, 715], () => ({ salience: 0.51, confidence: 0.65 }));
  const opts = { difficulty: 'normal', compositionRevision: V3_COMPOSITION_REVISION };
  const notes = composeV3(song, opts);
  assert.equal(notes.length, 4);
  assert.equal(notes[0].lane, notes[1].lane);
  assert.notEqual(notes[1].lane, notes[2].lane);
  const irregular = difficultyFixture([100,305,605,915], () => ({ salience: 0.51, confidence: 0.65 }));
  const other = composeV3(irregular, opts);
  assert.notEqual(other[0].lane, other[1].lane);
});

test('an even rising figure can produce a roll without inserting extra attacks', () => {
  const song = difficultyFixture([100, 280, 460, 640], i => ({
    band: [0,0,1,2][i], salience: 0.48, confidence: 0.62
  }));
  const notes = composeV3(song, { difficulty: 'hard', compositionRevision: V3_COMPOSITION_REVISION });
  assert.deepEqual(notes.map(n => n.timeMs), [100,280,460,640]);
  assert.ok([[0,1,2,3],[3,2,1,0]].some(roll => roll.every((l,i) => notes[i].lane === l)));
});

test('a reliable tonal release can keep a hold at an onset eligible for a chord', () => {
  const song = difficultyFixture([100, 600, 1100], i => ({
    salience: i === 0 ? 0.68 : 0.42,
    confidence: 0.65, bandSpread: i === 0 ? 0.75 : 0.10
  }));
  song.events[0].tonalHoldEvidence = { endTimeMs: 465, continuity: 0.93 };
  const opts = { difficulty: 'hard', compositionRevision: V3_COMPOSITION_REVISION };
  const before = composeV3(song, { ...opts, compositionRevision: 'articulation-3' });
  assert.equal(before.filter(n => n.timeMs === 100).length, 2);
  const notes = composeV3(song, opts);
  assert.equal(notes.filter(n => n.timeMs === 100).length, 1);
  assert.equal(notes[0].endTimeMs, 465);
  assert.deepEqual([...new Set(notes.map(n => n.timeMs))], [100,600,1100]);
});
