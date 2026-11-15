// Real-audio hold validation: V1 vs V2 on all 12 MP3 files.
// Uses tempo map for correct beat calculations on variable-tempo songs.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeSamples, generateChart } from '../core.js';
import { generateRfV2, validateRfV2Chart } from '../rfgen-v2.js';
import { buildTempoMap, getBeatPosition, getBeatTime, getLocalBeatPeriod } from '../tempomap.js';

const SR = 22050;
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const AUDIO_DIR = path.resolve(PROJECT_ROOT, 'audio_file_to_test');
const OUT_DIR = path.resolve(PROJECT_ROOT, 'hold-validation');
fs.mkdirSync(OUT_DIR, { recursive: true });

function decodeMp3(file) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${file}: ${r.stderr.toString()}`);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
}

// Check if a time is on a permitted grid position (1/16 or its subdivisions)
function gridErrorMs(map, t) {
  const pos = getBeatPosition(map, t) * 4; // convert to 16ths
  const k = Math.round(pos);
  const snapped = getBeatTime(map, k / 4);
  return Math.abs(t - snapped);
}

function holdStats(chart, map) {
  const holds = chart.notes.filter(n => n.type === 'hold');
  const taps = chart.notes.filter(n => n.type === 'tap');

  // Hold durations in LOCAL beats (using tempo map)
  const durBeats = holds.map(h => {
    const startBeat = getBeatPosition(map, h.timeMs);
    const endBeat = getBeatPosition(map, h.endTimeMs);
    return endBeat - startBeat;
  });

  // Check overlap: holds should not overlap same-lane notes
  const byLane = new Map();
  for (const n of chart.notes) {
    const b = byLane.get(n.lane) || [];
    b.push(n);
    byLane.set(n.lane, b);
  }
  let overlaps = 0;
  for (const [lane, notes] of byLane) {
    const sorted = [...notes].sort((a, b) => a.timeMs - b.timeMs);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], cur = sorted[i];
      if (prev.type === 'hold' && prev.endTimeMs > cur.timeMs + 5) overlaps++;
    }
  }

  // Chords at hold start times (multiple notes at same timestamp)
  const byTime = new Map();
  for (const n of chart.notes) {
    const b = byTime.get(n.timeMs) || [];
    b.push(n);
    byTime.set(n.timeMs, b);
  }
  let holdsOnChords = 0;
  for (const h of holds) {
    const g = byTime.get(h.timeMs);
    if (g && g.length > 1) holdsOnChords++;
  }

  // Grid alignment errors (1/16 grid tolerance: 5ms)
  let offGridHeads = 0, offGridTails = 0, maxHeadErr = 0, maxTailErr = 0;
  for (const h of holds) {
    const headErr = gridErrorMs(map, h.timeMs);
    const tailErr = gridErrorMs(map, h.endTimeMs);
    maxHeadErr = Math.max(maxHeadErr, headErr);
    maxTailErr = Math.max(maxTailErr, tailErr);
    if (headErr > 5) offGridHeads++;
    if (tailErr > 5) offGridTails++;
  }

  // Max active holds
  const events = [];
  for (const h of holds) {
    events.push({ time: h.timeMs, type: 'start' });
    events.push({ time: h.endTimeMs, type: 'end' });
  }
  events.sort((a, b) => a.time - b.time || (a.type === 'end' ? -1 : 1));
  let active = 0, maxActive = 0;
  for (const e of events) {
    if (e.type === 'start') { active++; maxActive = Math.max(maxActive, active); }
    else active--;
  }

  // Min/max beat violations
  const difficulty = chart.metadata.difficulty;
  const minBeats = { easy: 0.5, normal: 0.5, hard: 0.5, expert: 0.5 }[difficulty];
  const maxBeats = { easy: 2.5, normal: 3.0, hard: 3.5, expert: 4.0 }[difficulty];
  let minViolations = 0, maxViolations = 0;
  for (const d of durBeats) {
    if (d < minBeats - 0.05) minViolations++;
    if (d > maxBeats + 0.1) maxViolations++;
  }

  return {
    holdCount: holds.length,
    tapCount: taps.length,
    holdToNoteRatio: chart.notes.length ? holds.length / chart.notes.length : 0,
    avgHoldBeats: durBeats.length ? durBeats.reduce((a, b) => a + b, 0) / durBeats.length : 0,
    maxHoldBeats: durBeats.length ? Math.max(...durBeats) : 0,
    minHoldBeats: durBeats.length ? Math.min(...durBeats) : 0,
    overlaps,
    holdsOnChords,
    offGridHeads,
    offGridTails,
    maxHeadErrMs: +maxHeadErr.toFixed(1),
    maxTailErrMs: +maxTailErr.toFixed(1),
    maxActive,
    minBeatViolations: minViolations,
    maxBeatViolations: maxViolations,
    holdDurations: durBeats.map(d => +d.toFixed(2)),
  };
}

const requested = process.argv.slice(2).map(x => x.toLocaleLowerCase());
const files = fs.readdirSync(AUDIO_DIR)
  .filter(f => f.endsWith('.mp3'))
  .filter(f => !requested.length || requested.some(q => f.toLocaleLowerCase().includes(q)))
  .sort();
if (!files.length) throw new Error(`No MP3 matched: ${process.argv.slice(2).join(', ')}`);
const report = { generatedAt: new Date().toISOString(), sampleRate: SR, files: [] };

console.log('=== V1 vs V2 Hold Validation on Real Audio ===\n');

for (const file of files) {
  const filePath = path.join(AUDIO_DIR, file);
  console.log(`\n--- ${file} ---`);
  const samples = decodeMp3(filePath);
  const analysis = analyzeSamples(samples, SR);
  const dur = analysis.durationMs / 1000;
  const map = buildTempoMap(analysis);
  console.log(`  Duration: ${dur.toFixed(1)}s, BPM: ${analysis.bpm.toFixed(1)}, conf: ${analysis.bpmConfidence.toFixed(2)}, Tempo segments: ${map.segments.length}`);

  const fileResult = { file, durationMs: analysis.durationMs, bpm: analysis.bpm, bpmConfidence: analysis.bpmConfidence, tempoSegments: map.segments.length, v1: {}, v2: {} };

  for (const difficulty of ['normal', 'hard', 'expert']) {
    // V1
    const v1 = generateChart(analysis, file, { difficulty, seed: 42 }).chart;
    const v1Stats = holdStats(v1, map);
    console.log(`  V1 ${difficulty}: holds=${v1Stats.holdCount} taps=${v1Stats.tapCount} ratio=${(v1Stats.holdToNoteRatio * 100).toFixed(1)}% avgDur=${v1Stats.avgHoldBeats.toFixed(2)}b overlaps=${v1Stats.overlaps} onChords=${v1Stats.holdsOnChords} offGridH=${v1Stats.offGridHeads} offGridT=${v1Stats.offGridTails} maxActive=${v1Stats.maxActive}`);
    fileResult.v1[difficulty] = v1Stats;

    // V2
    const v2 = generateRfV2(analysis, file, { difficulty, seed: 42 }).chart;
    const v2Stats = holdStats(v2, map);
    const v2Val = validateRfV2Chart(v2);
    console.log(`  V2 ${difficulty}: holds=${v2Stats.holdCount} taps=${v2Stats.tapCount} ratio=${(v2Stats.holdToNoteRatio * 100).toFixed(1)}% avgDur=${v2Stats.avgHoldBeats.toFixed(2)}b overlaps=${v2Stats.overlaps} onChords=${v2Stats.holdsOnChords} offGridH=${v2Stats.offGridHeads} offGridT=${v2Stats.offGridTails} maxActive=${v2Stats.maxActive} minVio=${v2Stats.minBeatViolations} maxVio=${v2Stats.maxBeatViolations} valid=${v2Val.valid}`);
    fileResult.v2[difficulty] = v2Stats;
  }

  report.files.push(fileResult);
}

const reportPath = path.join(OUT_DIR, requested.length ? 'hold-validation-filtered-report.json' : 'hold-validation-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nReport written to ${reportPath}`);
