import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeV3Technical } from '../v3/arrangement.js';
import { V3_PROFILES } from '../v3/composer.js';
import { assessV3 } from '../v3/quality.js';

const attack = (timeMs, more = {}) => ({
  timeMs, salience: 0.18, confidence: 0.24, strength: 0.22,
  period: 430, band: 0, bandSpread: 0.55, phraseId: 0, slot: 1,
  sustainEndMs: timeMs + 15, ...more
});
const tap = (timeMs, lane) => ({ timeMs, lane, id: 't-' + timeMs, type: 'tap' });
const timeline = events => ({ events, durationMs: 5000, quietRanges: [],
  phrases: [{ id: 0, startMs: 0, motif: 3, eventCount: events.length }] });
const apply = (notes, song, extra) => arrangeV3Technical(notes, song,
  { difficulty: 'expert', mode: 'balanced', densityScale: 1, ...extra }, V3_PROFILES.expert);

test('coincident rises can accent a measured head and never replace a sealed hold', () => {
  const events = [1000, 1260, 1500, 1760, 2020, 2280, 2540, 2800].map(time => attack(time));
  events[1].coattack = 0.48;
  events[1].salience = 0.20;
  const notes = [tap(1000,0), tap(1260,0), tap(1500,2), tap(1760,3), tap(2020,0)];
  const enriched = apply(notes, timeline(events));
  assert.deepEqual(enriched.technique, { addedChords: 1, recoveredAttacks: 0, brackets: 1, tonalAttacks: 0, phraseNotes: 0 });
  assert.equal(enriched.notes.find(n => n.id.startsWith('v3-context')).timeMs, 1260);
  assert.deepEqual(enriched.notes.filter(n => !n.id.startsWith('v3-context')), notes);
  const held = [{ ...notes[1], type: 'hold', endTimeMs: 1720 }, ...notes.slice(2)];
  assert.deepEqual(apply(held, timeline(events)).notes, held);
  assert.deepEqual(apply(notes, timeline(events), { mode: 'relax' }).notes, notes);
  events[1].coattack = 0.04;
  assert.deepEqual(apply(notes, timeline(events)).notes, notes);
});

test('a weak subdivision needs matching confident neighbors on both sides', () => {
  const events = [100,220,340,460,580].map(time => attack(time));
  events[2].confidence = 0.075;
  const base = [tap(100,2),tap(220,0),tap(460,2),tap(580,0)];
  const song = timeline(events);
  const result = apply(base,song);
  assert.equal(result.technique.recoveredAttacks,1);
  assert.deepEqual(result.notes.map(n=>n.timeMs),[100,220,340,460,580]);
  assert.deepEqual(apply(base,song,{ minConfidence:0.11 }).notes,base);
  assert.deepEqual(apply(base,{ ...song, quietRanges:[{startMs:275,endMs:310}] }).notes,base);
  events[3].band = 1;
  assert.deepEqual(apply(base,song).notes,base);
});

test('a short gap after a hold is reported separately from a lane overlap', () => {
  const notes = [{...tap(100,0),type:'hold',endTimeMs:390},tap(410,0),tap(500,1)];
  const result = assessV3(notes,timeline([attack(100),attack(410),attack(500)]),V3_PROFILES.expert);
  assert.equal(result.counts.collisions,0);
  assert.equal(result.counts.releaseConflicts,1);
});

test('Easy can complete a supported even figure without bridging a quiet region', () => {
  const events = [200, 630, 1060].map(time => attack(time));
  const base = [tap(200, 0), tap(1060, 1)];
  const song = timeline(events);
  const arrange = (source, densityScale = 1) => arrangeV3Technical(base, source,
    { difficulty: 'easy', mode: 'balanced', densityScale }, V3_PROFILES.easy);
  assert.equal(arrange(song).technique.phraseNotes, 1);
  assert.deepEqual(arrange(song).notes.map(n => n.timeMs), [200, 630, 1060]);
  assert.deepEqual(arrange(song, 0.55).notes, base);
  assert.deepEqual(arrange({ ...song, quietRanges: [{ startMs: 395, endMs: 540 }] }).notes, base);
  events[1].timeMs = 770;
  assert.deepEqual(arrange(song).notes, base);
});
