import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateChart } from '../core.js';
import { generateV3Set } from '../v3/engine.js';
import { analyzeV3, interpretTimeline } from '../v3/timeline.js';
import { V3_PROFILES } from '../v3/composer.js';
import { physicalMetrics } from '../research/final-recovery/experiment.mjs';

const [referenceDir, output, clipDir] = process.argv.slice(2);
assert.ok(referenceDir && output && clipDir, 'Supply the reference-audio directory, new report directory and local excerpt directory.');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const prior = 'benchmarks/v3-sustain-hardening/exports';
const { results } = json(join(prior, 'results.json'));
const windows = new Map([
  ['galaxy', { start: 200, end: 220, first: 'v2', v2Path: 'benchmarks/v3-articulation/exports/charts/galaxy-2.json' }],
  ['unity', { start: 20, end: 40, first: 'v3', v2Path: join(prior, 'charts/unity-3.json') }],
  ['nutcracker', { start: 12, end: 32, first: 'v2', v2Path: join(prior, 'charts/nutcracker-3.json') }]
]);
const sr = 22050;
const round = n => Math.round(n * 100) / 100;
const files = new Map(), clips = new Map(), rows = [];
function wavExcerpt(bytes) {
  const samples = execFileSync('ffmpeg', [
    '-v', 'error', '-f', 'f32le', '-ar', String(sr), '-ac', '1', '-i', 'pipe:0', '-f', 's16le', 'pipe:1'
  ], { input: bytes, maxBuffer: 8 * 1024 * 1024 });
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(samples.length + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sr, 24);
  header.writeUInt32LE(sr * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

for (const baseline of results) {
  const { track, filename, recordingSha } = baseline;
  const path = join(filename.endsWith('.ogg') ? referenceDir : 'audio_file_to_test', filename);
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), recordingSha);
  const bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'],
    { maxBuffer: 64 * 1024 * 1024 });
  const pcm = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  const started = performance.now();
  const analysis = analyzeV3(pcm, sr);
  const analysisMs = round(performance.now() - started);
  const opts = { seed: 1337, densityScale: 1, mode: 'balanced', compositionRevision: 'articulation-3' };
  const set = () => generateV3Set(analysis, track, opts);
  const generated = set();
  const charts = generated.map(({ chart }) => chart);
  assert.deepEqual(charts, set().map(({ chart }) => chart));
  const measuredHeads = new Set(analysis.events.map(e => Math.round(e.timeMs)));
  const row = { track, recordingSha, filename, analysisMs, charts: [] };
  for (const { chart, diagnostics } of generated) {
    const difficulty = chart.metadata.difficulty;
    const expected = baseline.difficulties[difficulty].after;
    const { notes } = chart;
    const validity = validateChart(chart);
    const metrics = physicalMetrics(notes, V3_PROFILES[difficulty].laneGap);
    const heads = new Set(notes.map(n => n.timeMs));
    assert.ok(validity.valid && !validity.warnings.length && !metrics.collisions && !metrics.releaseConflicts);
    assert.ok([...heads].every(time => measuredHeads.has(time)));
    assert.equal(metrics.fastHand, expected.fastHand);
    assert.equal(metrics.fastFinger, expected.fastFinger);
    assert.equal(notes.length, expected.notes);
    assert.equal(heads.size, expected.heads);
    assert.equal(notes.filter(n => n.type === 'hold').length, expected.holds);
    row.charts.push({ difficulty, notes: notes.length, heads: heads.size, chords: notes.length - heads.size,
      holds: expected.holds, ms: round(diagnostics.generationMs), ...metrics });
  }

  const window = windows.get(track);
  if (window) {
    const { start, end, v2Path, first } = window;
    const versions = { v2: json(v2Path), v3: charts.find(c => c.metadata.difficulty === 'expert') };
    const cut = chart => chart.notes.filter(note => note.timeMs >= start * 1000 && note.timeMs < end * 1000);
    const fromMs = Math.max(0, start * 1000 - 1200);
    const ends = Object.values(versions).flatMap(chart => cut(chart).map(n => n.endTimeMs ?? n.timeMs));
    const toMs = Math.min(Math.floor(pcm.length * 1000 / sr), Math.max(end * 1000, ...ends) + 1000);
    const fromSample = Math.round(fromMs * sr / 1000), toSample = Math.round(toMs * sr / 1000);
    const clip = wavExcerpt(bytes.subarray(fromSample * 4, toSample * 4));
    clips.set(`${track}.wav`, clip);
    const durationMs = toMs - fromMs;
    row.excerpt = { start, end, fromMs, durationMs, audioSha: createHash('sha256').update(clip).digest('hex'), takes: [] };
    const selected = new Set(cut(versions.v3).map(note => note.timeMs));
    const events = interpretTimeline(analysis).events.filter(event => event.timeMs >= start * 1000 && event.timeMs < end * 1000);
    const omitted = events.filter(event => !selected.has(Math.round(event.timeMs)));
    row.excerpt.detected = events.length;
    row.excerpt.omitted = omitted.length;
    row.excerpt.omittedBelowDefaultConfidence = omitted.filter(event => event.confidence < 0.10).length;
    row.excerpt.omittedStrong = omitted.filter(event => event.confidence >= 0.25 && event.salience >= 0.35).length;
    for (const [index, engine] of [first, first === 'v3' ? 'v2' : 'v3'].entries()) {
      const source = versions[engine], take = index + 1;
      const tempo = source.generator.tempoMap;
      const segments = tempo.segments.filter((segment, i) =>
        segment.startTime < toMs && (tempo.segments[i + 1]?.startTime ?? Infinity) > fromMs).map(segment => ({
          ...segment, startTime: segment.startTime - fromMs,
          ...(Number.isFinite(segment.endTime) ? { endTime: segment.endTime - fromMs } : {}),
          ...(Number.isFinite(segment.phaseMs) ? { phaseMs: segment.phaseMs - fromMs } : {})
        }));
      const notes = cut(source).map(({ timeMs, endTimeMs, ...note }, i) => ({
        ...note, id: `n-${i}`, timeMs: timeMs - fromMs,
        ...(Number.isFinite(endTimeMs) ? { endTimeMs: endTimeMs - fromMs } : {})
      }));
      const chart = {
        schemaVersion: 1, chartId: `rf-v3-acceptance-${track}-${take}`,
        metadata: { ...source.metadata, title: `${track} · Take ${take}`, audioDurationMs: durationMs,
          offsetMs: source.metadata.offsetMs - fromMs },
        generator: { tempoMap: { ...tempo,
          ...(Number.isFinite(tempo.firstBeatMs) ? { firstBeatMs: tempo.firstBeatMs - fromMs } : {}),
          segments
        } },
        notes
      };
      assert.ok(notes.length && validateChart(chart).valid);
      assert.ok(notes.every(note => (note.endTimeMs ?? note.timeMs) <= durationMs));
      const metrics = physicalMetrics(notes, V3_PROFILES.expert.laneGap);
      assert.equal(metrics.collisions, 0);
      files.set(`${track}-${take}.json`, chart);
      const times = [...new Set(cut(source).map(note => note.timeMs))];
      const nearMeasured = times.filter(time => analysis.events.some(e => Math.abs(e.timeMs - time) <= 35)).length;
      row.excerpt.takes.push({ take, engine, notes: notes.length, heads: times.length, extraChordKeys: notes.length - times.length,
        holds: notes.filter(n => n.type === 'hold').length, nearMeasured });
    }
  }
  rows.push(row);
  console.error(`Verified ${track}`);
}

mkdirSync(output);
mkdirSync(join(output, 'charts'));
mkdirSync(clipDir, { recursive: true });
for (const [name, chart] of files) writeFileSync(join(output, 'charts', name), JSON.stringify(chart) + '\n', { flag: 'wx' });
for (const [name, clip] of clips) writeFileSync(join(clipDir, name), clip, { flag: 'wx' });
writeFileSync(join(output, 'results.json'), JSON.stringify({ node: process.version, sampleRate: sr, rows }, null, 2) + '\n', { flag: 'wx' });
