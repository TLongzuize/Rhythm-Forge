#!/usr/bin/env node
/** Repeatable synthetic-audio generator benchmark. Values are measured, not hand-authored. */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { analyzeSamples, generateAllDifficulties, validateChart } from '../core.js';

const sampleRate = 22050;
const durationSeconds = 20;
const totalSamples = sampleRate * durationSeconds;
function fixture(name, bpm, eventTimes, amplitudeAt = () => .65) {
  const samples = new Float32Array(totalSamples);
  let noiseState = 0x1234abcd;
  const random = () => { noiseState = (Math.imul(noiseState, 1664525) + 1013904223) >>> 0; return noiseState / 4294967296; };
  for (const [idx, time] of eventTimes.entries()) {
    const start = Math.max(0, Math.floor(time * sampleRate));
    const amp = amplitudeAt(time);
    const length = Math.min(Math.floor(.20 * sampleRate), totalSamples - start);
    for (let j = 0; j < length; j++) {
      const t = j / sampleRate;
      const env = Math.exp(-t * 28);
      const sweep = 92 - 30 * Math.exp(-t * 20);
      const kick = Math.sin(2 * Math.PI * sweep * t) * env * amp;
      const transient = (random() * 2 - 1) * Math.exp(-t * 80) * amp * .13;
      samples[start + j] += kick + transient;
    }
    // A short mid-frequency accent makes synthetic onset fixtures less one-dimensional.
    if (idx % 2 === 1) {
      for (let j = 0; j < Math.floor(.09 * sampleRate) && start + j < totalSamples; j++) {
        const t = j / sampleRate;
        samples[start + j] += Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 35) * amp * .18;
      }
    }
  }
  for (let i = 0; i < samples.length; i++) samples[i] = Math.max(-1, Math.min(1, samples[i]));
  return { name, expectedBpm: bpm, samples };
}
function timesFor(bpm, start, end, step = 1, shift = () => 0) {
  const period = 60 / bpm, out = [];
  for (let beat = start / period; beat * period < end; beat += step) {
    const time = beat * period + shift(beat);
    if (time >= start && time < end) out.push(time);
  }
  return out;
}
const fixtures = [
  fixture('steady-electronic', 120, timesFor(120, 0, 20)),
  fixture('sparse-events', 84, timesFor(84, 0, 20, 2), t => (Math.floor(t) % 4 === 0 ? .25 : .58)),
  fixture('fast-percussion', 160, timesFor(160, 0, 20, 1), () => .48),
  fixture('syncopated', 108, timesFor(108, 0, 20, 1, beat => beat % 4 === 2 ? .16 : 0), () => .6),
  fixture('intro-outro-silence', 100, timesFor(100, 4.0, 16.0), () => .7),
  fixture('changing-intensity', 128, timesFor(128, 0, 20), t => t < 4 || t > 15 ? .12 : t < 11 ? .78 : .42),
];
const report = { generatedAt: new Date().toISOString(), sampleRate, durationSeconds, fixtures: [] };
for (const item of fixtures) {
  const start = performance.now();
  const analysis = analyzeSamples(item.samples, sampleRate);
  const charts = generateAllDifficulties(analysis, `Benchmark · ${item.name}`, 20261025);
  const validationFailures = charts.reduce((sum, c) => sum + validateChart(c.chart).errors.length, 0);
  report.fixtures.push({
    name: item.name,
    expectedBpm: item.expectedBpm,
    estimatedBpm: analysis.bpm,
    bpmConfidence: +analysis.bpmConfidence.toFixed(3),
    tempoCandidates: analysis.tempoCandidates,
    durationMs: Math.round(analysis.durationMs),
    featureFrames: analysis.features.length,
    candidateCount: analysis.candidates.length,
    validationFailures,
    elapsedMs: +(performance.now() - start).toFixed(1),
    difficulties: charts.map(c => ({ difficulty: c.chart.metadata.difficulty, notes: c.chart.notes.length, notesPerSecond: +c.diagnostics.notesPerSecond.toFixed(2), warningCount: c.diagnostics.warnings.length, warnings: c.diagnostics.warnings })),
  });
}
const output = path.resolve('benchmarks/latest-report.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Synthetic audio benchmark report: ${output}`);
for (const r of report.fixtures) {
  console.log(`${r.name.padEnd(24)} expected ${String(r.expectedBpm).padStart(3)} BPM · estimated ${String(r.estimatedBpm).padStart(3)} BPM · ${String(r.candidateCount).padStart(4)} candidates · validation errors ${r.validationFailures} · ${r.elapsedMs} ms`);
}
