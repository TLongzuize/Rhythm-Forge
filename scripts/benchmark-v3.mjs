// Run from the repository root. JSON goes to stdout. Historical baselines are read-only.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { analyzeSamples, validateChart } from '../core.js';
import { generateRfV2 } from '../rfgen-v2.js';
import { analyzeV3, interpretTimeline } from '../v3/timeline.js';
import { generateV3 } from '../v3/engine.js';
import { assessV3 } from '../v3/quality.js';
import { V3_PROFILES } from '../v3/composer.js';
import { synthClicks, synthRamp } from '../tests/helpers.js';

const sr = 22050,
  baseSeed = 1337;
const round = (x) => Math.round(x * 100) / 100;
function referenceTiming(notes, truth, durationMs) {
  if (!truth) return null;
  const heads = [...new Set(notes.map((n) => n.timeMs))];
  const errors = [],
    regions = [[], [], []],
    covered = new Set();
  let j = 0,
    close = 0;
  for (const t of heads) {
    while (j + 1 < truth.length && Math.abs(truth[j + 1] - t) < Math.abs(truth[j] - t)) j++;
    const error = Math.abs(truth[j] - t);
    if (error <= 35) {
      covered.add(j);
      close++;
    }
    errors.push(error);
    regions[Math.min(2, Math.floor((3 * t) / durationMs))].push(error);
  }
  function stats(xs) {
    if (!xs.length) return { maeMs: null, p95Ms: null };
    xs.sort((a, b) => a - b);
    return {
      maeMs: round(xs.reduce((a, b) => a + b, 0) / xs.length),
      p95Ms: round(xs[Math.ceil(0.95 * xs.length) - 1])
    };
  }
  return {
    ...stats(errors),
    thirds: regions.map(stats),
    uniqueHeads: heads.length,
    referenceCount: truth.length,
    headsWithin35: close,
    referenceWithin35: covered.size
  };
}

function benchmark(name, samples, truth = null, sha256 = null) {
  console.error(name);
  const start = performance.now();
  const legacy = analyzeSamples(samples, sr);
  const v2Ms = performance.now() - start,
    t3 = performance.now();
  const analysis = analyzeV3(samples, sr),
    timeline = interpretTimeline(analysis);
  const v3Ms = performance.now() - t3;
  const engines = {};
  for (const engine of ['v2', 'v3']) {
    const analysisMs = engine === 'v2' ? v2Ms : v3Ms;
    const rows = [];
    for (const [i, difficulty] of Object.keys(V3_PROFILES).entries()) {
      const opts = { difficulty, seed: baseSeed + i * 7919, mode: 'balanced', effort: 'medium' };
      const t = performance.now();
      const { chart, diagnostics } =
        engine === 'v2' ? generateRfV2(legacy, name, opts) : generateV3(timeline, name, opts);
      const generationMs = performance.now() - t;
      const { valid, errors, warnings } = validateChart(chart);
      rows.push({
        difficulty,
        seed: opts.seed,
        generationMs: round(generationMs),
        valid,
        errors: errors.length,
        warnings: warnings.length,
        candidates: engine === 'v3' ? diagnostics.candidates : null,
        optimizationPasses: engine === 'v3' ? diagnostics.optimizationPasses : null,
        measured: assessV3(chart.notes, timeline, V3_PROFILES[difficulty]),
        independentTiming: referenceTiming(chart.notes, truth, analysis.durationMs)
      });
    }
    engines[engine] = {
      analysisMs: round(analysisMs),
      totalMs: round(analysisMs + rows.reduce((s, r) => s + r.generationMs, 0)),
      rows
    };
  }
  // Same Hard chart request at each search budget. PCM analysis is reusable.
  const effortSweep = ['low', 'medium', 'high', 'ultra', 'max'].map((effort) => {
    const opts = { difficulty: 'hard', seed: baseSeed + 2 * 7919, mode: 'balanced', effort };
    const t = performance.now();
    const run = generateV3(interpretTimeline(analysis, opts), name, opts);
    return {
      effort,
      elapsedMs: round(performance.now() - t),
      candidates: run.diagnostics.candidates,
      layoutUtility: run.diagnostics.utility,
      notes: run.chart.notes.length
    };
  });
  return { name, sha256, durationMs: round(analysis.durationMs), ...engines, effortSweep };
}
const fixtures = [
  ['120 BPM', synthClicks({ segments: [{ bpm: 120, ms: 24000 }], sr, startMs: 137 })],
  ['127.43 BPM', synthClicks({ segments: [{ bpm: 127.43, ms: 42000 }], sr, startMs: 211 })],
  [
    '90 to 144 BPM',
    synthClicks({
      segments: [
        { bpm: 90, ms: 16000 },
        { bpm: 144, ms: 24000 }
      ],
      sr,
      startMs: 83
    })
  ],
  ['tempo ramp', synthRamp({ bpm0: 90, bpm1: 150, ms: 30000, sr })]
];
const results = fixtures.map(([name, f]) => benchmark(name, f.samples, f.truth));
const args = process.argv.slice(2);
let files = args;
if (args.length === 1 && args[0] === '--synthetic') files = [];
else if (!args.length) {
  files = existsSync('audio_file_to_test')
    ? readdirSync('audio_file_to_test')
        .filter((f) => f.endsWith('.mp3'))
        .sort()
        .map((f) => join('audio_file_to_test', f))
    : [];
  if (!files.length) files = ['public/audio/forge-demo.wav'];
}
for (const file of files) {
  const r = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'],
    { maxBuffer: 256 * 1024 * 1024 }
  );
  if (r.error || r.status !== 0) throw r.error || Error(r.stderr.toString());
  const samples = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
  results.push(
    benchmark(basename(file), samples, null, createHash('sha256').update(readFileSync(file)).digest('hex'))
  );
}
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      sampleRate: sr,
      mode: 'balanced',
      effort: 'medium',
      baseSeed,
      peakProcessRssBytes: process.resourceUsage().maxRSS * 1024,
      results
    },
    null,
    2
  )
);
