// Deep-dive investigation: V2 onset alignment and hold placement on real audio.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeSamples, generateChart } from '../core.js';
import { buildTempoMap, getBeatPosition, getLocalBeatPeriod } from '../tempomap.js';
import { generateRfV2 } from '../rfgen-v2.js';

const SR = 22050;
const AUDIO_DIR = path.resolve('audio_file_to_test');

function decodeMp3(file) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.toString()}`);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 4);
}

function onsetNear(analysis, tMs, radiusMs = 40) {
  const f = analysis.features || [];
  const hop = f.length > 1 ? (f[1].timeMs - f[0].timeMs) || 10 : 10;
  const t0 = f[0]?.timeMs || 0;
  const i = Math.round((tMs - t0) / hop);
  const k = Math.max(1, Math.round(radiusMs / hop));
  let maxOnset = 0, maxRms = 0;
  for (let j = i - k; j <= i + k; j++) {
    const v = f[j]?.onset || 0;
    const rv = f[j]?.rms || 0;
    if (v > maxOnset) maxOnset = v;
    if (rv > maxRms) maxRms = rv;
  }
  return { onset: maxOnset, rms: maxRms };
}

function classifyNotePlacement(notes, analysis, map) {
  const f = analysis.features || [];
  const hop = f.length > 1 ? (f[1].timeMs - f[0].timeMs) || 10 : 10;
  const t0 = f[0]?.timeMs || 0;
  const maxRms = Math.max(1e-6, ...f.map(x => x.rms || 0));

  let onGridOnset = 0, onGridNoOnset = 0, offGrid = 0;
  let quietNoOnset = 0, quietWithOnset = 0;
  const details = [];

  for (const n of notes) {
    const { onset, rms } = onsetNear(analysis, n.timeMs, 35);
    const q = rms / maxRms;
    const onGrid = Math.abs(((n.timeMs - (analysis.beatOffsetMs || 0)) % 41.67 + 41.67) % 41.67) < 15 || Math.abs(((n.timeMs - (analysis.beatOffsetMs || 0)) % 41.67 + 41.67) % 41.67 - 41.67) < 15;

    if (onset >= 0.3 && onGrid) onGridOnset++;
    else if (onset < 0.3 && onGrid) {
      onGridNoOnset++;
      if (q < 0.15) quietNoOnset++;
    }
    else offGrid++;
    if (q < 0.15 && onset >= 0.3) quietWithOnset++;

    details.push({ timeMs: n.timeMs, lane: n.lane, type: n.type, onset: +onset.toFixed(3), q: +q.toFixed(3), onGrid });
  }
  return { onGridOnset, onGridNoOnset, offGrid, quietNoOnset, quietWithOnset, details };
}

const files = fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3')).sort();

for (const file of files.slice(0, 4)) { // Deep dive on first 4 files
  const filePath = path.join(AUDIO_DIR, file);
  const samples = decodeMp3(filePath);
  const analysis = analyzeSamples(samples, SR);
  const map = buildTempoMap(analysis);

  console.log(`\n========== ${file} ==========`);
  console.log(`  Duration: ${(analysis.durationMs / 1000).toFixed(1)}s, Core BPM: ${analysis.bpm.toFixed(1)}, Map: ${map.segments.map(s => `${+s.bpm.toFixed(1)}`).join(' | ')}`);

  for (const difficulty of ['normal', 'expert']) {
    const v1 = generateChart(analysis, file, { difficulty, seed: 42 }).chart;
    const v2 = generateRfV2(analysis, file, { difficulty, seed: 42 }).chart;

    const v1c = classifyNotePlacement(v1.notes, analysis, map);
    const v2c = classifyNotePlacement(v2.notes, analysis, map);

    console.log(`\n  ${difficulty}:`);
    console.log(`    V1: notes=${v1.notes.length} onGrid+onset=${v1c.onGridOnset} onGrid-noOnset=${v1c.onGridNoOnset} offGrid=${v1c.offGrid} quietNoOnset=${v1c.quietNoOnset}`);
    console.log(`    V2: notes=${v2.notes.length} onGrid+onset=${v2c.onGridOnset} onGrid-noOnset=${v2c.onGridNoOnset} offGrid=${v2c.offGrid} quietNoOnset=${v2c.quietNoOnset}`);

    // Show V2 notes with no onset on grid (potentially misplaced)
    const v2Bad = v2c.details.filter(d => d.onset < 0.2 && d.q < 0.15 && d.onGrid);
    console.log(`    V2 notes on grid with no onset & quiet: ${v2Bad.length}`);
    if (v2Bad.length > 0) {
      console.log(`    Examples: ${v2Bad.slice(0, 5).map(d => `t=${d.timeMs} lane=${d.lane} onset=${d.onset} rms=${d.q}`).join(', ')}`);
    }

    // V2 holds
    const v2Holds = v2.notes.filter(n => n.type === 'hold');
    console.log(`    V2 holds: ${v2Holds.length}`);
    if (v2Holds.length > 0) {
      const holdLens = v2Holds.map(h => h.endTimeMs - h.timeMs);
      console.log(`    V2 hold lengths (ms): min=${Math.min(...holdLens)} max=${Math.max(...holdLens)} avg=${+(holdLens.reduce((a,b)=>a+b,0)/holdLens.length).toFixed(0)}`);
    }
  }
}
