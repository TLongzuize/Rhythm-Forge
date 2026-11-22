import { compareAttacks as compare } from './onset-matching.mjs';
import { analyzeSamples, generateChart } from '../core.js';
import { generateRfV2 } from '../rfgen-v2.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateV3 } from '../v3/engine.js';
import { analyzeV3, interpretTimeline } from '../v3/timeline.js';

const [directory, split = 'development'] = process.argv.slice(2);
assert.ok(directory, 'Supply the Onset_Leveau WAV and labels directory.');
const splits = {
  development: ['cello1', 'classic3', 'distguit1', 'jazz3', 'pop1', 'rock1', 'synthbass1', 'techno2'],
  holdout: ['classic2', 'guitar2', 'piano1', 'violin2']
};
assert.ok(Object.hasOwn(splits, split));
const tracks = splits[split];
const sr = 22050;
const labels = file => JSON.parse(readFileSync(file)).labels_time.map(second => second * 1000).sort((a,b) => a-b);
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');

const report = [];
for (const track of tracks) {
  const audio = join(directory, track + '.wav');
  const consensus = join(directory, track + '.goodlabels.json');
  const individual = join(directory, track + '.labels.json');
  const bytes = execFileSync('ffmpeg', ['-v','error','-i',audio,'-ac','1','-ar',String(sr),'-f','f32le','-'],
    { maxBuffer: 4 * 1024 * 1024 });
  const analysis = analyzeV3(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4), sr);
  const timeline = interpretTimeline(analysis);
  const timesOf = notes => [...new Set(notes.map(n => n.timeMs))];
  const pool = {
    broadBand: timesOf(timeline.events.filter(e => e.confidence >= 0.1)),
    spectralOnly: timesOf(timeline.spectralAttacks)
  };
  const prior = generateV3(timeline, track, { difficulty:'expert', seed:25094, compositionRevision:'context-1' }).chart;
  const opts = { difficulty:'expert', seed:25094, mode:'balanced', densityScale:1 };
  const current = generateV3(timeline, track, opts).chart;
  const legacy = analyzeSamples(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4), sr);
  pool.v1 = timesOf(generateChart(legacy, track, opts).chart.notes);
  pool.v2 = timesOf(generateRfV2(legacy, track, opts).chart.notes);
  pool.spectralChart = timesOf(current.notes);
  const priorHeads = new Set(timesOf(prior.notes));
  const broadHeads = new Set(timeline.events.map(e => Math.round(e.timeMs)));
  pool.contextChart = [...priorHeads];
  pool.phraseChart = timesOf(generateV3(timeline, track, { ...opts, compositionRevision:"phrase-1" }).chart.notes);
  pool.chartNewHeads = pool.phraseChart.filter(time => !priorHeads.has(time));
  pool.chartNewSpectral = pool.phraseChart.filter(time => !broadHeads.has(time));
  const reference = { consensus: labels(consensus), individual: labels(individual) };
  const scores = Object.fromEntries(Object.entries(pool).map(([key, times]) => [key,
    Object.fromEntries(Object.entries(reference).map(([label, events]) =>
      [label, [25, 50].map(tolerance => compare(times, events, tolerance))]))]));
  report.push({ track, audioSha256: hash(audio), consensusSha256: hash(consensus),
    individualSha256: hash(individual), scores });
}
console.log(JSON.stringify({ split, sampleRate: sr, tolerancesMs: [25, 50], report }, null, 2));
