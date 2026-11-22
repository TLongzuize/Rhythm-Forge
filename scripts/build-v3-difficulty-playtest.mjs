import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateChart } from '../core.js';

const [cache, output, stage = 'candidate'] = process.argv.slice(2);
assert.ok(cache && output, 'Supply the matched-chart cache and a new output directory.');
const revisions = { candidate:'difficulty-1', context:'context-1', phrase:'phrase-1', spectral:'spectral-1' };
assert.ok(Object.hasOwn(revisions, stage));
const revision = revisions[stage];
const chartPrefix = stage === 'spectral' ? 'rf-event-comparison' : stage === 'phrase' ? 'rf-phrase-comparison' : stage === 'context' ? 'rf-v3-context-test' : 'rf-difficulty-test';
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const { rows } = json('benchmarks/v3-player-acceptance/exports/results.json');
const selections = [
  ['galaxy', 'easy', ['v2', 'v3']],
  ['nutcracker', 'normal', ['v3', 'v2']],
  ['unity', 'hard', ['v2', 'v3']],
  ['galaxy', 'expert', ['v3', 'v2']],
  ...(stage === 'spectral' ? [['galaxy','hard',['v3','v2']],['nutcracker','expert',['v2','v3']]] : [])
];
const files = [];
for (const [track, difficulty, order] of selections) {
  const { excerpt } = rows.find(row => row.track === track);
  const { fromMs, durationMs, start, end, audioSha } = excerpt;
  const wav = readFileSync(join('audio_file_to_test/rc-playtest', track + '.wav'));
  assert.equal(createHash('sha256').update(wav).digest('hex'), audioSha);
  const stem = track + '-' + difficulty;
  const baseline = json(join(cache, stem + '.json'));
  const candidate = json(join(cache, stem + '-' + stage + '.json'));
  assert.equal(candidate.generator.compositionRevision, revision);
  for (const [i, engine] of order.entries()) {
    const source = engine === 'v2' ? baseline.v2 : candidate;
    const take = i + 1, endMs = fromMs + durationMs;
    const map = source.generator.tempoMap;
    const segments = map.segments.filter((segment, j) => segment.startTime < endMs &&
      (map.segments[j + 1]?.startTime ?? Infinity) > fromMs).map(segment => ({
      ...segment, startTime: segment.startTime - fromMs,
      ...(Number.isFinite(segment.endTime) ? { endTime: segment.endTime - fromMs } : {}),
      ...(Number.isFinite(segment.phaseMs) ? { phaseMs: segment.phaseMs - fromMs } : {})
    }));
    const notes = source.notes.filter(n => n.timeMs >= start * 1000 && n.timeMs < end * 1000)
      .map(({timeMs, endTimeMs, ...note}, n) => ({
        ...note, id: 'n-' + n, timeMs: timeMs - fromMs,
        ...(Number.isFinite(endTimeMs) ? { endTimeMs: endTimeMs - fromMs } : {})
      }));
    const chart = {
      schemaVersion: 1, chartId: `${chartPrefix}-${stem}-${take}`,
      metadata: { ...source.metadata, title: `${track} · Take ${take}`, audioDurationMs: durationMs,
        offsetMs: source.metadata.offsetMs - fromMs },
      generator: { tempoMap: { ...map,
        ...(Number.isFinite(map.firstBeatMs) ? { firstBeatMs: map.firstBeatMs - fromMs } : {}),
        segments
      } },
      notes
    };
    assert.ok(notes.length && validateChart(chart).valid);
    assert.ok(notes.every(n => (n.endTimeMs ?? n.timeMs) <= durationMs));
    files.push({ filename: `${stem}-${take}.json`, chart });
  }
}

mkdirSync(output);
for (const {filename, chart} of files)
  writeFileSync(join(output, filename), JSON.stringify(chart) + '\n', {flag:'wx'});
