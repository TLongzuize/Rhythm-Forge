import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeSamples, validateChart } from '../core.js';
import { generateRfV2 } from '../rfgen-v2.js';
import { analyzeV3, interpretTimeline } from '../v3/timeline.js';
import { generateV3 } from '../v3/engine.js';

const [stage, reference, cache, output, ...argumentsAfterOutput] = process.argv.slice(2);
const checkControls = argumentsAfterOutput.includes('--controls');
const onlyTracks = argumentsAfterOutput.filter(arg => arg !== '--controls');
assert.ok(['baseline', 'candidate', 'context', 'holdout', 'phrase', 'phrase-holdout', 'spectral', 'spectral-holdout'].includes(stage) &&
  reference && cache && output,
  'Use baseline|candidate|context|holdout|phrase|phrase-holdout|spectral|spectral-holdout REFERENCE_AUDIO_DIR BASELINE_CACHE REPORT_JSON');
mkdirSync(cache, { recursive: true });
const { rows } = JSON.parse(readFileSync('benchmarks/v3-player-acceptance/exports/results.json'));
const spectral = stage.startsWith('spectral');
const holdout = stage === 'holdout' || stage.endsWith('-holdout');
const phrase = spectral || stage.startsWith('phrase');
const recordings = holdout ? [
  { track: 'no-no-no', filename: 'TheFatRat - No No No.mp3' },
  { track: 'abnormal', filename: 'FUNK ABNORMAL (Slowed) - DJ V12.mp3' }
] : rows;
const names = ['easy', 'normal', 'hard', 'expert'];
const sr = 22050;
const round = n => Math.round(n * 1000) / 1000;
const settings = { mode: 'balanced', densityScale: 1 };
const eventsAt = new Map();

function peak(times, width) {
  let left = 0, best = 0;
  for (let right = 0; right < times.length; right++) {
    while (times[right] - times[left] >= width) left++;
    best = Math.max(best, right - left + 1);
  }
  return best;
}

function excerptDifferences(legacy, current, timeline, start, end) {
  const legacyHeads = new Set(legacy.notes.filter(n => n.timeMs >= start && n.timeMs < end).map(n => n.timeMs));
  const currentHeads = [...new Set(current.notes.map(n => n.timeMs))].sort((a, b) => a - b);
  const nearby = timeline.events.filter(event => event.timeMs >= start - 35 && event.timeMs < end + 35);
  const counts = { legacyHeads: legacyHeads.size, sharedWithin35Ms: 0, noMeasuredAttack: 0,
    onlyWeakAttacks: 0, credibleAttackNearCurrentHead: 0, credibleAttackWithRoom: 0 };
  for (const t of legacyHeads) {
    if (currentHeads.some(head => Math.abs(head - t) <= 35)) {
      counts.sharedWithin35Ms++;
      continue;
    }
    const evidence = nearby.filter(event => Math.abs(event.timeMs - t) <= 35);
    const credible = evidence.filter(event => event.confidence >= 0.10);
    if (!evidence.length) counts.noMeasuredAttack++;
    else if (!credible.length) counts.onlyWeakAttacks++;
    else if (credible.some(event => currentHeads.every(head => Math.abs(head - event.timeMs) >= 53)))
      counts.credibleAttackWithRoom++;
    else counts.credibleAttackNearCurrentHead++;
  }
  return counts;
}

function metrics(chart, timeline, start = 0, end = timeline.durationMs) {
  const notes = chart.notes.filter(n => n.timeMs >= start && n.timeMs < end)
    .sort((a,b) => a.timeMs - b.timeMs || a.lane - b.lane);
  const events = timeline.events.filter(e => e.timeMs >= start - 35 && e.timeMs <= end + 35);
  const groups = [];
  const fingers = [[], [], [], []], hands = [[], []];
  const tails = Array(4).fill(-Infinity);
  let collisions = 0, releaseConflicts = 0, rapidFinger = 0, tightFinger = 0, hybridPresses = 0;
  for (const n of notes) {
    const { lane, timeMs: t } = n;
    if (groups.at(-1)?.t !== t) groups.push({ t, lanes: [] });
    groups.at(-1).lanes.push(lane);
    const prev = fingers[lane].at(-1) ?? -Infinity;
    if (t === prev || t < tails[lane]) collisions++;
    if (t < tails[lane] + 45) releaseConflicts++;
    if (t - prev < 160) rapidFinger++;
    if (t - prev < 100) tightFinger++;
    fingers[lane].push(t);
    const hand = hands[lane >> 1];
    if (hand.at(-1) !== t) hand.push(t);
    if (tails.some((tail, finger) => finger !== lane && tail > t)) hybridPresses++;
    if (n.type === 'hold') tails[lane] = n.endTimeMs;
  }
  const sizes = [0, 0, 0, 0, 0], gaps = [0, 0, 0, 0, 0, 0], holds = [];
  const patterns = { jack: 0, trill: 0, roll: 0, zigzag: 0, alternatingStream: 0, mixed: 0, chordstream: 0 };
  let alternate = 0, singleEdges = 0, jackPairs = 0, jackRun = 0, maxJackRun = 0, maxJackMs = 0, jackStart = 0;
  let burst = 0, maxBurst = 0, stream = 0, maxStream = 0, windows = 0;
  let near = 0, quiet = 0, slots = 0, offbeat = 0, timing = 0, index = 0, seg = 0;
  const covered = new Set();
  let brackets = 0, chordRepeats = 0, lastChord;
  for (const [i, group] of groups.entries()) {
    const { t, lanes } = group;
    sizes[lanes.length]++;
    if (lanes.length > 1) {
      if (lanes.length === 2 && (lanes[0] >> 1) === (lanes[1] >> 1)) brackets++;
      if (t - (lastChord?.t ?? -Infinity) <= 245 && lanes.some(lane => lastChord.lanes.includes(lane))) chordRepeats++;
      lastChord = group;
    }
    while (index + 1 < events.length && Math.abs(events[index + 1].timeMs - t) < Math.abs(events[index].timeMs - t)) index++;
    const event = events[index];
    if (event && Math.abs(event.timeMs - t) <= 35) {
      near++;
      timing += Math.abs(event.timeMs - t);
      covered.add(event);
    }
    if (timeline.quietRanges.some(r => t >= r.startMs && t < r.endMs)) quiet++;
    const segments = timeline.tempoMap.segments;
    while (segments[seg + 1]?.startTime <= t) seg++;
    const pulse = segments[seg];
    if (pulse?.confidence >= 0.1) {
      const beat = (t - pulse.phaseMs) / (60000 / pulse.bpm);
      const grid = [4, 3].find(n => Math.abs(beat * n - Math.round(beat * n)) * 60000 / pulse.bpm / n <= 18);
      if (grid) {
        slots++;
        if (Math.abs(beat - Math.round(beat)) * 60000 / pulse.bpm > 32) offbeat++;
      }
    }

    const prev = groups[i - 1];
    const gap = t - (prev?.t ?? -Infinity);
    if (prev) gaps[gap < 75 ? 0 : gap < 110 ? 1 : gap < 160 ? 2 : gap < 230 ? 3 : gap < 360 ? 4 : 5]++;
    const single = lanes.length === 1, priorSingle = prev?.lanes.length === 1;
    if (single && priorSingle && gap <= 360) {
      singleEdges++;
      if (lanes[0] >> 1 !== prev.lanes[0] >> 1) alternate++;
    }
    if (single && priorSingle && gap <= 230 && lanes[0] === prev.lanes[0]) {
      jackPairs++;
      if (jackRun <= 1) jackStart = prev.t;
      jackRun = Math.max(1, jackRun) + 1;
      maxJackRun = Math.max(maxJackRun, jackRun);
      maxJackMs = Math.max(maxJackMs, t - jackStart);
    } else jackRun = 1;
    burst = gap <= 140 ? burst + 1 : 1;
    stream = single && priorSingle && gap <= 180 ? stream + 1 : 1;
    maxBurst = Math.max(maxBurst, burst);
    maxStream = Math.max(maxStream, stream);
    if (i < 3) continue;
    const cell = groups.slice(i - 3, i + 1);
    if (cell.slice(1).some((g, j) => g.t - cell[j].t > 230)) continue;
    windows++;
    if (cell.some(g => g.lanes.length > 1)) { patterns.chordstream++; continue; }
    const [a,b,c,d] = cell.map(g => g.lanes[0]);
    const delta = [b-a, c-b, d-c];
    if (a === b || b === c || c === d) patterns.jack++;
    else if (a === c && b === d) patterns.trill++;
    else if (delta.every(x => x === 1) || delta.every(x => x === -1)) patterns.roll++;
    else if (delta[0] * delta[1] < 0 && delta[1] * delta[2] < 0) patterns.zigzag++;
    else if ([a,b,c,d].every((x,j,ls) => !j || (x >> 1) !== (ls[j-1] >> 1))) patterns.alternatingStream++;
    else patterns.mixed++;
  }
  for (const n of notes) if (n.type === 'hold') holds.push(n.endTimeMs - n.timeMs);
  holds.sort((a,b) => a-b);
  const exact = groups.filter(g => eventsAt.has(g.t)).length;
  const spectralHeads = groups.filter(g => eventsAt.get(g.t)?.spectralOnly).length;
  const secs = (end - start) / 1000;
  return {
    notes: notes.length, heads: groups.length, nps: round(notes.length / secs), hps: round(groups.length / secs),
    peak1: peak(notes.map(n=>n.timeMs),1000), peak2: peak(notes.map(n=>n.timeMs),2000), gaps,
    rapidFinger, tightFinger, rapidHand: hands.reduce((acc, times) =>
      acc + times.filter((t,i) => i && t - times[i - 1] < 110).length, 0),
    alternate: singleEdges ? round(alternate / singleEdges) : null, jackPairs, maxJackRun, maxJackMs, maxStream, maxBurst,
    slots, offbeat, patternWindows: windows, patterns, chordSizes: sizes, chordKeys: notes.length - groups.length,
    holdCount: holds.length, medianHoldMs: holds[Math.floor(holds.length/2)] ?? null,
    heldMs: holds.reduce((a,b) => a+b,0), fingers: fingers.map(a => a.length),
    peakFinger: fingers.map(a=>peak(a,1000)), peakHand: hands.map(a=>peak(a,1000)),
    exact, ...(phrase ? { spectralHeads, brackets, chordRepeats, hybridPresses } : {}),
    near, avgDetectorGapMs: near ? round(timing / near) : null,
    coveredEvents: covered.size, availableEvents: events.length, quiet, collisions, releaseConflicts
  };
}

const summary = [];
for (const row of recordings) {
  const { track, filename } = row;
  if (onlyTracks.length && !onlyTracks.includes(track)) continue;
  const input = join(filename.endsWith('.ogg') ? reference : 'audio_file_to_test', filename);
  const recordingSha = createHash('sha256').update(readFileSync(input)).digest('hex');
  if (row.recordingSha) assert.equal(recordingSha, row.recordingSha);
  const bytes = execFileSync('ffmpeg', ['-v','error','-i',input,'-ac','1','-ar',String(sr),'-f','f32le','-'],
    { maxBuffer: 64 * 1024 * 1024 });
  const pcm = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length/4);
  const mark = performance.now();
  const timeline = interpretTimeline(analyzeV3(pcm, sr));
  const analysisMs = round(performance.now() - mark);
  const legacy = stage === 'baseline' || holdout ? analyzeSamples(pcm, sr) : null;
  eventsAt.clear();
  for (const e of timeline.events) eventsAt.set(Math.round(e.timeMs),e);
  if (spectral) for (const e of timeline.envelopes) eventsAt.set(Math.round(e.timeMs),e);
  if (phrase) for (const e of timeline.spectralAttacks) eventsAt.set(Math.round(e.timeMs),e);
  const entry = { track, filename, recordingSha, duration: timeline.durationMs, analysisMs,
    detectedAttacks: timeline.events.length, bpm: timeline.tempoMap.globalBpm, charts: {} };
  for (const [i, difficulty] of names.entries()) {
    const opts = {...settings, difficulty, seed: 1337 + 7919 * i };
    const basePath = join(cache,`${track}-${difficulty}.json`);
    const before = stage === 'baseline' || holdout ? null : JSON.parse(readFileSync(basePath));
    const prior = phrase ? generateV3(timeline, track, { ...opts, compositionRevision: spectral ? 'phrase-1' : 'context-1' }).chart :
      holdout ? generateV3(timeline, track, { ...opts, compositionRevision: 'difficulty-1' }).chart :
      stage === 'context' ? JSON.parse(readFileSync(join(cache,`${track}-${difficulty}-candidate.json`))) : null;
    const start = performance.now();
    if (phrase && !spectral) opts.compositionRevision = 'phrase-1';
    if (stage === 'candidate') opts.compositionRevision = 'difficulty-1';
    if (stage === 'context' || stage === 'holdout') opts.compositionRevision = 'context-1';
    if (stage === 'baseline') opts.compositionRevision = 'articulation-3';
    const { chart, diagnostics } = generateV3(timeline,track,opts);
    const ms = round(performance.now()-start);
    const v2 = before?.v2 ?? generateRfV2(legacy,track,opts).chart;
    const baseline = before?.v3 ?? (holdout
      ? generateV3(timeline, track, { ...opts, compositionRevision: 'articulation-3' }).chart : chart);
    if (stage === 'baseline') writeFileSync(basePath,JSON.stringify({ v2, v3: chart }), {flag:'wx'});
    else {
      assert.deepEqual(generateV3(timeline,track,opts).chart,chart);
      assert.deepEqual(generateV3(timeline,track,{ ...opts, compositionRevision:'articulation-3' }).chart,baseline);
      if (phrase && !holdout || spectral && holdout) {
        const original = JSON.parse(readFileSync(join(cache,`${track}-${difficulty}-${spectral ? (holdout ? 'phrase-holdout' : 'phrase') : 'context'}.json`)));
        assert.deepEqual(prior, original);
      }
      if (prior && !phrase) {
        if (!holdout)
          assert.deepEqual(generateV3(timeline,track,{ ...opts, compositionRevision:'difficulty-1' }).chart,prior);
        const byId = new Map(chart.notes.map(n=>[n.id,n]));
        for (const n of prior.notes) assert.deepEqual(byId.get(n.id),n);
      }
      assert.deepEqual(chart.generator.tempoMap, baseline.generator.tempoMap);
      const high = generateV3(timeline,track,{ ...opts,densityScale:1.45 }).chart;
      const low = generateV3(timeline,track,{ ...opts,densityScale:0.55 }).chart;
      assert.ok(validateChart(high).valid && validateChart(low).valid);
      const highMetrics = metrics(high,timeline), lowMetrics = metrics(low,timeline);
      assert.equal(highMetrics.quiet + highMetrics.collisions + highMetrics.releaseConflicts, 0);
      assert.equal(lowMetrics.quiet + lowMetrics.collisions + lowMetrics.releaseConflicts, 0);
      assert.ok(high.notes.length >= chart.notes.length);
      assert.ok(low.notes.length <= chart.notes.length);
      if (difficulty === 'hard' || difficulty === 'expert') {
        const byId = new Map(high.notes.map(n=>[n.id,n]));
        for (const n of chart.notes) assert.deepEqual(byId.get(n.id),n);
      }
    }
    const validity = validateChart(chart);
    assert.ok(validity.valid, JSON.stringify(validity.errors));
    const currentTimeline = phrase ? { ...timeline,
      events: [...timeline.events, ...timeline.spectralAttacks, ...(spectral ? timeline.envelopes : [])].sort((a,b) => a.timeMs-b.timeMs) } : timeline;
    const current = metrics(chart,currentTimeline);
    assert.equal(current.quiet + current.collisions + current.releaseConflicts,0);
    assert.equal(current.exact, current.heads);
    assert.equal(validity.warnings.length, 0);
    const selection = track === 'galaxy' ? [200000,220000] : track === 'unity' ? [20000,40000] : track === 'nutcracker' ? [12000,32000] : null;
    entry.charts[difficulty] = { ms, difficultyRating:chart.metadata.difficultyRating, candidates: diagnostics.candidates, v2: metrics(v2,timeline), baseline: metrics(baseline,timeline),
    ...(stage !== 'baseline' ? { current, warnings: validity.warnings, intent: diagnostics.patternIntent,
      ...(diagnostics.workload && phrase ? { workload:diagnostics.workload } : {}) } : {}),
      ...(prior ? { prior:metrics(prior,timeline), technique:diagnostics.contextualTechnique } : {}),
      ...(selection ? { excerpt: { start: selection[0], end: selection[1], v2:metrics(v2,timeline,...selection),
        baseline:metrics(baseline,timeline,...selection),
        ...(prior ? { prior:metrics(prior,timeline,...selection),
          differences: excerptDifferences(v2, chart, timeline, ...selection) } : {}),
        ...(stage !== 'baseline' ? { current:metrics(chart,currentTimeline,...selection) } : {}) } } : {}) };
    if (stage === 'candidate') writeFileSync(join(cache,`${track}-${difficulty}-candidate.json`),JSON.stringify(chart));
    if (stage === 'context' || phrase) writeFileSync(join(cache,`${track}-${difficulty}-${stage}.json`),JSON.stringify(chart));
  }
  if (stage !== 'baseline' && ['galaxy','unity','nutcracker'].includes(track)) {
    entry.modes = {};
    for (const mode of ['balanced','beat','technical','melodic','relax']) {
      const opts = { mode, difficulty:'expert', seed:25094,
        ...(stage === 'candidate' ? { compositionRevision: 'difficulty-1' } :
          phrase ? { compositionRevision:spectral ? 'spectral-1' : 'phrase-1' } : { compositionRevision: 'context-1' }) };
      const { chart } = generateV3(timeline,track,opts);
      const m = metrics(chart,timeline);
      assert.ok(validateChart(chart).valid && !m.quiet && !m.collisions && !m.releaseConflicts);
      entry.modes[mode] = { notes:m.notes, heads:m.heads, chords:m.chordKeys, holdCount:m.holdCount, jackPairs:m.jackPairs };
    }
  }
  if (phrase && checkControls) {
    entry.controls = {};
    for (const mode of ['balanced','beat','technical','melodic','relax']) {
      entry.controls[mode] = {};
      for (const [i, difficulty] of names.entries()) {
        const opts = { mode, difficulty, seed:1337 + i * 7919, compositionRevision:spectral ? 'spectral-1' : 'phrase-1' };
        const sweep = [];
        let core, previousUpper;
        for (const densityScale of [0.55, 0.75, 1, 1.20, 1.45]) {
          const { chart, diagnostics } = generateV3(timeline, track, { ...opts, densityScale });
          const validation = validateChart(chart);
          const { quietHeads, collisions, releaseConflicts } = diagnostics.report.counts;
          assert.ok(validation.valid && !validation.warnings.length && !quietHeads && !collisions && !releaseConflicts,
            JSON.stringify({ track, mode, difficulty, densityScale, warnings:validation.warnings }));
          if (densityScale === 1) core = chart.notes;
          if (densityScale >= 1 && i >= 2) {
            const ids = new Map(chart.notes.map(n => [n.id, n]));
            for (const note of previousUpper ?? core) assert.deepEqual(ids.get(note.id), note);
            previousUpper = chart.notes;
          }
          assert.ok(!sweep.length || chart.notes.length >= sweep.at(-1).notes, JSON.stringify({track,mode,difficulty,densityScale}));
          const heads = new Set(chart.notes.map(note => note.timeMs)).size;
          sweep.push({ densityScale, notes:chart.notes.length, heads, chordKeys:chart.notes.length - heads,
            holds:chart.notes.filter(n => n.type === 'hold').length });
        }
        entry.controls[mode][difficulty] = sweep;
      }
    }
  }
  summary.push(entry);
  writeFileSync(output,JSON.stringify({ stage, peakRssKiB:process.resourceUsage().maxRSS, summary },null,2)+'\n');
  console.error(`Verified ${track}`);
}
