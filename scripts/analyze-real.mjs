#!/usr/bin/env node
// Dùng: node scripts/analyze-real.mjs a.mp3 b.mp3 ...  (cần ffmpeg). Đo tempo map + độ khớp ĐỘC LẬP (đỉnh onset mạnh vs lưới 1/8).
import { spawnSync } from 'node:child_process';
import { analyzeSamples } from '../core.js'; import { buildTempoMap, rhythmicEvidence, getBeatPosition, getLocalBeatPeriod } from '../tempomap.js';
for (const file of process.argv.slice(2)) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '22050', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 }); if (r.status) { console.error(file, 'ffmpeg lỗi:', r.stderr.toString()); continue; }
  const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 2), an = analyzeSamples(x, 22050), m = buildTempoMap(an), f = an.features, pk = [];
  for (let k = 2; k < f.length - 2; k++) if (f[k].onset > .5 && f[k].onset >= f[k - 1].onset && f[k].onset > f[k + 1].onset) pk.push(f[k].timeMs);
  const dev = pk.map(t => { const p = getBeatPosition(m, t) * 2; return Math.abs(p - Math.round(p)) * getLocalBeatPeriod(m, t) / 2; }), near = dev.filter(d => d <= 35).length / Math.max(1, dev.length);
  console.log(`${file}\n  ${(an.durationMs / 1000).toFixed(0)}s · core ${an.bpm.toFixed(1)} · map ${m.segments.map(s => `${s.bpm.toFixed(1)}@${(s.startTime / 1000).toFixed(0)}s(c${s.confidence.toFixed(2)})`).join(' ')} · nhịp ${rhythmicEvidence(an).strongPerMin}/phút · ${(near * 100).toFixed(0)}% đỉnh mạnh trong ±35ms của lưới 1/8`);
}
