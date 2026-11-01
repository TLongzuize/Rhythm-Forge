#!/usr/bin/env node
/** Prints hold-note length distribution and pattern variety for the demo WAV (or a WAV path given as argv[2]). */
import fs from 'node:fs';
import { analyzeSamples, generateAllDifficulties } from '../core.js';
const buf = fs.readFileSync(process.argv[2] || new URL('../public/audio/forge-demo.wav', import.meta.url));
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let p = 12, fmt, data;
while (p < buf.length - 8) { const id = buf.toString('ascii', p, p + 4), sz = dv.getUint32(p + 4, true); if (id === 'fmt ') fmt = { ch: dv.getUint16(p + 10, true), sr: dv.getUint32(p + 12, true), bits: dv.getUint16(p + 22, true) }; if (id === 'data') { data = [p + 8, sz]; break; } p += 8 + sz + (sz & 1); }
const n = Math.floor(data[1] / (fmt.bits / 8) / fmt.ch), samples = new Float32Array(n);
for (let i = 0; i < n; i++) samples[i] = dv.getInt16(data[0] + i * fmt.ch * 2, true) / 32768;
const analysis = analyzeSamples(samples, fmt.sr), beat = 60000 / analysis.bpm;
console.log(`BPM ${analysis.bpm}, duration ${Math.round(analysis.durationMs)} ms`);
for (const { chart, diagnostics: d } of generateAllDifficulties(analysis, 'stat', 1337)) {
  const holds = chart.notes.filter(x => x.type === 'hold'), L = holds.map(h => (h.endTimeMs - h.timeMs) / beat);
  const b = { short: L.filter(x => x < .9).length, mid: L.filter(x => x >= .9 && x < 1.9).length, long: L.filter(x => x >= 1.9).length };
  console.log(chart.metadata.difficulty.padEnd(7), 'notes', chart.notes.length, 'holds', holds.length, `(${(holds.length / chart.notes.length * 100).toFixed(1)}%)`, JSON.stringify(b), 'minBeats', Math.min(...L).toFixed(2), 'maxBeats', Math.max(...L).toFixed(2), 'patterns', d.patternNames.length, 'errors', d.validationErrors, 'warn', d.warnings.length);
}
