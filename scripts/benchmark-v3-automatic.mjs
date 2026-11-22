import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { synthClicks, synthRamp } from '../tests/helpers.js';
import { analyzeV3 } from '../v3/timeline.js';
import { generateV3Set } from '../v3/engine.js';

const [phase, baselinePath] = process.argv.slice(2);
assert.ok(phase === 'before' || (phase === 'after' && baselinePath),
  'Usage: node scripts/benchmark-v3-automatic.mjs before|after [before.json]');

const sr = 22050;
const bytes = execFileSync('ffmpeg', [
  '-v','error','-i','public/audio/forge-demo.wav','-ac','1','-ar',String(sr),'-f','f32le','-'
], { maxBuffer: 8 * 1024 * 1024 });
const fixtures = [
  ['bundled demo', new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)],
  ['fractional pulse', synthClicks({ sr, startMs:137, segments:[{bpm:127.43,ms:24000}] }).samples],
  ['tempo ramp', synthRamp({ sr, bpm0:90,bpm1:150,ms:30000 }).samples],
  ['long accented eighths', synthClicks({ sr, eighths:true, accentEvery:4, segments:[{bpm:174,ms:180000}] }).samples]
];

const hash = input => createHash('sha256').update(input).digest('hex');
const digest = input => hash(JSON.stringify(input));
function summarize(results) {
  return results.map(({chart, diagnostics}) => {
    const {effort, policyRevision, generationOptions, ...generator} = chart.generator;
    return {
      difficulty: chart.metadata.difficulty, chart: digest({...chart,generator}),
      notes: digest(chart.notes), timing: digest(generator.tempoMap),
      heads: digest([...new Set(chart.notes.map(n=>n.timeMs))]),
      noteCount: chart.notes.length, candidates: diagnostics.candidates,
      utility: diagnostics.utility, policyRevision
    };
  });
}

const report = { phase, node: process.version, rows: [] };
for (const [fixture, samples] of fixtures) {
  const analysis = analyzeV3(samples, sr);
  const regimes = phase === 'before' ? ['medium','max'] : ['automatic'];
  for (const resourceClass of ['standard','compact']) {
    for (const regime of regimes) {
      const settings = {seed:1337, mode:'balanced', resourceClass,
        ...(regime === 'automatic' ? {compositionRevision:'event-1'} : {effort:regime})};
      const generation = () => generateV3Set(analysis, fixture, settings);
      const charts = summarize(generation()); // Warm-up and reference for repeat determinism.
      const control = phase === 'after'
        ? () => generateV3Set(analysis, fixture, {...settings, effort:'medium'})
        : null;
      const controlCharts = control && summarize(control());
      const controlTimes = [];
      const elapsed = Array.from({length:7}, (_, trial) => {
        const measureControl = () => {
          const start = performance.now();
          const result = control();
          controlTimes.push(performance.now() - start);
          assert.deepEqual(summarize(result), controlCharts);
        };
        if (control && trial % 2 === 0) measureControl();
        const start = performance.now();
        const result = generation();
        const ms = performance.now()-start;
        assert.deepEqual(summarize(result), charts);
        if (control && trial % 2 !== 0) measureControl();
        return ms;
      }).sort((a,b)=>a-b);
      report.rows.push({fixture,resourceClass,regime,attacks:analysis.events.length,
        medianMs:+elapsed[3].toFixed(3),
        ...(control ? { mediumControlMedianMs:+controlTimes.sort((a,b)=>a-b)[3].toFixed(3) } : {}),
        charts});
    }
  }
}
if (phase === 'after') {
  const saved = JSON.parse(readFileSync(baselinePath,'utf8'));
  const before = saved.before ?? saved;
  for (const row of report.rows) {
    const old = before.rows.find(r=>r.fixture===row.fixture&&r.resourceClass===row.resourceClass&&r.regime==='medium');
    assert.ok(old);
    assert.deepEqual(row.charts.map(({policyRevision,...chart})=>chart),old.charts);
  }
}
report.peakProcessRssKiB = process.resourceUsage().maxRSS;
console.log(JSON.stringify(report,null,2));
