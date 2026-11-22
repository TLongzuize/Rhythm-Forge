import { interpretTimeline } from './timeline.js';
import { composeV3, addV3DensityDetail, prepareV3Composition, technicalRhythm,
  V3_COMPOSITION_REVISION, V3_PHRASE_REVISION, V3_SPECTRAL_REVISION, V3_PROFILES } from './composer.js';
import { assessV3, layoutUtility, measureV3Workload, phraseLayoutUtility, rateV3Difficulty } from './quality.js';
import { effortBudget, V3_POLICY_REVISION } from './effort.js';
import { arrangeV3Technical } from './arrangement.js';

export const V3_ENGINE_REVISION = V3_SPECTRAL_REVISION;

export function generateV3(timeline, title, opts = {}) {
  const {
    difficulty = 'normal',
    effort,
    mode = 'balanced',
    seed = 1337,
    resourceClass = 'standard'
  } = opts;
  const compositionRevision = opts.compositionRevision ??
    (effort === undefined ? V3_ENGINE_REVISION : 'event-1');
  if (!['event-1', 'articulation-1', 'articulation-2', 'articulation-3',
    V3_COMPOSITION_REVISION, 'context-1', V3_PHRASE_REVISION, V3_ENGINE_REVISION].includes(compositionRevision))
    throw Error('Unknown V3 composition revision.');
  const sourceEvents = opts.traceEvents ? [...timeline.events, ...(timeline.spectralAttacks ?? []), ...(timeline.envelopes ?? [])] : null;
  const contextual = compositionRevision === 'context-1';
  const phraseRevision = compositionRevision === V3_ENGINE_REVISION || compositionRevision === V3_PHRASE_REVISION;
  const phrasePlan = phraseRevision && mode !== 'beat' && mode !== 'relax';
  if (phrasePlan && (difficulty === 'hard' || difficulty === 'expert') && (timeline.spectralAttacks?.length || timeline.envelopes?.length))
    timeline = { ...timeline, events: [...timeline.events, ...(timeline.spectralAttacks ?? []),
      ...(compositionRevision === V3_ENGINE_REVISION ? timeline.envelopes ?? [] : [])].sort((a, b) => a.timeMs - b.timeMs) };
  const coreRevision = contextual || phraseRevision && !phrasePlan
    ? V3_COMPOSITION_REVISION : compositionRevision;
  const densityScale = Math.max(0.55, Math.min(1.45, opts.densityScale ?? 1));
  const addDetail = effort === undefined && densityScale > 1 && (difficulty === 'hard' || difficulty === 'expert');
  const coreOptions = { ...opts, difficulty, mode, compositionRevision: coreRevision, densityScale: addDetail ? 1 : densityScale };
  // Keep the established fingering search stable. A better release estimate
  // can change a local grip without choosing a different song-wide layout.
  const searchOptions = compositionRevision === 'articulation-3'
    ? { ...coreOptions, compositionRevision: 'articulation-2' } : coreOptions;
  const budget = effortBudget(effort, timeline.events.length, resourceClass);
  const profile = V3_PROFILES[difficulty];
  const start = performance.now();
  const rhythmEvidence = difficulty === 'hard' || difficulty === 'expert'
    ? technicalRhythm(timeline.events, opts.minConfidence ?? 0.1) : undefined;
  const plan = phrasePlan ? prepareV3Composition(timeline, searchOptions, rhythmEvidence) : undefined;
  let best,
    utility = -Infinity,
    tried = 0,
    stale = 0;
  while (tried < budget.limit && stale < budget.patience) {
    const variation = tried++;
    const intent = coreRevision === V3_COMPOSITION_REVISION || phrasePlan ? { rapidJacks: 0, rollSteps: 0 } : undefined;
    const notes = composeV3(timeline, searchOptions, variation, rhythmEvidence, intent, plan);
    const report = assessV3(notes, timeline, profile);
    const workload = phrasePlan ? measureV3Workload(notes, profile) : undefined;
    const score = workload ? phraseLayoutUtility(report, intent, workload, timeline.durationMs) : layoutUtility(report, intent);
    if (score > utility + 1e-8) {
      best = { notes, report, variation, intent, workload };
      utility = score;
      stale = 0;
    } else stale++;
    if (notes.length < 2) break;
  }
  if (!best) throw Error('V3 found no collision-free layout.');
  const { tempoMap, durationMs } = timeline;
  const core = searchOptions === coreOptions ? best.notes :
    composeV3(timeline, coreOptions, best.variation, rhythmEvidence);
  const arranged = contextual ? arrangeV3Technical(core, timeline, coreOptions, profile) : { notes: core };
  const notes = addDetail
    ? addV3DensityDetail(timeline, arranged.notes, {...opts, difficulty, mode, densityScale}, rhythmEvidence) : arranged.notes;
  const report = notes === best.notes ? best.report : assessV3(notes, timeline, profile);
  const workload = notes === best.notes ? best.workload : phrasePlan ? measureV3Workload(notes, profile) : undefined;
  // Identify the actual layout as well as its difficulty.
  let hash = 2166136261;
  for (const n of notes)
    for (const v of [n.timeMs, n.lane, n.endTimeMs || 0]) hash = Math.imul(hash ^ v, 16777619);
  for (const ch of title || 'Untitled track') hash = Math.imul(hash ^ ch.codePointAt(0), 16777619);
  let lineage;
  if (sourceEvents) {
    const eventTrace = new Map(sourceEvents.map(e => [e, {
      voice:e.voice, envelope:e.envelope, id:(e.envelopeOnly ? 'envelope-' : e.spectralOnly ? 'spectral-' : 'broad-') + e.timeMs.toFixed(4),
      sourceMs:e.timeMs, refinedMs:e.timeMs, confidence:e.confidence, strength:e.strength, band:e.band,
      bandSpread:e.bandSpread, components:e.components, coattack:e.coattack, spectralRise:e.spectralRise,
      pulse:e.pulse, subdivisionError:e.subdivisionError, phrase:e.phraseId, slot:e.slot,
      decision:'difficulty-or-mode'
    }]));
    // Trace the winning layout only. Tracing never influences the search.
    const tracedOptions = { ...coreOptions, eventTrace };
    const tracedPlan = prepareV3Composition(timeline, tracedOptions, rhythmEvidence);
    composeV3(timeline, tracedOptions, best.variation, rhythmEvidence, undefined, tracedPlan);
    const byTime = new Map();
    for (const note of notes) {
      if (!byTime.has(note.timeMs)) byTime.set(note.timeMs, []);
      byTime.get(note.timeMs).push(note);
    }
    lineage = [...eventTrace.values()].map(row => {
      const final = byTime.get(Math.round(row.refinedMs)) ?? [];
      if (final.length && row.decision !== 'selected') row.decision = 'optional-detail-or-arrangement';
      if (final.length && row.plannedWidth > final.length) row.chordDecision = 'displaced-for-hold';
      return { ...row, finalMs:final[0]?.timeMs ?? null, timingAdjustmentMs:final.length ?
        final[0].timeMs - row.refinedMs : null, final };
    }).sort((a, b) => a.refinedMs - b.refinedMs);
  }
  const chart = {
    schemaVersion: 1,
    chartId: `rf3-${(hash >>> 0).toString(16)}-${Math.round(durationMs)}-${difficulty}`,
    metadata: {
      title: title || 'Untitled track',
      difficulty,
      audioDurationMs: Math.max(1, Math.round(durationMs)),
      bpm: tempoMap.globalBpm,
      offsetMs: Math.round(tempoMap.firstBeatMs),
      difficultyRating: compositionRevision === V3_SPECTRAL_REVISION ? rateV3Difficulty(notes,durationMs) : Math.min(10, Math.max(0.5, report.counts.nps * 0.66 + report.estimates.strainPerHead))
    },
    generator: {
      engine: 'rf-v3',
      name: 'RF Generator V3',
      version: '3.0.0-experimental',
      seed,
      mode,
      ...(effort === undefined ? {
        policyRevision: V3_POLICY_REVISION,
        ...(compositionRevision !== 'event-1' ? { compositionRevision } : {}),
        ...(addDetail ? {densityRevision: 'optional-detail-1'} : {}),
        generationOptions: {
          densityScale,
          minConfidence: opts.minConfidence ?? 0.1,
          ...(Number.isFinite(opts.bpmOverride) ? { bpmOverride: opts.bpmOverride } : {}),
          ...(Number.isFinite(opts.offsetOverrideMs) ? { offsetOverrideMs: opts.offsetOverrideMs } : {})
        }
      } : { effort, ...(compositionRevision !== 'event-1' ? { compositionRevision } : {}) }),
      resourceClass,
      tempoMap,
      sections: timeline.sections,
      downbeat: timeline.downbeat,
      layoutCandidates: tried
    },
    notes
  };
  return {
    chart,
    diagnostics: {
      ...(lineage ? { lineage } : {}),
      generationMs: performance.now() - start,
      candidates: tried,
      optimizationPasses: tried - 1,
      utility: notes === best.notes ? utility : workload
        ? phraseLayoutUtility(report, best.intent, workload, durationMs) : layoutUtility(report, best.intent),
      ...(workload ? { workload } : {}),
      ...(best.intent ? { patternIntent: best.intent } : {}),
      ...(arranged.technique ? { contextualTechnique: arranged.technique } : {}),
      report
    }
  };
}

export function generateV3Set(analysis, title, opts = {}, onProgress = () => {}) {
  const timeline = interpretTimeline(analysis, opts);
  const difficulties = opts.difficulty ? [opts.difficulty] : ['easy', 'normal', 'hard', 'expert'];
  return difficulties.map((difficulty, i) => {
    const seed = (opts.seed ?? 1337) + ['easy', 'normal', 'hard', 'expert'].indexOf(difficulty) * 7919;
    const result = generateV3(timeline, title, { ...opts, difficulty, seed });
    onProgress((i + 1) / difficulties.length);
    return result;
  });
}
