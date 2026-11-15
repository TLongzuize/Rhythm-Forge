// RF Generator V2 — music-aware beatmap generator (rewritten).
// Analyzes rhythm, structure, intensity and musical context, then places notes
// that follow the song instead of a fixed grid. Built on the project's tempo
// map, beat grid, pattern library and quality evaluator.
import { DIFFICULTIES, clamp, validateChart } from './core.js';
import { analyzeStructure, tempoInterpretations } from './smartgen.js';
import { buildTempoMap, getBeatPosition, getBeatTime, getTempoAt, rhythmicEvidence } from './tempomap.js';
import { buildBeatGrid, quantize, rhythmicLevel } from './beatgrid.js';
import { PATTERN_LIBRARY, patternById, rng, scorePattern, choosePattern, patternLanes } from './patterns.js';
import { computeDifficulty } from './difficulty.js';
import { extraMetrics } from './quality-extra.js';

export const V2_GEN_VERSION = '2.3.0';
export const ENGINE = 'rf-v2';
export const NAME = 'RF Generator V2';

// Per-mode behavior. `density` scales overall note count. `response` controls how
// strongly density follows section intensity (not a global dampener). `beat`
// biases placement onto strong metric positions. `hold` scales the evidence
// threshold and the bounded long-note budget.
export const V2_MODES = {
  balanced: { density: 1.00, response: 1.0, jack: 0,  beat: 0.55, hold: 1.00, label: 'Balanced' },
  beat:     { density: 0.70, response: 0.6, jack: -1, beat: 0.85, hold: 1.10, label: 'Beat Focus' },
  melodic:  { density: 1.00, response: 0.8, jack: 0,  beat: 0.30, hold: 1.30, label: 'Melodic' },
  technical:{ density: 1.40, response: 1.3, jack: 1,  beat: 0.30, hold: 0.85, label: 'Technical' },
  relax:    { density: 0.45, response: 0.3, jack: -1, beat: 0.75, hold: 1.25, label: 'Relax' },
};
const DIFF_IDX = { easy: 0, normal: 1, hard: 2, expert: 3 };
// Base notes-per-second targets per difficulty (music-scaled, not flat grid).
const BASE_NPS = { easy: 2.6, normal: 4.2, hard: 6.8, expert: 14.0 };
const V2_MAX_JACK = { easy: 1, normal: 2, hard: 3, expert: 4 };
const V2_MIN_JACK_GAP = { easy: 190, normal: 155, hard: 112, expert: 88 };
// Long notes are an accent, not a second chart layered over the taps.  These
// limits deliberately leave at least two lanes free and cap both start density
// and duration.  Mode multipliers may change the ratio, but never maxActive.
const HOLD_LIMITS = {
  easy:   { minBeats: 0.5, maxBeats: 2.0, maxActive: 1, maxRatio: 0.040, minStartGapBeats: 4.0 },
  normal: { minBeats: 0.5, maxBeats: 2.5, maxActive: 1, maxRatio: 0.055, minStartGapBeats: 3.0 },
  hard:   { minBeats: 0.5, maxBeats: 3.0, maxActive: 2, maxRatio: 0.065, minStartGapBeats: 2.5 },
  expert: { minBeats: 0.5, maxBeats: 3.0, maxActive: 2, maxRatio: 0.055, minStartGapBeats: 2.0 },
};
const ABSOLUTE_SILENCE_RMS = 0.004;   // near-zero signal = genuine silence
const QUIET_PASSAGE_RMS = 0.012;      // below this = quiet passage (sparse notes, not none)
const ONSET_STRONG = 0.30;
const ONSET_MODERATE = 0.16;

// V2-specific pattern additions for expert diversity (kept out of the shared
// library so V1 behavior is unchanged).
const V2_PATTERN_EXTRAS = [
  { id: 'flutter', name: 'flutter', category: 'advanced', minDifficulty: 2, maxDifficulty: 3, minSpacing: 65, maxDensity: 15, laneTransitions: 'moving', chordRatio: 0, jackIntensity: 0, rhythmicComplexity: 0.7, energyPreference: 0.8, compatibleModes: ['technical', 'balanced'], playabilityConstraints: { maxLaneJumpAtMinSpacing: 3, maxChordSize: 2 } },
  { id: 'rollFast', name: 'rollFast', category: 'advanced', minDifficulty: 2, maxDifficulty: 3, minSpacing: 70, maxDensity: 14, laneTransitions: 'moving', chordRatio: 0, jackIntensity: 0, rhythmicComplexity: 0.75, energyPreference: 0.85, compatibleModes: ['technical', 'melodic'], playabilityConstraints: { maxLaneJumpAtMinSpacing: 3, maxChordSize: 2 } },
];
const V2_PATTERN_LIBRARY = [...PATTERN_LIBRARY, ...V2_PATTERN_EXTRAS];
const v2PatternById = id => V2_PATTERN_LIBRARY.find(p => p.id === id);
const chooseV2Pattern = (ctx) => { let best = null, bs = -Infinity; for (const p of V2_PATTERN_LIBRARY) { const s = scorePattern(p, ctx); if (s > bs) { bs = s; best = p; } } return best || v2PatternById('single'); };

const resolveV2Mode = (mode, custom = {}) => ({ ...(V2_MODES[mode] || V2_MODES.balanced), ...(mode === 'custom' ? custom : {}) });
const v2HashStr = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

function overrideTempoMap(bpm, offset, dur) {
  const p = 60000 / bpm;
  return {
    version: 1, firstBeatMs: offset, durationMs: dur,
    segments: [{ startTime: 0, endTime: dur, bpm: +bpm.toFixed(2), beatPeriod: p, startBeat: -offset / p, beatPhase: 0, confidence: 1, source: 'override', manualOverride: false }],
  };
}

const medianValue = (values) => {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const percentileValue = (values, p) => {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.round(clamp(p, 0, 1) * (sorted.length - 1))] || 0;
};

// Estimate a single continuous musical gesture. A mastered song normally has a
// nearly constant RMS, so RMS alone cannot prove sustain. We also require envelope
// persistence and spectral stability, and treat a new onset/spectral change as a
// release boundary even when the mix stays loud.
function estimateSustainMs(
  t, beatMs, features, hopMs, t0, maxRms, onsetStrong, onsetModerate
) {
  const frameAt = (ms) => features[clamp(Math.round((ms - t0) / hopMs), 0, Math.max(0, features.length - 1))] || {};
  const valuesBetween = (from, to, key) => {
    const out = [];
    for (let ms = from; ms <= to; ms += Math.max(10, hopMs)) out.push(frameAt(t + ms)[key] || 0);
    return out;
  };
  const bandShape = (ms) => {
    const fr = frameAt(t + ms), sum = (fr.low || 0) + (fr.mid || 0) + (fr.high || 0);
    return sum > 1e-8 ? [(fr.low || 0) / sum, (fr.mid || 0) / sum, (fr.high || 0) / sum] : [0, 0, 0];
  };
  const shapeDistance = (a, b) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 2;

  const scanLimitMs = Math.min(beatMs * 3.25, 6500);
  const localRms = valuesBetween(-Math.min(beatMs, 600), scanLimitMs, 'rms');
  const localOnsets = valuesBetween(-Math.min(beatMs, 600), Math.min(scanLimitMs, beatMs * 2), 'onset');
  const localP90 = Math.max(1e-7, percentileValue(localRms, 0.9));
  const onsetThreshold = clamp(Math.max(onsetModerate * 0.8, percentileValue(localOnsets, 0.82) * 1.2), 0.12, onsetStrong);

  // Median windows are much less sensitive to the attack frame than a single sample.
  const refRms = medianValue(valuesBetween(45, 120, 'rms'));
  const earlyTailRms = medianValue(valuesBetween(150, 280, 'rms'));
  if (refRms < Math.max(ABSOLUTE_SILENCE_RMS * 1.25, localP90 * 0.1))
    return { durationMs: 0, confidence: 0, endMs: t, releaseConfidence: 0, onsetActivity: 1 };

  // Reject impulse-like attacks before scanning a reverb tail as if it were a note.
  const earlyPersistence = earlyTailRms / Math.max(refRms, 1e-7);
  if (earlyPersistence < 0.48)
    return { durationMs: 0, confidence: 0, endMs: t, releaseConfidence: 0, onsetActivity: 1 };

  const refShape = bandShape(90);
  let sustainedMs = 0, boundaryMs = 0, releaseConfidence = 0, stableFrames = 0, spectralSum = 0, onsetFrames = 0, scannedFrames = 0;
  for (let dt = 90; dt <= scanLimitMs; dt += 30) {
    const rms = medianValue(valuesBetween(dt - 25, dt + 25, 'rms'));
    const onset = Math.max(...valuesBetween(dt - 20, dt + 20, 'onset'));
    const spectralDrift = shapeDistance(refShape, bandShape(dt));
    scannedFrames++;
    if (onset >= onsetModerate * 0.65) onsetFrames++;

    const envelopeStable = rms >= refRms * 0.56;
    const spectrumStable = spectralDrift <= 0.42;
    if (envelopeStable) stableFrames++;
    spectralSum += clamp(1 - spectralDrift / 0.5);

    if (dt >= Math.max(180, beatMs * 0.35)) {
      const newAttack = onset >= onsetThreshold;
      const envelopeRelease = rms < refRms * 0.5;
      const timbreRelease = spectralDrift > 0.48 && onset >= onsetModerate * 0.45;
      if (newAttack || envelopeRelease || timbreRelease) {
        boundaryMs = dt;
        releaseConfidence = newAttack ? clamp(onset / Math.max(onsetThreshold, 1e-6)) : envelopeRelease ? clamp(1 - rms / Math.max(refRms * 0.5, 1e-6)) : clamp(spectralDrift / 0.6);
        break;
      }
    }
    if (!envelopeStable && dt > 180) break;
    sustainedMs = dt;
  }

  // A detected release/new attack is the musically meaningful tail. Without a
  // boundary, use the last proven-stable frame and remain conservative.
  const musicalDurationMs = boundaryMs || sustainedMs;
  const sustainBeats = musicalDurationMs / beatMs;
  if (sustainBeats < 0.35) return { durationMs: 0, confidence: 0, endMs: t, releaseConfidence, onsetActivity: 1 };

  const envelopeStability = clamp(stableFrames / Math.max(1, scannedFrames));
  const spectralStability = clamp(spectralSum / Math.max(1, scannedFrames));
  const onsetActivity = clamp(onsetFrames / Math.max(1, scannedFrames));
  const durationEvidence = clamp(sustainBeats / 1.5);
  const toneEvidence = clamp(((refShape[0] + refShape[1]) - refShape[2] * 0.35 + 0.15) / 0.85);
  const confidence = clamp(
    durationEvidence * 0.35 + envelopeStability * 0.25 + spectralStability * 0.20 +
    releaseConfidence * 0.12 + toneEvidence * 0.08 - onsetActivity * 0.18
  );

  return { durationMs: musicalDurationMs, confidence, endMs: t + musicalDurationMs, releaseConfidence, onsetActivity, envelopeStability, spectralStability };
}

// Shift the phase of an existing tempo map by offsetMs while preserving all
// tempo changes and segment boundaries. Used for offset-only overrides.
function shiftTempoMap(map, offsetMs) {
  const c = JSON.parse(JSON.stringify(map));
  const first = c.segments[0];
  const p = first.beatPeriod;
  first.startBeat = first.startBeat - offsetMs / p;
  for (let i = 1; i < c.segments.length; i++) {
    const prev = c.segments[i - 1];
    c.segments[i].startBeat = prev.startBeat + (c.segments[i].startTime - prev.startTime) / prev.beatPeriod;
  }
  c.firstBeatMs = offsetMs;
  return c;
}
const dominantBpm = (map) => { const d = map.segments.reduce((b, x) => (!b || x.endTime - x.startTime > b.endTime - b.startTime ? x : b), null); return d ? +d.bpm.toFixed(2) : 120; };

// Local beat duration (ms) at time t, using the tempo map segment at t.
function localBeatMs(map, t) {
  const seg = getTempoAt(map, t);
  return seg ? seg.beatPeriod : 60000 / dominantBpm(map);
}

  // ---------- Improved musical section analysis ----------
  // Classifies sections using onset activity, RMS energy and spectral shape so that
  // quiet-but-musical passages are kept, genuine silence is dropped, and intensity
  // changes (build-up / drop / breakdown) are recognised.
  function analyzeMusicSections(analysis, map) {
    const f = analysis.features || [], dur = analysis.durationMs || 0;
    const hop = f.length > 1 ? (f[1].timeMs - f[0].timeMs) || 10 : 10;
    const t0 = f[0]?.timeMs || 0;
    if (!f.length || dur < 1500) return [];

    const maxRms = Math.max(1e-6, ...f.map(x => x.rms || 0));
    const maxOnset = Math.max(1e-6, ...f.map(x => x.onset || 0));
    const maxHigh = Math.max(1e-6, ...f.map(x => x.high || 0));
    const norm = (v, mx) => clamp((v || 0) / mx, 0, 1);

    const winMs = 2500, per = Math.max(1, Math.round(winMs / hop));
    const wins = [];
    for (let i = 0; i < f.length; i += per) {
      const s = f.slice(i, i + per);
      let rms = 0, onset = 0, strong = 0, high = 0, low = 0;
      for (const x of s) { rms += x.rms || 0; onset += x.onset || 0; if (x.onset > ONSET_STRONG) strong++; high += x.high || 0; low += x.low || 0; }
      const n = Math.max(1, s.length);
      const winSec = winMs / 1000;
      wins.push({
        startMs: s[0].timeMs, endMs: Math.min(dur, s[0].timeMs + winMs),
        rms: norm(rms / n, maxRms), onset: norm(onset / n, maxOnset),
        strongRate: clamp(strong / winSec / 4, 0, 1),
        brightness: norm(high / n, maxHigh), lowBass: norm(low / n, maxRms),
      });
    }
    for (let i = 0; i < wins.length; i++) {
      const p = wins[Math.max(0, i - 1)], n = wins[Math.min(wins.length - 1, i + 1)], c = wins[i];
      c.rmsSmooth = p.rms * 0.25 + c.rms * 0.5 + n.rms * 0.25;
      c.onsetSmooth = p.onset * 0.25 + c.onset * 0.5 + n.onset * 0.25;
      c.strongSmooth = p.strongRate * 0.25 + c.strongRate * 0.5 + n.strongRate * 0.25;
    }

    const intensity = (w) => clamp(w.strongSmooth * 0.6 + w.onsetSmooth * 0.25 + w.rmsSmooth * 0.15, 0, 1);
    wins.forEach(w => { w.intensity = intensity(w); });

  // Build raw sections from smoothed windows.
  const raw = [];
  let cur = null;
  for (const w of wins) {
    const absSilent = w.rmsSmooth < 0.02 && w.strongSmooth < 0.05;
    const level = absSilent ? -1 :
                  w.rmsSmooth < 0.06 && w.strongSmooth < 0.15 ? 0 :
                  w.intensity < 0.30 ? 1 :
                  w.intensity < 0.60 ? 2 : 3;
    if (!cur || cur.level !== level) { if (cur) raw.push(cur); cur = { ...w, level, n: 1, startMs: w.startMs, endMs: w.endMs }; }
    else { cur.endMs = w.endMs; cur.n++; cur.rms += w.rms; cur.onset += w.onset; cur.intensity += w.intensity; cur.strongRate += w.strongRate; cur.brightness += w.brightness; cur.lowBass += w.lowBass; }
  }
  if (cur) raw.push(cur);

  function finalize(s, idx) {
    const n = Math.max(1, s.n);
    const energy = s.intensity / n;
    const activity = s.strongRate / n;
    const prev = raw[idx - 1];
    const rising = prev && energy > 0.5 && prev.energy < 0.35 && (s.endMs - s.startMs) <= 15000;
    const drop = prev && energy > 0.6 && prev.energy < 0.3 && (s.endMs - s.startMs) <= 12000;
    const breakdown = energy < 0.4 && activity > 0.15;
    const label = drop ? 'Drop' : rising ? 'Build-up' : breakdown ? 'Breakdown' : s.level === -1 ? 'Silence' : s.level === 0 ? 'Quiet' : energy < 0.30 ? 'Low Energy' : energy < 0.60 ? 'Medium Energy' : 'High Energy';
    return { id: `sec-${idx}`, startMs: Math.round(s.startMs), endMs: Math.round(s.endMs), energy, activity, brightness: s.brightness / n, bass: s.lowBass / n, label, level: s.level };
  }
  return raw.map(finalize);
}

// Map a section label to an intensity multiplier for density.
const sectionIntensityMult = (label) => {
  switch (label) {
    case 'Drop': return 1.35;
    case 'High Energy': return 1.25;
    case 'Build-up': return 1.15;
    case 'Medium Energy': return 1.0;
    case 'Breakdown': return 0.75;
    case 'Low Energy': return 0.6;
    case 'Quiet': return 0.4;
    case 'Silence': return 0;
    default: return 1.0;
  }
};

function chartSchema(analysis, title, difficulty, seed, bpm, offset, notes, syncMap, extra = {}) {
  const dur = Math.round(analysis.durationMs || 0);
  const map = syncMap || buildTempoMap(analysis);
  const rating = computeDifficulty(notes, dur, map).rating;
  return {
    schemaVersion: 1,
    chartId: `rf2-${(seed >>> 0).toString(16)}-${difficulty}-${dur}`,
    metadata: {
      title: title || 'Untitled track',
      audioDurationMs: dur,
      bpm,
      offsetMs: Math.round(offset),
      difficulty,
      difficultyRating: Math.round(rating * 10) / 10,
    },
    generator: {
      name: NAME,
      engine: ENGINE,
      version: V2_GEN_VERSION,
      seed,
      mode: extra.mode,
      custom: extra.mode === 'custom' ? extra.custom : undefined,
      sections: extra.sections || [],
      patterns: extra.patterns || [],
      bpm,
      offset: Math.round(offset),
      tempoInterpretations: extra.tempoInterpretations || [],
      rhythmicEvidence: extra.rhythmicEvidence || { strongPerMin: 0, hasRhythm: false },
      tempoMap: map,
      ...extra,
    },
    notes,
  };
}

function diagnostics(chart, analysis, started) {
  const dur = Math.max(1, analysis.durationMs || 1);
  const holds = chart.notes.filter(n => n.type === 'hold');
  const events = holds.flatMap(n => [{ time: n.timeMs, delta: 1 }, { time: n.endTimeMs, delta: -1 }])
    .sort((a, b) => a.time - b.time || a.delta - b.delta);
  let active = 0, maxActiveHolds = 0;
  for (const event of events) { active += event.delta; maxActiveHolds = Math.max(maxActiveHolds, active); }
  return {
    bpm: chart.metadata.bpm,
    bpmConfidence: analysis.bpmConfidence,
    gridConfidence: analysis.gridConfidence,
    candidateCount: (analysis.tempoCandidates || []).length,
    selectedCount: chart.notes.length,
    noteCount: chart.notes.length,
    holdCount: holds.length,
    holdRatio: +(holds.length / Math.max(1, chart.notes.length)).toFixed(4),
    maxActiveHolds,
    notesPerSecond: +(chart.notes.length / (dur / 1000)).toFixed(2),
    generationMs: Math.max(0, performance.now() - started),
  };
}

export function generateRfV2(analysis, title, opts = {}) {
  const started = performance.now();
  const { difficulty = 'normal', mode = 'balanced', custom, seed = 1337, bpmOverride, offsetOverrideMs, densityScale = 1, minConfidence = 0.1 } = opts;
  const m = resolveV2Mode(mode, custom);
  const holdScale = Number.isFinite(Number(m.hold)) ? clamp(Number(m.hold), 0.35, 1.6) : 1;
  const dur = Math.max(1, analysis.durationMs || 0);
  const f = analysis.features || [];
  const hop = f.length > 1 ? (f[1].timeMs - f[0].timeMs) || 10 : 10;
  const t0 = f[0]?.timeMs || 0;
  const rand = rng(seed);

  const map = buildTempoMap(analysis);
  const ev = rhythmicEvidence(analysis);

  const bpm = (bpmOverride >= 30 && bpmOverride <= 300) ? bpmOverride : dominantBpm(map);
  let offset = offsetOverrideMs !== undefined ? offsetOverrideMs : (analysis.beatOffsetMs ?? 0);
  const beatMs = 60000 / bpm;
  const analysisBeatMs = 60000 / (analysis.bpm || dominantBpm(map));
  let syncMap;
  if (bpmOverride >= 30 && bpmOverride <= 300) {
    syncMap = overrideTempoMap(bpm, offset, dur);
  } else if (offsetOverrideMs !== undefined) {
    syncMap = shiftTempoMap(map, offset);
  } else {
    syncMap = map;
  }

  // minConfidence: reject/flag maps whose dominant segment confidence is below the threshold.
  // Used as a safety gate: if the detected tempo map is unreliable, generation proceeds but
  // the chart is marked low-confidence and the caller can warn the user.
  const mapConfidence = syncMap.segments.reduce((s, x) => s + (x.confidence ?? 0), 0) / Math.max(1, syncMap.segments.length);
  const lowConfidence = mapConfidence < minConfidence;

  const onsetNear = (t, r = 35) => { let mx = 0; const i = Math.round((t - t0) / hop), k = Math.max(1, Math.round(r / hop)); for (let j = i - k; j <= i + k; j++) { const v = f[j]?.onset || 0; if (v > mx) mx = v; } return mx; };

  // Silence / no rhythm: emit an empty but valid chart instead of fabricating notes.
  // A track is silent when it has no strong onsets AND near-zero RMS throughout.
  const maxRms = Math.max(1e-6, ...f.map(x => x.rms || 0));
  const isSilent = !ev.hasRhythm && maxRms < ABSOLUTE_SILENCE_RMS * 3;
  if (isSilent) {
    const chart = chartSchema(analysis, title, difficulty, seed, bpm, offset, [], syncMap, { mode, sections: [], patterns: [], tempoInterpretations: [], rhythmicEvidence: ev, lowConfidence });
    chart.quality = { overall: 0, metrics: {}, issues: [], noteCount: 0, meanNps: 0, generatorVersion: V2_GEN_VERSION };
    chart.quality.difficultyModel = computeDifficulty([], dur, syncMap);
    return { chart, diagnostics: diagnostics(chart, analysis, started) };
  }

  // Musical sections with improved intensity classification.
  const secs = analyzeMusicSections(analysis, syncMap);
  for (const s of secs) {
    s.startBeat = getBeatPosition(syncMap, s.startMs);
    s.endBeat = getBeatPosition(syncMap, s.endMs);
  }

  const frame = (t) => f[clamp(Math.round((t - t0) / hop), 0, Math.max(0, f.length - 1))] || {};
  const localRms = (t) => (frame(t).rms || 0) / maxRms;            // 0..1 relative to own max (quiet passage != silence)
  const absRms = (t) => frame(t).rms || 0;                        // absolute RMS for silence gating
  const secAt = (t) => secs.find(s => t >= s.startMs && t < s.endMs) || secs[secs.length - 1] || { energy: 0.5, label: 'Medium Energy', level: 2 };

  const DC = { nps: BASE_NPS[difficulty], gap: { easy: 260, normal: 150, hard: 100, expert: 80 }[difficulty], chord: { easy: 0, normal: 0.18, hard: 0.42, expert: 0.65 }[difficulty], maxJack: V2_MAX_JACK[difficulty] };
  // DEBUG
  if (false) { console.log('DEBUG DC', difficulty, JSON.stringify(BASE_NPS[difficulty]), JSON.stringify(DC)); }
  const maxJack = clamp(DC.maxJack + (m.jack || 0), 1, 6);

  // 1/16 grid locked to the (possibly tempo-changing) tempo map -> accurate sync.
  const grid = buildBeatGrid(syncMap, 110, dur - 200, { subdivision: 4 });
  // Extended subdivisions for higher difficulties (triplets Hard+, 1/32 Expert),
  // gated on real onset evidence so syncopated notes only appear where the music supports them.
  const extraSlots = [];
  const diffIdx = DIFF_IDX[difficulty];
  if (diffIdx >= 2) {
    for (const [sub, thr] of [[3, 0.7], ...(diffIdx >= 3 ? [[8, 0.8]] : [])]) {
      for (const s of buildBeatGrid(syncMap, 110, dur - 200, { subdivision: sub })) {
        if (sub === 3 ? s.subdivisionIndex === 0 : s.subdivisionIndex % 2 === 0) continue;
        if (grid.some(x => Math.abs(x.time - s.time) < 30) || extraSlots.some(x => Math.abs(x.time - s.time) < 30)) continue;
        if (onsetNear(s.time) < thr) continue;
        extraSlots.push({ ...s, accent: sub === 3 ? 0.3 : 0.27, ext: sub === 3 ? 'triplet' : 'thirtysecond' });
      }
    }
  }
  const allSlots = [...grid, ...extraSlots].sort((a, b) => a.time - b.time);

  // Score every grid slot: onset is the dominant driver; metric/subdivision only
  // break ties between slots with real onset evidence. Slots without meaningful
  // onset are never promoted by beat position alone.
  const slots = allSlots.map((s) => {
    const sec = secAt(s.time);
    const energy = sec.energy ?? 0.5;
    const q = localRms(s.time);
    const onset = onsetNear(s.time);
    const isQuietPassage = q < QUIET_PASSAGE_RMS / maxRms && onset < ONSET_MODERATE;
    const quietFactor = isQuietPassage ? 0.5 : 1;
    const bp = getBeatPosition(syncMap, s.time);
    const metric = (bp % 1 === 0) ? 1 : ((bp * 2) % 1 === 0) ? 0.72 : ((bp * 4) % 1 === 0) ? 0.5 : 0.26;
    // Subdivision bias only matters when there is real onset evidence; it never
    // creates a note on an empty grid position.
    const level = rhythmicLevel(syncMap, s.time, 14);
    const subdivisionBias = onset > 0.05 ? (level >= 1 ? (level === 1 ? 1 : level === 2 ? 0.85 : 0.6) : 0.2) : 0;
    // `m.beat` controls how strongly notes are biased toward strong metric positions.
    // Beat Focus (0.85) heavily favors downbeats; Melodic/Technical (0.30) allow more
    // offbeat/syncopated placement; Balanced (0.55) is moderate.
    const score = clamp(onset * 0.62 + metric * (m.beat * 0.12) + energy * 0.12 + q * 0.08 + subdivisionBias * 0.04, 0, 1) * quietFactor;
    return { ...s, score, energy, metric, onset, quietFactor, level, sec, q };
  }).filter(s => {
    const minScore = { easy: 0.08, normal: 0.06, hard: 0.04, expert: 0.03 }[difficulty];
    const hasOnset = s.onset > 0.03;
    // Sustained audio (high RMS, steady tone) can carry notes on strong metric positions
    // even without onsets — this lets holds attach to sustained musical content.
    const sustainedMetric = !hasOnset && s.metric >= 0.8 && s.q > 0.25;
    return s.score > minScore && (hasOnset || sustainedMetric);
  });

  // Group slots by section; assign an adaptive quota per section based on musical activity.
  const bySec = new Map();
  for (const s of slots) { const sec = secAt(s.time); const bucket = bySec.get(sec.id) || []; bucket.push(s); bySec.set(sec.id, bucket); }

  const chosen = [];
  for (const [secId, ss] of bySec) {
    const sec = secs.find(x => x.id === secId) || ss[0].sec;
    const intensityMult = sectionIntensityMult(sec.label);
    if (intensityMult === 0) continue; // genuine silence: no notes
    const quiet = sec.energy < 0.08 ? 0.35 : 1;
    const sectionSeconds = Math.max(0.1, (sec.endMs - sec.startMs) / 1000);
    // Base NPS scaled by difficulty, mode density, section intensity and quietness.
    // `m.response` shapes how strongly density follows section intensity: high-response
    // modes amplify energetic sections, low-response modes keep density flatter.
    const effectiveIntensityMult = 1 + (intensityMult - 1) * m.response;
    const targetNps = DC.nps * m.density * densityScale * effectiveIntensityMult * quiet;
    const quota = Math.max(1, Math.round(targetNps * sectionSeconds));
    const ordered = ss.slice().sort((a, b) => b.score - a.score || a.time - b.time);
    const picked = [];
    for (const s of ordered) {
      if (picked.length >= quota) break;
      if (picked.some(p => Math.abs(p.time - s.time) < DC.gap * (quiet === 0.35 ? 1.5 : 1))) continue;
      picked.push(s);
    }
    picked.sort((a, b) => a.time - b.time);
    chosen.push(...picked);
  }
  chosen.sort((a, b) => a.time - b.time || a.beatIndex - b.beatIndex);

  // Lane assignment with osu!mania patterns chosen per section by energy.
  const notes = [];
  let id = 0;
  const makeId = () => `rf2-${(seed >>> 0).toString(16)}-${(id++).toString(36).padStart(4, '0')}`;
  const hist = [];
  const patterns = [];   // recorded pattern usage for metadata + quality eval
  let curPat = null, curLanes = [], curPos = 0, curPatEndTime = -1, curPatFrom = 0;
  let prevNoteTime = -1e9, prevNoteLane = -1, sameLaneRun = 0;

  const pickPattern = (energy, minGap) => {
    const ctx = { energy, minGap, difficulty: DIFF_IDX[difficulty], mode, history: hist, variety: 1, randomness: 0.2, rand, jackOk: maxJack >= 2 };
    return chooseV2Pattern(ctx) || v2PatternById('single');
  };

// Per-lane future-note index for same-lane lookups (built after all taps exist).
let laneFuture = [[], [], [], []];

// Measure one possible hold without committing it. Candidates are ranked globally
// later so a merely acceptable sustain cannot crowd out a clearly musical phrase.
function buildHoldCandidate(note, notes) {
  const t = note.timeMs, lane = note.lane;
  const holdLim = HOLD_LIMITS[difficulty];

  // Chord exclusion: a hold cannot start at a timestamp where multiple notes exist.
  const chordAtT = notes.filter(n => n.timeMs === t && n.timeMs !== undefined).length > 1;
  if (chordAtT) return null;

  // Subdivision exclusion: holds only on base 1/16 grid positions.
  const slot = allSlots.find(s => Math.abs(s.time - t) <= 10);
  if (!slot || slot.subdivision !== 4) return null;

  // Silence exclusion.
  if (absRms(t) < ABSOLUTE_SILENCE_RMS && sFor(t).onset < ONSET_MODERATE) return null;

  // Same-lane next note: find the next note in this lane after t.
  const laneSeq = laneFuture[lane];
  let nextSameLaneMs = Infinity;
  for (const ln of laneSeq) {
    if (ln > t + 35) { nextSameLaneMs = ln; break; }
  }

  // All beat calculations in tempo-map space (correct across tempo boundaries).
  const startBeat = getBeatPosition(syncMap, t);
  const durBeat = getBeatPosition(syncMap, dur);
  const nextBeat = Number.isFinite(nextSameLaneMs) ? getBeatPosition(syncMap, nextSameLaneMs) : durBeat;

  // Release gap: 0.25 beat before next same-lane note.
  const releaseGapBeats = 0.25;
  const availableBeats = nextBeat - startBeat - releaseGapBeats;
  if (availableBeats < holdLim.minBeats) return null;

  // Sustain evidence: measure actual sustain duration in beat space.
  const sustain = estimateSustainMs(t, localBeatMs(syncMap, t), f, hop, t0, maxRms, ONSET_STRONG, ONSET_MODERATE);
  const sustainEndBeat = Number.isFinite(sustain.endMs) ? getBeatPosition(syncMap, sustain.endMs) : startBeat;
  const sustainBeats = sustainEndBeat - startBeat;
  if (sustainBeats < holdLim.minBeats * 0.95) return null;
  if (sustain.confidence < 0.40) return null;

  // Duration: sustain ONLY, capped by lane space and difficulty max.
  // Lane space and minBeats are bounds, NEVER lower bounds on duration.
  const targetBeats = Math.min(sustainBeats, availableBeats, holdLim.maxBeats);
  let snappedBeats = Math.round(targetBeats * 4) / 4;
  // The closest musical grid point may not cross the next same-lane head or the
  // difficulty duration ceiling.
  if (snappedBeats > availableBeats + 1e-6 || snappedBeats > holdLim.maxBeats + 1e-6)
    snappedBeats = Math.floor(targetBeats * 4) / 4;
  if (snappedBeats < holdLim.minBeats) return null;

  // Calculate hold end purely in beat space — never clip in ms after snapping.
  const endBeat = startBeat + snappedBeats;
  // Math.ceil rounds UP so the hold is never shorter than snappedBeats
  // due to integer-ms truncation of getBeatTime.
  const endTimeMs = Math.ceil(getBeatTime(syncMap, endBeat));

  // Final guard: ensure hold doesn't exceed track end.
  if (endTimeMs > dur) return null;

  // Verify actual beat duration after ms rounding.
  const actualDurBeats = getBeatPosition(syncMap, endTimeMs) - startBeat;
  if (actualDurBeats < holdLim.minBeats) return null;

  const head = sFor(t);
  const durationQuality = clamp(Math.min(actualDurBeats, 2) / 2);
  const headEvidence = clamp((head.onset || 0) * 0.75 + (head.metric || 0) * 0.25);
  const score = clamp(
    sustain.confidence * 0.54 + (sustain.releaseConfidence || 0) * 0.16 +
    durationQuality * 0.16 + headEvidence * 0.10 + (rand() - 0.5) * 0.025 -
    (sustain.onsetActivity || 0) * 0.12
  );
  // Melodic mode is more permissive; technical mode still needs stronger evidence.
  const evidenceFloor = clamp(0.50 - (holdScale - 1) * 0.06, 0.46, 0.54);
  if (score < evidenceFloor) return null;

  return { note, lane, start: t, end: endTimeMs, startBeat, endBeat, score, sustain };
}

// Helper: get the slot object for a given time (for subdivision lookup).
function sFor(t) {
  const slot = allSlots.find(s => Math.abs(s.time - t) <= 10);
  return slot ? { onset: slot.onset || 0, metric: slot.metric || slot.accent || 0 } : { onset: 0, metric: 0 };
}

// ============================================================================
// Pass 1 — Note head generation + lane assignment (all taps, no hold decisions).
// ============================================================================
for (const s of chosen) {
  // Preserve the subdivision that produced the candidate. Re-quantising every
  // event to 1/4 erased valid triplet and 1/8/1/16 rhythmic detail.
  const t = Math.round(quantize(syncMap, s.time, { subdivision: s.subdivision || 4, tolerance: 0.3 }).time);
  const sec = secAt(t);
  const energy = sec.energy ?? 0.5;
  const quiet = localRms(t);
  const onSilence = absRms(t) < ABSOLUTE_SILENCE_RMS && s.onset < ONSET_MODERATE;
  if (onSilence || (quiet < (QUIET_PASSAGE_RMS / maxRms) * 0.15 && s.onset < ONSET_MODERATE)) continue; // genuinely silent: no note

  const isStrong = s.onset > ONSET_MODERATE && s.score > 0.45;

  if (!curPat || t > curPatEndTime) {
    const pat = pickPattern(energy, DC.gap);
    const runLen = Math.min(10, Math.max(2, Math.round(beatMs * 2 / Math.max(DC.gap, 60))));
    curLanes = patternLanes(pat, runLen, prevNoteLane, rng(v2HashStr(`${pat.id}-${t}-${sec.id}`) ^ seed), { mirror: rand() < 0.35, chordEvery: 1e9 });
    curPat = pat; curPos = 0;
    curPatFrom = t;
    curPatEndTime = t + runLen * Math.max(DC.gap, 70);
    hist.push(pat.id); if (hist.length > 4) hist.shift();
    patterns.push({ id: pat.id, fromMs: curPatFrom, toMs: curPatEndTime, section: sec.id, energy });
  }

  const lanes = curLanes[curPos % curLanes.length];
  curPos++;
  let lane = lanes[0];
  const free = [0, 1, 2, 3];
  if (lanes.length === 1 && lane === prevNoteLane && t - prevNoteTime < V2_MIN_JACK_GAP[difficulty] && maxJack < 2) {
    const alts = free.filter(l => l !== lane);
    if (alts.length) lane = alts[Math.floor(rand() * alts.length)];
  }
  if (!free.includes(lane)) {
    if (!free.length) continue;
    lane = free[0];
  }
  if (lane === prevNoteLane) sameLaneRun++; else sameLaneRun = 1;
  if (sameLaneRun > maxJack && t - prevNoteTime < 500) {
    const alts = free.filter(l => l !== lane);
    if (alts.length) { lane = alts[Math.floor(rand() * alts.length)]; sameLaneRun = 1; }
  }

  // Occasional jump chord on strong accents (metric downbeat + real onset).
  if (isStrong && free.length >= 2 && rand() < DC.chord * 1.5) {
    const jump = free.filter(l => l !== lane && Math.abs(l - lane) >= 2);
    if (jump.length) notes.push({ id: makeId(), timeMs: t, lane: jump[0], type: 'tap' });
  }

  // Primary note: added as tap first; hold decision made in Pass 2.
  notes.push({ id: makeId(), timeMs: t, lane, type: 'tap', subdivisionIndex: s.subdivisionIndex, gridSubdivision: s.subdivision || 4 });
  prevNoteTime = t; prevNoteLane = lane;
}

// ============================================================================
// Pass 2 — evidence-ranked hold planning.
// Build all candidates first, then enforce a global ratio, phrase spacing and an
// overlap ceiling. This prevents a loud/compressed mix from turning every eligible
// head into a long note and guarantees that at least two lanes remain free.
// ============================================================================
laneFuture = [0, 1, 2, 3].map(l => notes.filter(n => n.lane === l).sort((a, b) => a.timeMs - b.timeMs).map(n => n.timeMs));
const holdLim = HOLD_LIMITS[difficulty];
const holdCandidates = notes.filter(n => n.type === 'tap').map(n => buildHoldCandidate(n, notes)).filter(Boolean);
const ratioLimit = clamp(holdLim.maxRatio * holdScale, 0.015, 0.115);
const holdBudget = Math.floor(notes.length * ratioLimit);
const selectedHolds = [];

holdCandidates.sort((a, b) => b.score - a.score || a.start - b.start || a.lane - b.lane);
for (const candidate of holdCandidates) {
  if (selectedHolds.length >= holdBudget) break;
  // One expressive LN per phrase area; avoid repetitive LN streams.
  if (selectedHolds.some(h => Math.abs(h.startBeat - candidate.startBeat) < holdLim.minStartGapBeats)) continue;
  // Count interval overlap, with release-at-head treated as non-overlap.
  const active = selectedHolds.filter(h => h.start < candidate.end && h.end > candidate.start).length;
  if (active >= holdLim.maxActive) continue;
  // Never stack two holds in the same lane, even if a malformed future-note list
  // would otherwise leave room.
  if (selectedHolds.some(h => h.lane === candidate.lane && h.start < candidate.end && h.end > candidate.start)) continue;
  selectedHolds.push(candidate);
}

for (const h of selectedHolds) {
  h.note.type = 'hold';
  h.note.endTimeMs = h.end;
}

// Clean up residual flags.
for (const n of notes) {
  delete n.subdivisionIndex;
}

// Deduplicate: remove any duplicate notes at same lane+time.
// Hold planning already guarantees beat-synced endpoints; no further truncation applied.
const unique = [];
const seen = new Set();
for (const n of notes) {
  if (!Number.isFinite(n.timeMs) || n.timeMs < 0 || n.timeMs > dur + 50 || !(n.lane >= 0 && n.lane <= 3)) continue;
  const key = n.lane + ':' + n.timeMs;
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(n);
}

  const holdPlanning = {
    strategy: 'evidence-ranked-v2',
    candidateCount: holdCandidates.length,
    budget: holdBudget,
    selected: selectedHolds.length,
    ratioLimit: +ratioLimit.toFixed(4),
    maxActive: holdLim.maxActive,
  };
  const chart = chartSchema(analysis, title, difficulty, seed, bpm, offset, unique, syncMap, { mode, sections: secs, patterns, holdPlanning, tempoInterpretations: tempoInterpretations(analysis), rhythmicEvidence: ev, lowConfidence });
  chart.quality = evaluateV2Chart(chart, analysis, syncMap);
  chart.quality.difficultyModel = computeDifficulty(unique, dur, syncMap);
  chart.quality.lowConfidence = lowConfidence;
  return { chart, diagnostics: { ...diagnostics(chart, analysis, started), noteCount: unique.length, lowConfidence } };
}

export function evaluateV2Chart(chart, analysis, map) {
  const fmt = (t) => `${String(Math.floor(t / 60000)).padStart(2, '0')}:${String(Math.floor(t / 1000) % 60).padStart(2, '0')}`;
  const { metrics, issues } = extraMetrics(chart, analysis, map, fmt);
  const notes = chart.notes || [], dur = analysis.durationMs || 1;
  let overall = 0, wsum = 0;
  const w = { beatAlignment: 0.12, tempoMapAlignment: 0.12, onsetCoverage: 0.12, densityConsistency: 0.12, laneBalance: 0.08, patternDiversity: 0.08, repetition: 0.08, playability: 0.1, accentAlignment: 0.08, transitionQuality: 0.06, sectionIntensity: 0.04 };
  Object.entries(metrics).forEach(([k, v]) => { if (w[k] !== undefined && v.applicable !== false) { overall += v.score * w[k]; wsum += w[k]; } });
  if (wsum) overall /= wsum;
  if (issues.some(i => i.severity === 'error')) overall = Math.min(overall, 0.5);
  return { overall: Math.round(overall * 100), metrics, issues, noteCount: notes.length, meanNps: +(notes.length / Math.max(0.001, dur / 1000)).toFixed(2), generatorVersion: V2_GEN_VERSION };
}

export function generateAllRfV2(analysis, title, seed = 1337, opts = {}) {
  return DIFFICULTIES.map((d, i) => generateRfV2(analysis, title, { ...opts, difficulty: d, seed: seed + i * 7919 }));
}
export function generateVariationsRfV2(analysis, title, opts, count = 3) {
  return Array.from({ length: count }, (_, i) => generateRfV2(analysis, title, { ...opts, seed: (opts.seed ?? 1337) + i * 7919 }));
}

export function validateRfV2Chart(chart) { return validateChart(chart); }
