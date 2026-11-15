// Real-audio validation harness for RF Generator V1 vs V2.
// Decodes MP3s via ffmpeg, runs both generators, collects musical quality metrics.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeSamples, generateChart, generateAllDifficulties, validateChart } from '../core.js';
import { buildTempoMap, rhythmicEvidence, getBeatPosition, getLocalBeatPeriod, getTempoAt } from '../tempomap.js';
import { generateRfV2, generateAllRfV2, validateRfV2Chart } from '../rfgen-v2.js';

const SR = 22050;
const AUDIO_DIR = path.resolve('audio_file_to_test');
const OUT_DIR = path.resolve('benchmarks');
fs.mkdirSync(OUT_DIR, { recursive: true });

function decodeMp3(file) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${file}: ${r.stderr.toString()}`);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
}

// Count chord events (same time, >1 lane)
function chordStats(notes) {
  const byTime = new Map();
  for (const n of notes) {
    const b = byTime.get(n.timeMs) || []; b.push(n); byTime.set(n.timeMs, b);
  }
  let chords = 0, jumpChords = 0, maxSize = 1;
  for (const g of byTime.values()) {
    if (g.length > 1) {
      chords++;
      if (g.length > maxSize) maxSize = g.length;
      if (g.length === 2 && Math.abs(g[0].lane - g[1].lane) >= 2) jumpChords++;
    }
  }
  return { chords, jumpChords, maxChordSize: maxSize };
}

// Count hold stats
function holdStats(notes) {
  const holds = notes.filter(n => n.type === 'hold');
  let totalBeats = 0, short = 0, medium = 0, long = 0;
  for (const h of holds) {
    const lenMs = h.endTimeMs - h.timeMs;
    totalBeats += lenMs;
    if (lenMs < 500) short++; else if (lenMs < 1500) medium++; else long++;
  }
  return { holdCount: holds.length, totalHoldMs: totalBeats, short, medium, long };
}

// Pattern diversity
function patternStats(chart) {
  const pats = chart.generator?.patterns || [];
  const ids = [...new Set(pats.map(p => p.id))];
  return { patternCount: pats.length, uniquePatterns: ids.length, patternIds: ids };
}

// Section stats
function sectionStats(chart) {
  const secs = chart.generator?.sections || [];
  const labels = secs.map(s => s.label);
  const labelCounts = {};
  for (const l of labels) labelCounts[l] = (labelCounts[l] || 0) + 1;
  return { sectionCount: secs.length, labelCounts, labels };
}

// Silence handling: notes in sections labeled Silence
function silenceNotes(chart) {
  const secs = (chart.generator?.sections || []).filter(s => s.label === 'Silence');
  let count = 0, detail = [];
  for (const s of secs) {
    const n = chart.notes.filter(x => x.timeMs >= s.startMs && x.timeMs < s.endMs);
    count += n.length;
    if (n.length > 0) detail.push({ startMs: s.startMs, endMs: s.endMs, noteCount: n.length });
  }
  return { silenceSectionCount: secs.length, notesInSilence: count, detail };
}

// Onset alignment: fraction of notes near a strong onset
function onsetAlignment(notes, analysis, toleranceMs = 40) {
  const f = analysis.features || [];
  const hop = f.length > 1 ? (f[1].timeMs - f[0].timeMs) || 10 : 10;
  const t0 = f[0]?.timeMs || 0;
  let aligned = 0, total = 0;
  for (const n of notes) {
    const i = Math.round((n.timeMs - t0) / hop);
    let maxOnset = 0;
    for (let j = i - 3; j <= i + 3; j++) {
      const v = f[j]?.onset || 0;
      if (v > maxOnset) maxOnset = v;
    }
    total++;
    if (maxOnset >= 0.3) aligned++;
  }
  return { aligned, total, ratio: total ? aligned / total : 0 };
}

// BPM accuracy vs detected tempo
function bpmInfo(analysis, map) {
  return {
    coreBpm: +analysis.bpm.toFixed(2),
    coreConfidence: +analysis.bpmConfidence.toFixed(3),
    mapBpms: map.segments.map(s => `${+s.bpm.toFixed(1)}@${Math.round(s.startTime)}s(c${+s.confidence.toFixed(2)})`),
    strongPerMin: rhythmicEvidence(analysis).strongPerMin,
    hasRhythm: rhythmicEvidence(analysis).hasRhythm,
  };
}

const files = fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3')).sort();
const report = { generatedAt: new Date().toISOString(), sampleRate: SR, files: [] };

for (const file of files) {
  const filePath = path.join(AUDIO_DIR, file);
  console.log(`\n=== ${file} ===`);
  const samples = decodeMp3(filePath);
  const analysis = analyzeSamples(samples, SR);
  const dur = analysis.durationMs / 1000;
  const map = buildTempoMap(analysis);

  console.log(`  Duration: ${dur.toFixed(1)}s, Core BPM: ${analysis.bpm.toFixed(1)} (conf ${analysis.bpmConfidence.toFixed(2)}), Tempo map: ${map.segments.map(s => `${+s.bpm.toFixed(1)}@${Math.round(s.startTime)}s`).join(' | ')}`);
  console.log(`  Strong onsets/min: ${rhythmicEvidence(analysis).strongPerMin.toFixed(1)}, Has rhythm: ${rhythmicEvidence(analysis).hasRhythm}`);

  const fileResult = { file, durationMs: analysis.durationMs, bpmInfo: bpmInfo(analysis, map), v1: {}, v2: {} };

  // ---- V1 ----
  console.log('  V1 (RF Generator V1):');
  const v1Charts = generateAllDifficulties(analysis, file, 42);
  for (const c of v1Charts) {
    const ch = c.chart;
    const v = validateChart(ch);
    const cs = chordStats(ch.notes);
    const hs = holdStats(ch.notes);
    const ps = patternStats(ch);
    const ss = sectionStats(ch);
    const sl = silenceNotes(ch);
    const oa = onsetAlignment(ch.notes, analysis);
    console.log(`    ${ch.metadata.difficulty}: notes=${ch.notes.length} nps=${c.diagnostics.notesPerSecond} chords=${cs.chords} (jump=${cs.jumpChords}) holds=${hs.holdCount} patterns=${ps.uniquePatterns} sections=${ss.sectionCount} silenceNotes=${sl.notesInSilence} onsetAlign=${(oa.ratio * 100).toFixed(0)}% valid=${v.valid}`);
    fileResult.v1[ch.metadata.difficulty] = {
      notes: ch.notes.length, nps: c.diagnostics.notesPerSecond,
      chords: cs.chords, jumpChords: cs.jumpChords, maxChordSize: cs.maxChordSize,
      holdCount: hs.holdCount, totalHoldMs: hs.totalHoldMs,
      patternCount: ps.patternCount, uniquePatterns: ps.uniquePatterns,
      sectionCount: ss.sectionCount, sectionLabels: ss.labelCounts,
      silenceNotes: sl.notesInSilence, onsetAlignRatio: oa.ratio,
      valid: v.valid, errors: v.errors,
      bpm: ch.metadata.bpm, rating: ch.metadata.difficultyRating,
      generator: ch.generator?.name,
    };
  }

  // ---- V2 ----
  console.log('  V2 (RF Generator V2):');
  const v2Charts = generateAllRfV2(analysis, file, 42);
  for (const c of v2Charts) {
    const ch = c.chart;
    const v = validateRfV2Chart(ch);
    const cs = chordStats(ch.notes);
    const hs = holdStats(ch.notes);
    const ps = patternStats(ch);
    const ss = sectionStats(ch);
    const sl = silenceNotes(ch);
    const oa = onsetAlignment(ch.notes, analysis);
    console.log(`    ${ch.metadata.difficulty}: notes=${ch.notes.length} nps=${c.diagnostics.notesPerSecond} chords=${cs.chords} (jump=${cs.jumpChords}) holds=${hs.holdCount} patterns=${ps.uniquePatterns} sections=${ss.sectionCount} silenceNotes=${sl.notesInSilence} onsetAlign=${(oa.ratio * 100).toFixed(0)}% valid=${v.valid}`);
    fileResult.v2[ch.metadata.difficulty] = {
      notes: ch.notes.length, nps: c.diagnostics.notesPerSecond,
      chords: cs.chords, jumpChords: cs.jumpChords, maxChordSize: cs.maxChordSize,
      holdCount: hs.holdCount, totalHoldMs: hs.totalHoldMs,
      patternCount: ps.patternCount, uniquePatterns: ps.uniquePatterns,
      sectionCount: ss.sectionCount, sectionLabels: ss.labelCounts,
      silenceNotes: sl.notesInSilence, onsetAlignRatio: oa.ratio,
      valid: v.valid, errors: v.errors,
      bpm: ch.metadata.bpm, rating: ch.metadata.difficultyRating,
      generator: ch.generator?.name,
      sections: ch.generator?.sections?.map(s => ({ label: s.label, startMs: s.startMs, endMs: s.endMs, energy: +s.energy.toFixed(2) })),
    };
  }

  report.files.push(fileResult);
}

const reportPath = path.join(OUT_DIR, 'real-audio-v1-v2-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nReport written to ${reportPath}`);
