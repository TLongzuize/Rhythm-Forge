import os from 'node:os';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { analyzePlay } from '../performance-analysis.js';

function dataset(size) {
  return Array.from({ length: size }, (_, index) => {
    const expectedTimeMs = index * 72;
    const judgement = index % 97 === 0 ? 'miss' : index % 13 === 0 ? 'great' : 'marvelous';
    const lane = index % 4;
    return {
      id: `event-${index}`, noteId: `note-${index}`, expectedTimeMs,
      actualTimeMs: judgement === 'miss' ? null : expectedTimeMs + ((index % 9) - 4) * 1.5,
      hitErrorMs: judgement === 'miss' ? null : ((index % 9) - 4) * 1.5,
      lane, noteType: index % 19 === 0 ? 'hold-head' : 'tap', judgement,
      combo: judgement === 'miss' ? 0 : index + 1,
      patternId: index % 40 < 10 ? 'roll' : index % 40 < 20 ? 'jackPair' : null,
      difficulty: 'hard', density: 13,
    };
  });
}

const report = {
  runtime: process.version,
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model ?? 'unknown',
  logicalCores: os.cpus().length,
  sizes: [],
};
for (const size of [1_000, 10_000, 50_000, 100_000]) {
  const events = dataset(size);
  const memoryBefore = process.memoryUsage().heapUsed;
  analyzePlay({ events, maxCombo: size, maxPossibleCombo: size, chartMetadata: { difficulty: 'hard', difficultyRating: 8 } });
  const samples = [];
  let analysis;
  for (let iteration = 0; iteration < 3; iteration++) {
    const start = performance.now();
    analysis = analyzePlay({ events, maxCombo: Math.floor(size * .8), maxPossibleCombo: size, chartMetadata: { difficulty: 'hard', difficultyRating: 8 } });
    samples.push(performance.now() - start);
  }
  const memoryAfter = process.memoryUsage().heapUsed;
  report.sizes.push({
    events: size,
    runsMs: samples.map(value => Number(value.toFixed(2))),
    medianMs: Number([...samples].sort((a, b) => a - b)[1].toFixed(2)),
    heapDeltaMiB: Number(((memoryAfter - memoryBefore) / 1024 / 1024).toFixed(2)),
    timingSamples: analysis.timing.overall.sampleSize,
    skillStatuses: Object.fromEntries(Object.entries(analysis.skills).filter(([, value]) => value?.status).map(([key, value]) => [key, value.status])),
  });
  console.log(JSON.stringify(report.sizes.at(-1)));
}
writeFileSync('ADVANCED_PERFORMANCE_ANALYSIS_BENCHMARK.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
