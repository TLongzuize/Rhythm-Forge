#!/usr/bin/env node
// Đo thời gian thật của engine 2.x trên âm thanh tổng hợp (Node, không phải trình duyệt).
import fs from 'node:fs'; import { performance } from 'node:perf_hooks';
import { analyzeSamples, demoAnalysis } from '../core.js'; import { buildTempoMap } from '../tempomap.js'; import { generateSmart, MODES } from '../smartgen.js';
import { fingerprint, cacheKey, createAnalysisCache, memoryStore } from '../cache.js'; import { synthClicks } from '../tests/helpers.js';
const t = fn => { const s = performance.now(), r = fn(); return [performance.now() - s, r]; }, out = { node: process.version, results: {} };
for (const sec of [30, 180]) {
  const a = synthClicks({ segments: [{ bpm: 128, ms: sec * 1000 }], startMs: 200, eighths: true }), [ta, an] = t(() => analyzeSamples(a.samples, a.sr)), [tt] = t(() => buildTempoMap(an)), [tf] = t(() => fingerprint(a.samples)), [tg, g] = t(() => generateSmart(an, 'b', { difficulty: 'hard', seed: 1 }));
  out.results[`${sec}s`] = { analyzeMs: +ta.toFixed(0), tempoMapMs: +tt.toFixed(0), fingerprintMs: +tf.toFixed(1), generateHardMs: +tg.toFixed(0), notes: g.chart.notes.length, quality: g.chart.quality.overall };
}
const A = demoAnalysis(), runs = []; for (const mode of Object.keys(MODES)) for (const d of ['easy', 'normal', 'hard', 'expert']) { const [ms] = t(() => generateSmart(A, 'd', { difficulty: d, mode, seed: 2 })); runs.push(ms); }
out.results.demo24Modes = { runs: runs.length, meanMs: +(runs.reduce((x, y) => x + y) / runs.length).toFixed(1), maxMs: +Math.max(...runs).toFixed(1) };
const c = createAnalysisCache({ store: memoryStore() }), key = cacheKey('bench', {}); const [ts] = t(() => 0); await c.set(key, A); const s0 = performance.now(); await c.get(key); out.results.cacheHitMs = +(performance.now() - s0).toFixed(2);
fs.mkdirSync('benchmarks', { recursive: true }); fs.writeFileSync('benchmarks/engine2-perf.json', JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 2));
