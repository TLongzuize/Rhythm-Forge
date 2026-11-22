import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeSamples, validateChart } from '../core.js';
import { generateRfV2 } from '../rfgen-v2.js';
import { analyzeV3, interpretTimeline } from '../v3/timeline.js';
import { generateV3 } from '../v3/engine.js';
import { V3_PROFILES } from '../v3/composer.js';
import { physicalMetrics } from '../research/final-recovery/experiment.mjs';

const [referenceDir, holdoutDir, output, comparison = 'original'] = process.argv.slice(2);
assert.ok(referenceDir && holdoutDir && output,
  'Usage: node scripts/benchmark-v3-articulation.mjs REFERENCE_DIR HOLDOUT_DIR NEW_OUTPUT_DIR [release|hardening]');
assert.ok(['original', 'release', 'hardening'].includes(comparison));
const hardening = comparison === 'hardening';
const release = comparison !== 'original';
const controlRevision = hardening ? 'articulation-2' : release ? 'articulation-1' : 'event-1';
const candidateRevision = hardening ? 'articulation-3' : release ? 'articulation-2' : 'articulation-1';
const priorExports = hardening ? 'benchmarks/v3-stabilization/exports' : 'benchmarks/v3-articulation/exports';
const prior = release ? JSON.parse(readFileSync(join(priorExports, 'results.json'))).results : [];
const manifest = JSON.parse(readFileSync('research/pattern-grammar/benchmark.json'));
const archived = ['development', 'held-out'].flatMap(split =>
  JSON.parse(readFileSync(`benchmarks/density-e1/${split}.json`)).after.rows);
const tracks = [
  { id: 'galaxy', title: 'Galaxy Collapse', window: release ? [0, 20] : [200, 220], order: 'CAB' },
  { id: 'unity', title: 'Unity', window: hardening ? [20, 40] : [40, 60], order: 'BCA' },
  { id: 'mutilator', title: 'Mutilator Ultra Slowed' },
  { id: 'pistachio', title: 'Pistachio' },
  { id: 'fishin', title: "Let's Go Fishin'" },
  { id: 'vibeace', title: 'Vibe Ace', gateAudio: true, heldOut: true },
  { id: 'nutcracker', title: 'Dance of the Sugar Plum Fairy', gateAudio: true, heldOut: !release,
    window: [12, 32], order: release ? 'CBA' : 'ABC' },
  ...(release ? [{ id: 'brahms', title: 'Hungarian Dance No. 5', heldOut: true }] : [])
];
const sampleRate = 22050;
const hash = data => createHash('sha256').update(data).digest('hex');
const digest = data => hash(JSON.stringify(data));
const round = value => Number(value.toFixed(2));
function timed(run) {
  const start = performance.now();
  const result = run();
  return [result, round(performance.now() - start)];
}
const artifacts = [], results = [];
for (const track of tracks) {
  const previous = manifest.find(t => t.id === track.id);
  const filename = previous?.prefix ? readdirSync('audio_file_to_test').find(f => f.startsWith(previous.prefix)) :
    `${track.id}.ogg`;
  const path = join(track.gateAudio ? holdoutDir : previous?.reference ? referenceDir : 'audio_file_to_test', filename);
  const recordingSha = hash(readFileSync(path));
  const bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-'],
    { maxBuffer: 64 * 1024 * 1024 });
  const pcm = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  const [timeline, analysisMs] = timed(() => interpretTimeline(analyzeV3(pcm, sampleRate)));
  const events = new Map(timeline.events.map(e => [Math.round(e.timeMs), e]));
  const nextAttack = Array(3).fill(Infinity);
  const reattacks = new Map();
  for (const [timeMs, e] of [...events].reverse()) {
    reattacks.set(timeMs, nextAttack[e.band]);
    nextAttack[e.band] = timeMs;
  }
  const durationMs = Math.round(timeline.durationMs);
  const strong = timeline.events.filter(e => e.salience >= 0.35 && e.confidence >= 0.25).map(e => Math.round(e.timeMs));
  const row = { track: track.id, heldOut: Boolean(track.heldOut), filename, recordingSha, durationMs, analysisMs,
    attacks: events.size, difficulties: {},
    ...(hardening ? {
      trackingStates: Object.fromEntries(['release', 'active', 'ambiguous'].map(state =>
        [state, timeline.events.filter(e => e.trackedSustain?.state === state).length]))
    } : {}) };

  for (const [i, [difficulty, profile]] of Object.entries(V3_PROFILES).entries()) {
    const opts = { difficulty, mode: 'balanced', densityScale: 1, seed: 1337 + i * 7919 };
    const currentOptions = { ...opts, compositionRevision: candidateRevision };
    const [{chart: before}, beforeMs] = timed(() => generateV3(timeline, track.title, { ...opts, compositionRevision: controlRevision }));
    const [{chart: after, diagnostics}, afterMs] = timed(() => generateV3(timeline, track.title, currentOptions));
    assert.deepEqual(after, generateV3(timeline, track.title, currentOptions).chart);
    assert.deepEqual(after.generator.tempoMap, before.generator.tempoMap);
    const expected = archived.find(r => r.song === track.id && r.difficulty === difficulty && r.densityScale === 1);
    if (expected && !release) {
      assert.equal(recordingSha, expected.recordingSha);
      assert.equal(digest(before.notes), expected.noteHash);
      assert.equal(digest(before.generator.tempoMap), expected.tempoHash);
    }
    const beforeHeads = new Set(before.notes.map(n => n.timeMs));
    function metrics(notes, seconds, predicate = () => true) {
      const heads = new Set(notes.map(n => n.timeMs));
      const holds = notes.filter(n => n.type === 'hold');
      const lengths = holds.map(n => n.endTimeMs - n.timeMs).sort((a, b) => a - b);
      const tonalTails = holds.filter(n => Math.abs(n.endTimeMs -
        (events.get(n.timeMs)?.tonalHoldEvidence?.endTimeMs ?? -Infinity)) <= 1).length;
      const trackedTails = holds.filter(n => Math.abs(n.endTimeMs -
        (events.get(n.timeMs)?.trackedSustain?.endTimeMs ?? -Infinity)) <= 1).length;
      const trackedOffsets = holds.flatMap(n => {
        const evidence = events.get(n.timeMs)?.trackedSustain;
        return evidence?.state === 'release' ? [n.endTimeMs - evidence.endTimeMs] : [];
      });
      const strongCovered = strong.filter(t => heads.has(t)).length;
      const retainedStrong = strong.filter(t => predicate(t) && beforeHeads.has(t) && heads.has(t)).length;
      return { heads: heads.size, notes: notes.length, nps: round(notes.length / seconds),
        extraChordHeads: notes.length - heads.size, holds: holds.length,
        shortHolds: holds.filter(n => n.endTimeMs - n.timeMs < 400).length,
        tonalTails, medianHoldMs: lengths[Math.floor(lengths.length / 2)] ?? null,
        ...(hardening ? {
          trackedTails, over1800ms: lengths.filter(length => length > 1800).length,
          p90HoldMs: lengths[Math.ceil(lengths.length * 0.90) - 1] ?? null,
          earlierThanTrackedEstimate: trackedOffsets.filter(offset => offset < -35).length,
          laterThanTrackedEstimate: trackedOffsets.filter(offset => offset > 35).length
        } : {}),
        heldSeconds: round(lengths.reduce((sum, length) => sum + length, 0) / 1000),
        reattackEnds: holds.filter(n => Math.abs(reattacks.get(n.timeMs) - n.endTimeMs) <= 22).length,
        exactMeasured: [...heads].filter(t => events.has(t)).length,
        quietHeads: [...heads].filter(t => timeline.quietRanges.some(r => t >= r.startMs && t < r.endMs)).length,
        strongCovered, retainedStrong,
        ...physicalMetrics(notes, profile.laneGap) };
    }
    const old = metrics(before.notes, durationMs / 1000);
    const current = metrics(after.notes, durationMs / 1000);
    const saved = prior.find(r => r.track === track.id);
    if (saved) {
      assert.equal(recordingSha, saved.recordingSha);
      for (const key of ['heads', 'notes', 'holds', 'fastFinger', 'fastHand'])
        assert.equal(old[key], saved.difficulties[difficulty].after[key], `Baseline drift in ${track.id} ${difficulty} ${key}`);
    }
    const validation = validateChart(after);
    assert.ok(validation.valid && after.notes.every((n, j) => n.timeMs >= (after.notes[j - 1]?.timeMs ?? 0)));
    assert.equal(current.heads, current.exactMeasured);
    assert.equal(current.quietHeads + current.collisions + current.releaseConflicts, 0);
    assert.ok((current.minFingerGap ?? Infinity) >= profile.laneGap);
    assert.equal(validation.warnings.length, 0, JSON.stringify(validation.warnings.slice(0, 4)));
    if (difficulty === 'hard' || difficulty === 'expert') {
      const dense = generateV3(timeline, track.title, { ...currentOptions, densityScale: 1.45 }).chart;
      const byId = new Map(dense.notes.map(n => [n.id, n]));
      for (const n of after.notes) assert.deepEqual(byId.get(n.id), n);
      assert.ok(validateChart(dense).valid);
    }
    if (hardening) {
      const beforePresses = new Set(before.notes.map(n => `${n.timeMs}:${n.lane}`));
      current.changedPressLanes = after.notes.filter(n => !beforePresses.has(`${n.timeMs}:${n.lane}`)).length;
      current.supportedHoldRate = diagnostics.report.estimates.supportedHoldRate;
      assert.deepEqual([...new Set(after.notes.map(n => n.timeMs))], [...beforeHeads]);
      assert.ok(current.changedPressLanes <= old.holds + current.holds,
        `The sustain pass changed the wider layout in ${track.id} ${difficulty}`);
    }
    row.difficulties[difficulty] = { before: old, after: current, beforeMs, afterMs, candidates: diagnostics.candidates,
      originalHeadsKept: new Set(after.notes.filter(n => beforeHeads.has(n.timeMs)).map(n => n.timeMs)).size };
    if (track.window && difficulty === 'expert') {
      const [start, end] = track.window;
      const inside = t => t >= start * 1000 && t < end * 1000;
      const sameWindow = saved?.excerpt.start === start && saved?.excerpt.end === end;
      const v2 = sameWindow
        ? JSON.parse(readFileSync(join(priorExports, 'charts', `${track.id}-${saved.excerpt.takes.A.take}.json`)))
        : generateRfV2(analyzeSamples(pcm, sampleRate), track.title, opts).chart;
      const charts = { A: v2, B: before, C: after };
      const takes = {};
      let finalTail = end * 1000;
      for (const [i, variant] of [...track.order].entries()) {
        const chart = charts[variant], take = i + 1;
        const notes = chart.notes.filter(n => inside(n.timeMs)).map((n, j) => ({ ...n, id: `note-${j + 1}` }));
        const comparison = { schemaVersion: 1, chartId: `rf-${candidateRevision}-${track.id}-${take}`,
          metadata: { ...chart.metadata, title: `${track.title} · Take ${take}` },
          generator: { tempoMap: chart.generator.tempoMap },
          notes };
        assert.ok(validateChart(comparison).valid);
        const measured = metrics(notes, end - start, inside);
        assert.equal(measured.collisions, 0);
        takes[variant] = { take, ...measured };
        finalTail = Math.max(finalTail, ...notes.map(n => n.endTimeMs ?? 0));
        artifacts.push({ name: `${track.id}-${take}.json`, chart: comparison });
      }
      row.excerpt = { start, end, options: opts, takes, loop: [
        Math.max(0, Math.floor((start * 1000 - 700) * 100 / durationMs)),
        Math.min(100, Math.ceil((finalTail + 300) * 100 / durationMs))
      ] };
      if (hardening && saved.referenceExcerpt) {
        const {start: referenceStart, end: referenceEnd, v2: earlierV2} = saved.referenceExcerpt;
        const inReference = n => n.timeMs >= referenceStart * 1000 && n.timeMs < referenceEnd * 1000;
        row.referenceExcerpt = { start: referenceStart, end: referenceEnd, v2: earlierV2,
          before: metrics(before.notes.filter(inReference), referenceEnd - referenceStart),
          after: metrics(after.notes.filter(inReference), referenceEnd - referenceStart) };
      } else if (release && !sameWindow) {
        const {start: referenceStart, end: referenceEnd, takes: older} = saved.excerpt;
        const inReference = n => n.timeMs >= referenceStart * 1000 && n.timeMs < referenceEnd * 1000;
        row.referenceExcerpt = { start: referenceStart, end: referenceEnd, v2: older.A,
          before: metrics(before.notes.filter(inReference), referenceEnd - referenceStart),
          after: metrics(after.notes.filter(inReference), referenceEnd - referenceStart) };
      }
    }
  }
  results.push(row);
  console.error(`Checked ${track.title}`);
}
mkdirSync(output);
mkdirSync(join(output, 'charts'));
for (const {name, chart} of artifacts) writeFileSync(join(output, 'charts', name), JSON.stringify(chart) + '\n', { flag: 'wx' });
writeFileSync(join(output, 'results.json'), JSON.stringify({
  node: process.version, sampleRate, controlRevision, candidateRevision, peakRssKiB: process.resourceUsage().maxRSS, results
}, null, 2) + '\n', { flag: 'wx' });
