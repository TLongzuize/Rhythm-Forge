// Section recognition and silence handling validation using synthetic audio.
import { analyzeSamples } from '../core.js';
import { buildTempoMap } from '../tempomap.js';
import { generateRfV2 } from '../rfgen-v2.js';


const SR = 22050;

// Build-up → Drop → Breakdown → Quiet → Silence structure (60 seconds)
function synthStructure() {
  const durationMs = 60000, x = new Float32Array(Math.ceil(durationMs / 1000 * SR));
  const bpm = 128, beat = 60000 / bpm;
  let t = 0;
  while (t < durationMs - 100) {
    let gain;
    if (t < 10000) gain = 0.15;           // 0-10s: Quiet intro
    else if (t < 20000) gain = 0.15 + (t - 10000) / 10000 * 0.55; // 10-20s: Build-up
    else if (t < 35000) gain = 0.9;       // 20-35s: Drop (high energy)
    else if (t < 45000) gain = 0.3;       // 35-45s: Breakdown (medium-low)
    else if (t < 50000) gain = 0.05;      // 45-50s: Very quiet
    else { t += beat; continue; }         // 50-60s: Genuine silence
    const i0 = Math.round(t / 1000 * SR);
    for (let i = 0; i < 400 && i0 + i < x.length; i++)
      x[i0 + i] += gain * Math.sin(2 * Math.PI * 120 * i / SR) * Math.exp(-i / (0.07 * SR));
    t += beat;
  }
  return { samples: x, sr: SR, durationMs };
}

const an = synthStructure();
const analysis = analyzeSamples(an.samples, an.sr);
const map = buildTempoMap(analysis);

console.log('=== Structure test ===');
console.log(`Duration: ${(an.durationMs / 1000).toFixed(0)}s, BPM: ${analysis.bpm.toFixed(1)}, conf: ${analysis.bpmConfidence.toFixed(2)}`);

for (const difficulty of ['normal', 'expert']) {
  const r = generateRfV2(analysis, 'structure-test', { difficulty, seed: 42 });
  const ch = r.chart;
  console.log(`\n${difficulty}: notes=${ch.notes.length} nps=${r.diagnostics.notesPerSecond.toFixed(2)}`);

  // Section labels detected
  const secs = ch.generator.sections;
  console.log('  Sections:');
  for (const s of secs) {
    const nInSec = ch.notes.filter(x => x.timeMs >= s.startMs && x.timeMs < s.endMs).length;
    const nps = nInSec / ((s.endMs - s.startMs) / 1000);
    console.log(`    ${s.label}: ${s.startMs}ms-${s.endMs}ms (${((s.endMs-s.startMs)/1000).toFixed(1)}s) energy=${s.energy.toFixed(2)} notes=${nInSec} nps=${nps.toFixed(2)}`);
  }

  // Silence check (50-60s)
  const silenceNotes = ch.notes.filter(n => n.timeMs >= 50000 && n.timeMs <= 60000);
  console.log(`  Notes in silence (50-60s): ${silenceNotes.length}`);

  // Quiet but audible check (45-50s)
  const quietNotes = ch.notes.filter(n => n.timeMs >= 45000 && n.timeMs < 50000);
  console.log(`  Notes in quiet passage (45-50s): ${quietNotes.length} nps=${(quietNotes.length / 5).toFixed(2)}`);

  // Build-up check (10-20s) should be denser than quiet intro (0-10s)
  const introNotes = ch.notes.filter(n => n.timeMs >= 0 && n.timeMs < 10000);
  const buildupNotes = ch.notes.filter(n => n.timeMs >= 10000 && n.timeMs < 20000);
  const dropNotes = ch.notes.filter(n => n.timeMs >= 20000 && n.timeMs < 35000);
  console.log(`  Intro (0-10s): ${introNotes.length} notes nps=${(introNotes.length/10).toFixed(2)}`);
  console.log(`  Build-up (10-20s): ${buildupNotes.length} notes nps=${(buildupNotes.length/10).toFixed(2)}`);
  console.log(`  Drop (20-35s): ${dropNotes.length} notes nps=${(dropNotes.length/15).toFixed(2)}`);
}

// Test short silence pause in middle of active music
function synthShortPause() {
  const durationMs = 30000, x = new Float32Array(Math.ceil(durationMs / 1000 * SR));
  const bpm = 140, beat = 60000 / bpm;
  let t = 0;
  while (t < durationMs - 100) {
    if (t >= 10000 && t < 12000) { t += beat; continue; } // 2s silence pause
    const i0 = Math.round(t / 1000 * SR);
    for (let i = 0; i < 400 && i0 + i < x.length; i++)
      x[i0 + i] += Math.sin(2 * Math.PI * 110 * i / SR) * Math.exp(-i / (0.06 * SR));
    t += beat;
  }
  return { samples: x, sr: SR, durationMs };
}

const an2 = synthShortPause();
const analysis2 = analyzeSamples(an2.samples, an2.sr);
const map2 = buildTempoMap(analysis2);

console.log('\n=== Short pause test (10-12s silence) ===');
const r2 = generateRfV2(analysis2, 'pause-test', { difficulty: 'hard', seed: 42 });
const ch2 = r2.chart;
const pauseNotes = ch2.notes.filter(n => n.timeMs >= 10000 && n.timeMs <= 12000);
const beforeNotes = ch2.notes.filter(n => n.timeMs >= 8000 && n.timeMs < 10000);
const afterNotes = ch2.notes.filter(n => n.timeMs > 12000 && n.timeMs <= 14000);
console.log(`  Notes in pause (10-12s): ${pauseNotes.length}`);
console.log(`  Notes before pause (8-10s): ${beforeNotes.length}`);
console.log(`  Notes after pause (12-14s): ${afterNotes.length}`);
console.log(`  Sections: ${ch2.generator.sections.map(s => `${s.label}(${s.startMs}-${s.endMs})`).join(', ')}`);

// Test sustained audio for holds
function synthSustain() {
  const durationMs = 20000, x = new Float32Array(Math.ceil(durationMs / 1000 * SR));
  // Sustained low-frequency drone from 2s to 18s
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    if (t >= 2 && t < 18) {
      x[i] += 0.4 * Math.sin(2 * Math.PI * 60 * i / SR); // sustained bass
    }
  }
  return { samples: x, sr: SR, durationMs };
}

const an3 = synthSustain();
const analysis3 = analyzeSamples(an3.samples, an3.sr);
const map3 = buildTempoMap(analysis3);

console.log('\n=== Sustained audio hold test (drone 2-18s) ===');
const r3 = generateRfV2(analysis3, 'sustain-test', { difficulty: 'expert', seed: 42 });
const ch3 = r3.chart;
const holds = ch3.notes.filter(n => n.type === 'hold');
console.log(`  Holds: ${holds.length}`);
if (holds.length > 0) {
  const holdLens = holds.map(h => h.endTimeMs - h.timeMs);
  console.log(`  Hold lengths: min=${Math.min(...holdLens)}ms max=${Math.max(...holdLens)}ms avg=${+(holdLens.reduce((a,b)=>a+b,0)/holdLens.length).toFixed(0)}ms`);
  // Check if holds are in the sustained region
  const holdsInSustain = holds.filter(h => h.timeMs >= 2000 && h.timeMs < 18000);
  console.log(`  Holds in sustained region (2-18s): ${holdsInSustain.length}/${holds.length}`);
}
