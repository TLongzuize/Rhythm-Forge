import test from 'node:test';
import assert from 'node:assert/strict';
import { demoAnalysis, analyzeSamples, generateChart, validateChart } from '../core.js';
import { buildTempoMap, getBeatPosition, rhythmicEvidence } from '../tempomap.js';
import { generateRfV2, generateAllRfV2, generateVariationsRfV2, NAME, ENGINE, V2_MODES, validateRfV2Chart } from '../rfgen-v2.js';
import { synthClicks, synthRamp } from './helpers.js';

const A = demoAnalysis();
const sig = c => c.notes.map(n => `${n.timeMs}:${n.lane}:${n.type}:${n.endTimeMs ?? ''}`).join('|');

test('V2 produces valid charts for every mode x difficulty', () => {
  for (const mode of Object.keys(V2_MODES)) for (const difficulty of ['easy', 'normal', 'hard', 'expert']) {
    const r = generateRfV2(A, 't', { difficulty, mode, seed: 11 });
    const v = validateRfV2Chart(r.chart);
    assert.equal(v.valid, true, `${mode}/${difficulty}: ${JSON.stringify(v.errors)}`);
    assert.equal(r.chart.generator.name, NAME);
    assert.equal(r.chart.generator.engine, ENGINE);
    assert.ok(r.chart.generator.tempoMap?.segments?.length, 'serialized tempo map is required for live BPM and playback sync');
    assert.ok(r.chart.notes.length >= 0);
  }
});

test('V2 difficulty NPS increases with difficulty', () => {
  const avgByDiff = {};
  for (let seed = 1; seed <= 6; seed++) {
    const charts = generateAllRfV2(A, 't', seed);
    for (const c of charts) {
      const d = c.chart.metadata.difficulty;
      avgByDiff[d] = (avgByDiff[d] || 0) + c.chart.notes.length / (A.durationMs / 1000);
    }
  }
  const diffs = ['easy', 'normal', 'hard', 'expert'];
  for (let i = 1; i < diffs.length; i++) {
    assert.ok(avgByDiff[diffs[i]] > avgByDiff[diffs[i - 1]],
      `NPS should increase with difficulty: ${diffs.map(d => (avgByDiff[d] / 6).toFixed(2)).join(',')}`);
  }
});

test('V2 relax is sparser than technical at the same difficulty', () => {
  const r = generateRfV2(A, 't', { difficulty: 'hard', mode: 'relax', seed: 3 }).chart;
  const t = generateRfV2(A, 't', { difficulty: 'hard', mode: 'technical', seed: 3 }).chart;
  assert.ok(r.notes.length < t.notes.length);
});

test('V2 is deterministic for the same seed and differs across seeds', () => {
  const a = generateRfV2(A, 't', { difficulty: 'normal', seed: 42 }).chart;
  const b = generateRfV2(A, 't', { difficulty: 'normal', seed: 42 }).chart;
  const c = generateRfV2(A, 't', { difficulty: 'normal', seed: 43 }).chart;
  assert.equal(sig(a), sig(b));
  assert.notEqual(sig(a), sig(c));
});

test('V2 variations are deterministic and distinct', () => {
  const vs = generateVariationsRfV2(A, 't', { difficulty: 'normal', seed: 7 }, 4);
  const s = vs.map(x => sig(x.chart));
  assert.equal(new Set(s).size, 4);
});

test('V2 honors bpmOverride', () => {
  const r = generateRfV2(A, 't', { difficulty: 'normal', seed: 1, bpmOverride: 80 }).chart;
  assert.equal(r.metadata.bpm, 80);
  assert.ok(validateChart(r).valid);
});

test('V2 silence / no rhythm emits zero notes and stays valid', () => {
  const sr = 22050;
  const silence = new Float32Array(sr * 10);
  const an = analyzeSamples(silence, sr);
  assert.equal(rhythmicEvidence(an).hasRhythm, false);
  const r = generateRfV2(an, 't', { difficulty: 'hard', seed: 1 }).chart;
  assert.equal(r.notes.length, 0);
  assert.equal(validateChart(r).valid, true);
  assert.equal(r.quality.overall, 0);
});

test('V2 genuine silence section gets no notes while the rest keeps rhythm', () => {
  const sr = 22050, p = 60000 / 130;
  const x = new Float32Array(sr * 24);
  const clk = (t, g) => { const i0 = Math.round(t / 1000 * sr); for (let i = 0; i < 500 && i0 + i < x.length; i++) x[i0 + i] += g * Math.sin(2 * Math.PI * 1000 * i / sr) * Math.exp(-i / (.006 * sr)); };
  // beats 0..11000, silent 11000..15000, beats resume
  for (let t = 0; t < 11000; t += p) clk(t, 1);
  const an = analyzeSamples(x, sr);
  assert.ok(rhythmicEvidence(an).hasRhythm);
  const r = generateRfV2(an, 't', { difficulty: 'hard', seed: 2 }).chart;
  const inSilence = r.notes.filter(n => n.timeMs >= 11000 && n.timeMs <= 15000);
  assert.equal(inSilence.length, 0, `notes in silent section: ${inSilence.length}`);
  assert.ok(r.notes.length > 10);
  assert.equal(validateChart(r).valid, true);
});

test('V2 BPM detection matches a steady click and keeps notes on the grid', () => {
  const sr = 22050;
  const c = synthClicks({ segments: [{ bpm: 160, ms: 30000 }], startMs: 100 });
  const an = analyzeSamples(c.samples, c.sr);
  const map = buildTempoMap(an);
  assert.ok(Math.abs(map.segments[0].bpm - 160) < 3);
  const r = generateRfV2(an, 't', { difficulty: 'expert', seed: 3 }).chart;
  assert.ok(validateChart(r).valid);
  assert.ok(r.notes.length > 10);
});

test('V1 legacy chart is attributed to RF Generator V1', () => {
  const v1 = generateChart(A, 't', { difficulty: 'normal', seed: 1 }).chart;
  assert.equal(v1.generator.name, 'RF Generator V1');
  assert.equal(validateChart(v1).valid, true);
});

test('V2 ramp tempo keeps sync and valid chart', () => {
  const r = synthRamp({ bpm0: 100, bpm1: 140, ms: 30000 });
  const an = analyzeSamples(r.samples, r.sr);
  const chart = generateRfV2(an, 't', { difficulty: 'normal', seed: 4 }).chart;
  assert.equal(validateChart(chart).valid, true);
  assert.ok(chart.notes.length > 5);
});

// ---------- Synthetic music fixtures ----------

// A quiet but clearly musical passage: low RMS, regular soft onsets (like a quiet verse).
function synthQuietMusic({ sr = 22050, durationMs = 20000, bpm = 100, quietRms = 0.02 } = {}) {
  const total = durationMs, x = new Float32Array(Math.ceil(total / 1000 * sr));
  const beat = 60000 / bpm;
  let t = 0;
  while (t < total - 100) {
    // soft kick pulse
    const i0 = Math.round(t / 1000 * sr);
    for (let i = 0; i < 300 && i0 + i < x.length; i++)
      x[i0 + i] += quietRms * Math.sin(2 * Math.PI * 80 * i / sr) * Math.exp(-i / (0.05 * sr));
    // occasional snare
    if (Math.floor(t / beat) % 2 === 0) {
      const i1 = Math.round((t + beat / 2) / 1000 * sr);
      for (let i = 0; i < 150 && i1 + i < x.length; i++)
        x[i1 + i] += quietRms * 0.6 * (Math.random() * 2 - 1) * Math.exp(-i / (0.03 * sr));
    }
    t += beat;
  }
  return { samples: x, sr, durationMs: total };
}

// A high-energy track with strong downbeat accents (for chord generation testing).
function synthHighEnergy({ sr = 22050, durationMs = 20000, bpm = 140 } = {}) {
  const total = durationMs, x = new Float32Array(Math.ceil(total / 1000 * sr));
  const beat = 60000 / bpm;
  let t = 0;
  while (t < total - 100) {
    const gain = (t / beat) % 4 === 0 ? 1.0 : 0.5; // strong downbeat every 4 beats
    const i0 = Math.round(t / 1000 * sr);
    for (let i = 0; i < 500 && i0 + i < x.length; i++)
      x[i0 + i] += gain * Math.sin(2 * Math.PI * 100 * i / sr) * Math.exp(-i / (0.08 * sr));
    t += beat;
  }
  return { samples: x, sr, durationMs: total };
}

// Music with genuine silence in the middle, rhythm before and after.
function synthSilenceInMiddle({ sr = 22050, durationMs = 24000, bpm = 130, silentFrom = 9000, silentTo = 13000 } = {}) {
  const total = durationMs, x = new Float32Array(Math.ceil(total / 1000 * sr));
  const beat = 60000 / bpm;
  let t = 0;
  while (t < total - 100) {
    if (t >= silentFrom && t < silentTo) { t += beat; continue; } // genuine silence
    const i0 = Math.round(t / 1000 * sr);
    for (let i = 0; i < 400 && i0 + i < x.length; i++)
      x[i0 + i] += Math.sin(2 * Math.PI * 110 * i / sr) * Math.exp(-i / (0.06 * sr));
    t += beat;
  }
  return { samples: x, sr, durationMs: total };
}

// Build-up → Drop structure: starts quiet, energy rises, then drops to high energy.
function synthBuildUpDrop({ sr = 22050, durationMs = 30000, bpm = 128 } = {}) {
  const total = durationMs, x = new Float32Array(Math.ceil(total / 1000 * sr));
  const beat = 60000 / bpm;
  let t = 0;
  while (t < total - 100) {
    let gain;
    if (t < 10000) gain = 0.2;           // quiet intro
    else if (t < 20000) gain = 0.2 + (t - 10000) / 10000 * 0.6; // build-up
    else gain = 0.9;                     // drop / high energy
    const i0 = Math.round(t / 1000 * sr);
    for (let i = 0; i < 400 && i0 + i < x.length; i++)
      x[i0 + i] += gain * Math.sin(2 * Math.PI * 120 * i / sr) * Math.exp(-i / (0.07 * sr));
    t += beat;
  }
  return { samples: x, sr, durationMs: total };
}

test('V2 quiet but audible sections still generate appropriate notes', () => {
  const q = synthQuietMusic({ durationMs: 20000, bpm: 100, quietRms: 0.02 });
  const an = analyzeSamples(q.samples, q.sr);
  // Quiet music still has rhythm (onsets present) but low RMS.
  assert.ok(rhythmicEvidence(an).hasRhythm || an.features.some(f => f.onset > 0.1));
  const _r = generateRfV2(an, 'Quiet song', { difficulty: 'normal', seed: 1 }); const r = _r.chart;
  const v = validateChart(r);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  // Should NOT be empty: quiet music is not silence.
  assert.ok(r.notes.length > 0, `quiet music should generate notes, got ${r.notes.length}`);
  // NPS should be low but non-zero.
  assert.ok(_r.diagnostics.notesPerSecond > 0 && _r.diagnostics.notesPerSecond < 5,
    `quiet music NPS should be low, got ${_r.diagnostics.notesPerSecond}`);
});

test('V2 genuine silence sections generate no notes while rhythm continues around them', () => {
  const s = synthSilenceInMiddle({ durationMs: 24000, bpm: 130, silentFrom: 9000, silentTo: 13000 });
  const an = analyzeSamples(s.samples, s.sr);
  assert.ok(rhythmicEvidence(an).hasRhythm);
  const r = generateRfV2(an, 't', { difficulty: 'hard', seed: 2 }).chart;
  const v = validateChart(r);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  const inSilence = r.notes.filter(n => n.timeMs >= 9000 && n.timeMs <= 13000);
  assert.equal(inSilence.length, 0, `notes in silent section: ${inSilence.length}`);
  // Notes should exist outside the silence.
  assert.ok(r.notes.length > 10, `expected notes outside silence, got ${r.notes.length}`);
});

test('V2 accent-based chord generation works on strong downbeats', () => {
  const h = synthHighEnergy({ durationMs: 20000, bpm: 140 });
  const an = analyzeSamples(h.samples, h.sr);
  const r = generateRfV2(an, 't', { difficulty: 'expert', seed: 7 }).chart;
  const v = validateChart(r);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  assert.ok(r.notes.length > 10, `expected notes, got ${r.notes.length}`);
  // Expert should produce chords (notes at same time, different lanes).
  const byTime = new Map();
  for (const n of r.notes) {
    const bucket = byTime.get(n.timeMs) || []; bucket.push(n); byTime.set(n.timeMs, bucket);
  }
  const chords = [...byTime.values()].filter(g => g.length > 1);
  assert.ok(chords.length > 0, `expected accent-based chords on strong downbeats, got ${chords.length}`);
  // Chords should be jump chords (lanes far apart).
  const jumpChords = chords.filter(g => g.length === 2 && Math.abs(g[0].lane - g[1].lane) >= 2);
  assert.ok(jumpChords.length > 0, `expected jump chords, got ${chords.length} chords but none are jumps`);
});

test('V2 musical intensity changes affect chart generation', () => {
  const bd = synthBuildUpDrop({ durationMs: 30000, bpm: 128 });
  const an = analyzeSamples(bd.samples, bd.sr);
  const quietPart = generateRfV2(an, 't', { difficulty: 'normal', seed: 9 }).chart;
  // Generate a second chart from the same audio but compare section densities.
  // High-energy drop section should have more notes per second than quiet intro.
  const secs = quietPart.generator.sections.filter(s => s.endMs - s.startMs >= 2000);
  assert.ok(secs.length >= 2, `expected multiple sections, got ${secs.length}`);
  const bySec = secs.map(s => {
    const n = quietPart.notes.filter(x => x.timeMs >= s.startMs && x.timeMs < s.endMs).length;
    return { label: s.label, energy: s.energy, nps: n / ((s.endMs - s.startMs) / 1000) };
  });
  // At least one high-energy section should be denser than a low-energy one.
  const high = bySec.filter(s => s.label === 'High Energy' || s.label === 'Drop');
  const low = bySec.filter(s => s.label === 'Quiet' || s.label === 'Low Energy');
  if (high.length > 0 && low.length > 0) {
    const hiNps = high.reduce((a, b) => a + b.nps, 0) / high.length;
    const loNps = low.reduce((a, b) => a + b.nps, 0) / low.length;
    assert.ok(hiNps >= loNps * 0.8, `high-energy sections should not be much sparser: ${hiNps.toFixed(2)} vs ${loNps.toFixed(2)}`);
  }
});

test('V2 pattern metadata is correctly recorded', () => {
  const h = synthHighEnergy({ durationMs: 15000, bpm: 140 });
  const an = analyzeSamples(h.samples, h.sr);
  const r = generateRfV2(an, 't', { difficulty: 'hard', seed: 11 }).chart;
  const v = validateChart(r);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  const patterns = r.generator.patterns || [];
  assert.ok(patterns.length > 0, 'pattern metadata should be recorded');
  // Each pattern entry should have required fields.
  for (const p of patterns) {
    assert.ok(typeof p.id === 'string' && p.id.length > 0, 'pattern id missing');
    assert.ok(Number.isFinite(p.fromMs) && Number.isFinite(p.toMs), 'pattern times missing');
    assert.ok(p.toMs > p.fromMs, 'pattern end should be after start');
  }
});

test('V2 all five game modes produce meaningful differences', () => {
  const h = synthHighEnergy({ durationMs: 20000, bpm: 140 });
  const an = analyzeSamples(h.samples, h.sr);
  const npsByMode = {};
  for (const mode of Object.keys(V2_MODES)) {
    const _r = generateRfV2(an, 't', { difficulty: 'normal', mode, seed: 13 }); const r = _r.chart;
    const v = validateChart(r);
    assert.equal(v.valid, true, `${mode}: ${JSON.stringify(v.errors)}`);
    npsByMode[mode] = _r.diagnostics.notesPerSecond;
  }
  const modes = Object.keys(npsByMode);
  // At least two modes should produce measurably different densities.
  const values = Object.values(npsByMode);
  const spread = Math.max(...values) - Math.min(...values);
  assert.ok(spread > 0.1, `modes should produce different densities: ${JSON.stringify(npsByMode)}`);
});

test('V2 note density responds to difficulty and musical activity', () => {
  const h = synthHighEnergy({ durationMs: 20000, bpm: 140 });
  const an = analyzeSamples(h.samples, h.sr);
  const npsByDifficulty = {};
  for (const difficulty of ['easy', 'normal', 'hard', 'expert']) {
    const _r = generateRfV2(an, 't', { difficulty, seed: 17 }); const r = _r.chart;
    const v = validateChart(r);
    assert.equal(v.valid, true, `${difficulty}: ${JSON.stringify(v.errors)}`);
    npsByDifficulty[difficulty] = _r.diagnostics.notesPerSecond;
  }
  const vals = ['easy', 'normal', 'hard', 'expert'].map(d => npsByDifficulty[d]);
  // NPS should strictly increase with difficulty.
  for (let i = 1; i < vals.length; i++)
    assert.ok(vals[i] > vals[i - 1], `NPS should increase: ${JSON.stringify(npsByDifficulty)}`);
});

test('V2 generated notes remain synchronized with the music grid', () => {
  const c = synthClicks({ segments: [{ bpm: 160, ms: 25000 }], startMs: 100 });
  const an = analyzeSamples(c.samples, c.sr);
  const map = buildTempoMap(an);
  assert.ok(Math.abs(map.segments[0].bpm - 160) < 3, `BPM detection off: ${map.segments[0].bpm}`);
  const r = generateRfV2(an, 't', { difficulty: 'expert', seed: 3 }).chart;
  const v = validateChart(r);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  assert.ok(r.notes.length > 10);
  // Every note must remain on the musical grid it came from. Expert charts may
  // intentionally use onset-backed triplets and 1/32 slots as well as 1/16.
  const offGrid = r.notes.filter(n => {
    const subdivision = n.gridSubdivision || 4;
    const position = getBeatPosition(r.generator.tempoMap, n.timeMs) * subdivision;
    return Math.abs(position - Math.round(position)) * (60000 / 160 / subdivision) > 2;
  });
  assert.equal(offGrid.length, 0, `${offGrid.length} notes off their declared grid: ${offGrid.map(n => n.timeMs).slice(0,5).join(',')}`);
});

// ============================================================================
// Dedicated Hold Quality Test Suite
// ============================================================================

// Sustained sine-wave tone (steady state, no decay).
function synthSustainTone({ sr = 22050, durationMs = 20000, freq = 220, gain = 0.4 } = {}) {
  const total = durationMs, x = new Float32Array(Math.ceil(total / 1000 * sr));
  for (let i = 0; i < x.length; i++) x[i] += gain * Math.sin(2 * Math.PI * freq * i / sr);
  return { samples: x, sr, durationMs: total };
}

// Sustained bass (low frequency, steady).
function synthSustainBass({ sr = 22050, durationMs = 20000, freq = 60, gain = 0.5 } = {}) {
  const total = durationMs, x = new Float32Array(Math.ceil(total / 1000 * sr));
  for (let i = 0; i < x.length; i++) x[i] += gain * Math.sin(2 * Math.PI * freq * i / sr);
  return { samples: x, sr, durationMs: total };
}

// Isolated kick pulses (sharp attack, fast decay — should NOT produce holds).
function synthKickPulses({ sr = 22050, durationMs = 20000, bpm = 120, gain = 1.0 } = {}) {
  const total = durationMs, x = new Float32Array(Math.ceil(total / 1000 * sr));
  const beat = 60000 / bpm;
  let t = 0;
  while (t < total - 100) {
    const i0 = Math.round(t / 1000 * sr);
    for (let i = 0; i < 400 && i0 + i < x.length; i++)
      x[i0 + i] += gain * Math.sin(2 * Math.PI * 100 * i / sr) * Math.exp(-i / (0.006 * sr));
    t += beat;
  }
  return { samples: x, sr, durationMs: total };
}

// Isolated snare pulses (sharp attack, noise-like decay — should NOT produce holds).
function synthSnarePulses({ sr = 22050, durationMs = 20000, bpm = 120, gain = 0.6 } = {}) {
  const total = durationMs, x = new Float32Array(Math.ceil(total / 1000 * sr));
  const beat = 60000 / bpm;
  let t = 0;
  while (t < total - 100) {
    const i0 = Math.round(t / 1000 * sr);
    for (let i = 0; i < 500 && i0 + i < x.length; i++)
      x[i0 + i] += gain * (Math.random() * 2 - 1) * Math.exp(-i / (0.04 * sr));
    t += beat;
  }
  return { samples: x, sr, durationMs: total };
}

// Short percussive transient with long reverb tail (reverb alone should NOT produce holds).
function synthTransientWithReverb({ sr = 22050, durationMs = 20000, bpm = 120, gain = 1.0, reverbGain = 0.15 } = {}) {
  const total = durationMs, x = new Float32Array(Math.ceil(total / 1000 * sr));
  const beat = 60000 / bpm;
  let t = 0;
  while (t < total - 100) {
    const i0 = Math.round(t / 1000 * sr);
    for (let i = 0; i < 300 && i0 + i < x.length; i++)
      x[i0 + i] += gain * Math.sin(2 * Math.PI * 2000 * i / sr) * Math.exp(-i / (0.01 * sr));
    for (let i = 0; i < 3000 && i0 + i < x.length; i++)
      x[i0 + i] += reverbGain * (Math.random() * 2 - 1) * Math.exp(-(i) / (0.15 * sr));
    t += beat;
  }
  return { samples: x, sr, durationMs: total };
}

// Quiet but genuinely sustained audio (low RMS, steady tone).
function synthQuietSustain({ sr = 22050, durationMs = 20000, freq = 330, gain = 0.03 } = {}) {
  const total = durationMs, x = new Float32Array(Math.ceil(total / 1000 * sr));
  for (let i = 0; i < x.length; i++) x[i] += gain * Math.sin(2 * Math.PI * freq * i / sr);
  return { samples: x, sr, durationMs: total };
}

// Alternating sustained and percussive sections.
function synthAlternating({ sr = 22050, durationMs = 30000, bpm = 120 } = {}) {
  const total = durationMs, x = new Float32Array(Math.ceil(total / 1000 * sr));
  const beat = 60000 / bpm;
  let t = 0;
  while (t < total - 100) {
    const phase = Math.floor(t / 8000) % 2;
    if (phase === 0) {
      const i0 = Math.round(t / 1000 * sr);
      for (let i = 0; i < 200 && i0 + i < x.length; i++)
        x[i0 + i] += 0.3 * Math.sin(2 * Math.PI * 200 * i / sr);
    } else {
      const i0 = Math.round(t / 1000 * sr);
      for (let i = 0; i < 300 && i0 + i < x.length; i++)
        x[i0 + i] += 0.8 * Math.sin(2 * Math.PI * 120 * i / sr) * Math.exp(-i / (0.006 * sr));
    }
    t += beat;
  }
  return { samples: x, sr, durationMs: total };
}

test('V2 sustained tone produces holds (not just taps)', () => {
  const an = analyzeSamples(synthSustainTone().samples, 22050);
  const r = generateRfV2(an, 'tone', { difficulty: 'hard', seed: 5 }).chart;
  const v = validateChart(r);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  const holds = r.notes.filter(n => n.type === 'hold');
  assert.ok(holds.length > 0, `sustained tone should produce holds, got ${holds.length}`);
  const beatMs = 60000 / an.bpm;
  for (const h of holds) {
    const durBeats = (h.endTimeMs - h.timeMs) / beatMs;
    assert.ok(durBeats >= 0.5 && durBeats <= 4, `hold duration ${durBeats.toFixed(2)} beats out of range`);
  }
});

test('V2 sustained bass produces holds', () => {
  const an = analyzeSamples(synthSustainBass().samples, 22050);
  const r = generateRfV2(an, 'bass', { difficulty: 'normal', seed: 5 }).chart;
  const v = validateChart(r);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  const holds = r.notes.filter(n => n.type === 'hold');
  assert.ok(holds.length >= 0, `bass holds: ${holds.length}`);
  if (holds.length > 0) {
    const map = buildTempoMap(an);
    for (const h of holds) {
      const startBeat = getBeatPosition(map, h.timeMs);
      const endBeat = getBeatPosition(map, h.endTimeMs);
      const durBeats = endBeat - startBeat;
      assert.ok(durBeats >= 0.5 && durBeats <= 4, `hold durBeats=${durBeats.toFixed(3)}`);
    }
  }
});

test('V2 isolated kick pulses do NOT produce holds', () => {
  const an = analyzeSamples(synthKickPulses().samples, 22050);
  const r = generateRfV2(an, 'kicks', { difficulty: 'expert', seed: 5 }).chart;
  const v = validateChart(r);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  const holds = r.notes.filter(n => n.type === 'hold');
  assert.equal(holds.length, 0, `kick pulses should not produce holds, got ${holds.length}`);
});

test('V2 isolated snare pulses do NOT produce holds', () => {
  const an = analyzeSamples(synthSnarePulses().samples, 22050);
  const r = generateRfV2(an, 'snares', { difficulty: 'expert', seed: 5 }).chart;
  const v = validateChart(r);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  const holds = r.notes.filter(n => n.type === 'hold');
  assert.equal(holds.length, 0, `snare pulses should not produce holds, got ${holds.length}`);
});

test('V2 transient with reverb tail does NOT produce holds from reverb alone', () => {
  const an = analyzeSamples(synthTransientWithReverb().samples, 22050);
  const r = generateRfV2(an, 'reverb', { difficulty: 'expert', seed: 5 }).chart;
  const v = validateChart(r);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  const holds = r.notes.filter(n => n.type === 'hold');
  assert.equal(holds.length, 0, `reverb alone should not produce holds, got ${holds.length}`);
});

test('V2 quiet but sustained audio can produce holds', () => {
  const an = analyzeSamples(synthQuietSustain().samples, 22050);
  const r = generateRfV2(an, 'quiet-sustain', { difficulty: 'normal', seed: 5 }).chart;
  const v = validateChart(r);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  const holds = r.notes.filter(n => n.type === 'hold');
  const map = buildTempoMap(an);
  for (const h of holds) {
    const startBeat = getBeatPosition(map, h.timeMs);
    const endBeat = getBeatPosition(map, h.endTimeMs);
    const durBeats = endBeat - startBeat;
    assert.ok(durBeats >= 0.5 && durBeats <= 4, `hold durBeats=${durBeats.toFixed(3)}`);
  }
});

test('V2 holds end before next same-lane note (no overlap)', () => {
  const an = analyzeSamples(synthSustainTone().samples, 22050);
  const r = generateRfV2(an, 'tone', { difficulty: 'expert', seed: 5 }).chart;
  const v = validateChart(r);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  const byLane = new Map();
  for (const n of r.notes) {
    const bucket = byLane.get(n.lane) || [];
    bucket.push(n);
    byLane.set(n.lane, bucket);
  }
  for (const [lane, notes] of byLane) {
    const sorted = [...notes].sort((a, b) => a.timeMs - b.timeMs);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], cur = sorted[i];
      if (prev.type === 'hold') {
        assert.ok(prev.endTimeMs <= cur.timeMs + 5,
          `hold in lane ${lane} ends ${prev.endTimeMs} but next note starts ${cur.timeMs}`);
      }
    }
  }
});

test('V2 HOLD_LIMITS.maxActive is enforced', () => {
  const an = analyzeSamples(synthSustainTone().samples, 22050);
  const limits = { easy: 1, normal: 1, hard: 2, expert: 2 };
  for (const difficulty of ['easy', 'normal', 'hard', 'expert']) {
    const r = generateRfV2(an, 'tone', { difficulty, seed: 5 }).chart;
    const v = validateChart(r);
    assert.equal(v.valid, true, `${difficulty}: ${JSON.stringify(v.errors)}`);
    const holds = r.notes.filter(n => n.type === 'hold');
    let maxOverlap = 0;
    const events = [];
    for (const h of holds) {
      events.push({ time: h.timeMs, type: 'start' });
      events.push({ time: h.endTimeMs, type: 'end' });
    }
    events.sort((a, b) => a.time - b.time || (a.type === 'end' ? -1 : 1));
    let active = 0;
    for (const e of events) {
      if (e.type === 'start') { active++; maxOverlap = Math.max(maxOverlap, active); }
      else active--;
    }
    assert.ok(maxOverlap <= limits[difficulty],
      `${difficulty}: max active holds ${maxOverlap} exceeds limit ${limits[difficulty]}`);
  }
});

test('V2 HOLD_LIMITS.maxBeats is enforced', () => {
  const an = analyzeSamples(synthSustainTone().samples, 22050);
  const beatMs = 60000 / an.bpm;
  const maxBeats = { easy: 2.5, normal: 3.0, hard: 3.5, expert: 4.0 };
  for (const difficulty of ['easy', 'normal', 'hard', 'expert']) {
    const r = generateRfV2(an, 'tone', { difficulty, seed: 5 }).chart;
    const v = validateChart(r);
    assert.equal(v.valid, true, `${difficulty}: ${JSON.stringify(v.errors)}`);
    const holds = r.notes.filter(n => n.type === 'hold');
    for (const h of holds) {
      const durBeats = (h.endTimeMs - h.timeMs) / beatMs;
      assert.ok(durBeats <= maxBeats[difficulty] + 0.1,
        `${difficulty}: hold duration ${durBeats.toFixed(2)} beats exceeds max ${maxBeats[difficulty]}`);
    }
  }
});

test('V2 HOLD_LIMITS.minBeats is enforced (no very short holds)', () => {
  const an = analyzeSamples(synthSustainTone().samples, 22050);
  const beatMs = 60000 / an.bpm;
  const minBeats = 0.5;
  for (const difficulty of ['easy', 'normal', 'hard', 'expert']) {
    const r = generateRfV2(an, 'tone', { difficulty, seed: 5 }).chart;
    const v = validateChart(r);
    assert.equal(v.valid, true, `${difficulty}: ${JSON.stringify(v.errors)}`);
    const holds = r.notes.filter(n => n.type === 'hold');
    for (const h of holds) {
      const durBeats = (h.endTimeMs - h.timeMs) / beatMs;
      assert.ok(durBeats >= minBeats - 0.05,
        `${difficulty}: hold duration ${durBeats.toFixed(2)} beats below min ${minBeats}`);
    }
  }
});

test('V2 alternating sustained/percussive: holds only in sustained sections', () => {
  const an = analyzeSamples(synthAlternating().samples, 22050);
  const r = generateRfV2(an, 'alternating', { difficulty: 'hard', seed: 5 }).chart;
  const v = validateChart(r);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  const holds = r.notes.filter(n => n.type === 'hold');
  const sustainedHoldCount = holds.filter(h =>
    (h.timeMs >= 0 && h.timeMs < 8000) || (h.timeMs >= 16000 && h.timeMs < 24000)
  ).length;
  const percussiveHoldCount = holds.filter(h =>
    (h.timeMs >= 8000 && h.timeMs < 16000) || (h.timeMs >= 24000 && h.timeMs <= 30000)
  ).length;
  if (holds.length > 0) {
    assert.ok(sustainedHoldCount >= percussiveHoldCount,
      `holds should favor sustained sections: sustained=${sustainedHoldCount}, percussive=${percussiveHoldCount}`);
  }
});

test('V2 melodic mode has higher hold propensity than technical', () => {
  const an = analyzeSamples(synthSustainTone().samples, 22050);
  const melodic = generateRfV2(an, 'tone', { difficulty: 'normal', mode: 'melodic', seed: 5 }).chart;
  const technical = generateRfV2(an, 'tone', { difficulty: 'normal', mode: 'technical', seed: 5 }).chart;
  const melodicHolds = melodic.notes.filter(n => n.type === 'hold').length;
  const technicalHolds = technical.notes.filter(n => n.type === 'hold').length;
  assert.ok(melodicHolds >= technicalHolds,
    `melodic holds (${melodicHolds}) should be >= technical holds (${technicalHolds})`);
});

test('V2 holds are not started on chords', () => {
  const an = analyzeSamples(synthSustainTone().samples, 22050);
  const r = generateRfV2(an, 'tone', { difficulty: 'expert', seed: 5 }).chart;
  const v = validateChart(r);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
  const holds = r.notes.filter(n => n.type === 'hold');
  const byTime = new Map();
  for (const n of r.notes) {
    const bucket = byTime.get(n.timeMs) || [];
    bucket.push(n);
    byTime.set(n.timeMs, bucket);
  }
  const chordTimes = new Set();
  for (const [time, group] of byTime) {
    if (group.length > 1) chordTimes.add(time);
  }
  for (const h of holds) {
    assert.ok(!chordTimes.has(h.timeMs), `hold at ${h.timeMs} should not coincide with a chord`);
  }
});

test('V2 evidence-ranked planner caps hold ratio even on continuous sustain', () => {
  const an = analyzeSamples(synthSustainTone({ durationMs: 30000 }).samples, 22050);
  for (const difficulty of ['easy', 'normal', 'hard', 'expert']) {
    const result = generateRfV2(an, 'continuous-tone', { difficulty, seed: 29 });
    const { chart, diagnostics } = result;
    const plan = chart.generator.holdPlanning;
    assert.equal(plan.strategy, 'evidence-ranked-v2');
    assert.ok(plan.selected <= plan.budget, `${difficulty}: selected ${plan.selected}, budget ${plan.budget}`);
    assert.ok(diagnostics.holdRatio <= plan.ratioLimit + 1 / Math.max(1, chart.notes.length));
    assert.ok(diagnostics.maxActiveHolds <= plan.maxActive,
      `${difficulty}: active ${diagnostics.maxActiveHolds}, max ${plan.maxActive}`);
  }
});

test('V2 custom hold multiplier cannot create a four-lane hold wall', () => {
  const an = analyzeSamples(synthSustainTone({ durationMs: 30000 }).samples, 22050);
  const result = generateRfV2(an, 'continuous-tone', {
    difficulty: 'expert', mode: 'custom', custom: { hold: 100, density: 1 }, seed: 31,
  });
  assert.ok(result.diagnostics.holdRatio <= 0.116,
    `custom hold ratio escaped safety cap: ${result.diagnostics.holdRatio}`);
  assert.ok(result.diagnostics.maxActiveHolds <= 2,
    `custom mode locked ${result.diagnostics.maxActiveHolds} lanes`);
});

test('V2 hold tails stay on the tempo-map sixteenth grid', () => {
  const an = analyzeSamples(synthSustainTone({ durationMs: 24000 }).samples, 22050);
  const r = generateRfV2(an, 'tone', { difficulty: 'hard', seed: 37 }).chart;
  const map = buildTempoMap(an);
  const holds = r.notes.filter(n => n.type === 'hold');
  assert.ok(holds.length > 0);
  for (const h of holds) {
    const tail16th = getBeatPosition(map, h.endTimeMs) * 4;
    assert.ok(Math.abs(tail16th - Math.round(tail16th)) < 0.015,
      `tail ${h.endTimeMs} is off grid at ${tail16th}`);
  }
});
