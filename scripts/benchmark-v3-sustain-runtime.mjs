import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeV3 } from '../v3/timeline.js';
import { generateV3Set } from '../v3/engine.js';

const [baseline, revision, isolated] = process.argv.slice(2);
assert.ok(baseline, 'Supply a snapshot directory containing the previous v3/ and package.json.');
const { analyzeV3: analyzeBaseline } = await import(pathToFileURL(resolve(baseline, 'v3/timeline.js')));
const { generateV3Set: generateBaseline } = await import(pathToFileURL(resolve(baseline, 'v3/engine.js')));
const sampleRate = 22050;
function decode(file) {
  const bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', 'audio_file_to_test/' + file,
    '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-'], { maxBuffer: 64 * 1024 * 1024 });
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
}

if (isolated) {
  assert.ok(['spectral','phrase'].includes(revision) && ['baseline', 'current'].includes(isolated));
  const pcm = decode('OnlyMP3_to_-__-_Galaxy_Collapse.mp3');
  const analyze = isolated === 'baseline' ? analyzeBaseline : analyzeV3;
  const generate = isolated === 'baseline' ? generateBaseline : generateV3Set;
  const start = performance.now();
  const analysis = analyze(pcm, sampleRate);
  const analysisMs = Math.round(performance.now() - start);
  generate(analysis, 'Galaxy Collapse', { resourceClass:'compact' });
  console.log(JSON.stringify({ isolated, track:'Galaxy Collapse', node:process.version,
    analysisMs, peakRssKiB:process.resourceUsage().maxRSS }));
  process.exit(0);
}

const galaxy = decode('OnlyMP3_to_-__-_Galaxy_Collapse.mp3');
const unity = decode('OnlyMP3_to_-_TheFatRat_-_Unity.mp3');
const long = new Float32Array(sampleRate * 720);
const section = galaxy.subarray(140 * sampleRate, 200 * sampleRate);
for (let i = 0; i < 12; i++) long.set(section, i * section.length);
const analyzers = [analyzeBaseline, analyzeV3];
for (const analyze of analyzers) analyze(galaxy.subarray(0, sampleRate * 8), sampleRate);

const results = [];
for (const [name, pcm, repetitions] of [
  ['Galaxy Collapse', galaxy, 3], ['Unity', unity, 3], ['Galaxy splice, 12 min', long, 2]
]) {
  const elapsed = [[], []];
  const generation = [[], []];
  let attacks;
  for (let i = 0; i < repetitions; i++) {
    const trials = [];
    for (const k of i % 2 ? [1, 0] : [0, 1]) {
      const start = performance.now();
      trials[k] = analyzers[k](pcm, sampleRate);
      elapsed[k].push(Math.round(performance.now() - start));
    }
    assert.deepEqual(trials[0].tempoMap, trials[1].tempoMap);
    const baseFields = ({ coattack, tonalEntry, components, spectralRise, ...event }) => event;
    if (['spectral','phrase'].includes(revision)) {
      const sourceEvent = ({ components, spectralRise, ...event }) => event;
      if (revision === 'spectral') {
        const strip = ({ envelope, voice, ...e }) => e;
        assert.deepEqual(trials[0].events, trials[1].events.map(strip));
        assert.deepEqual(trials[0].spectralAttacks, trials[1].spectralAttacks.map(strip));
      } else assert.deepEqual(trials[0].events, trials[1].events.map(sourceEvent));
      for (const k of i % 2 ? [1, 0] : [0, 1]) {
        const generate = k ? generateV3Set : generateBaseline;
        const options = {};
        for (const resourceClass of ['standard', 'compact']) {
          const start = performance.now();
          const charts = generate(trials[k], name, { resourceClass });
          options[resourceClass] = { elapsedMs:Math.round(performance.now() - start),
            candidates:charts.map(({ diagnostics }) => diagnostics.candidates) };
        }
        generation[k].push(options);
      }
    } else {
      assert.deepEqual(trials[0].events.map(baseFields),
        trials[1].events.map(({ trackedSustain, ...event }) => baseFields(event)));
    }
    attacks = trials[0].events.length;
  }
  results.push({ name, seconds: pcm.length / sampleRate, attacks, baselineMs: elapsed[0], revisedMs: elapsed[1],
    ...(['spectral','phrase'].includes(revision) ? { generation: { baseline:generation[0], current:generation[1] } } : {}) });
}
console.log(JSON.stringify({ results, peakProcessRssKiB: process.resourceUsage().maxRSS }, null, 2));
