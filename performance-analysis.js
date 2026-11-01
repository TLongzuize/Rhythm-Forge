import { SCORE_V2_JUDGEMENT_VALUES } from './score-v2.js';
/** Evidence-based post-play analysis. All times are chart-relative milliseconds. */
export const PERFORMANCE_SCHEMA_VERSION = 1;
export const PERFORMANCE_ALGORITHM_VERSION = 'rf-performance-2.0.0';

const JUDGEMENT_ACCURACY = Object.freeze(Object.fromEntries(Object.entries(SCORE_V2_JUDGEMENT_VALUES).map(([key,value]) => [key, value / 305])));
const JUDGEMENT_KEYS = Object.keys(JUDGEMENT_ACCURACY);
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
const round = (n, digits = 2) => Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};
const variance = values => {
  if (values.length < 2) return null;
  const m = mean(values);
  return values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1);
};
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), at = (sorted.length - 1) * p;
  const lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
};
const countBy = (items, keyFn) => {
  const out = {};
  for (const item of items) {
    const key = String(keyFn(item) ?? 'unknown');
    out[key] = (out[key] || 0) + 1;
  }
  return out;
};

export function normalizePerformanceEvents(rawEvents = []) {
  if (!Array.isArray(rawEvents)) throw new TypeError('Performance events must be an array.');
  const normalized = [];
  for (let index = 0; index < rawEvents.length; index++) {
    const raw = rawEvents[index];
    if (!raw || typeof raw !== 'object') continue;
    const expectedTimeMs = Number(raw.expectedTimeMs ?? raw.expectedHitTimeMs ?? raw.noteTimeMs);
    const actualTimeValue = raw.actualTimeMs ?? raw.actualInputTimeMs;
    const actualTimeMs = actualTimeValue == null ? null : Number(actualTimeValue);
    const explicitError = raw.hitErrorMs == null ? null : Number(raw.hitErrorMs);
    const hitErrorMs = Number.isFinite(explicitError) ? explicitError : Number.isFinite(actualTimeMs) && Number.isFinite(expectedTimeMs) ? actualTimeMs - expectedTimeMs : null;
    if (!Number.isFinite(expectedTimeMs)) continue;
    if (actualTimeMs !== null && !Number.isFinite(actualTimeMs)) continue;
    const judgement = JUDGEMENT_KEYS.includes(String(raw.judgement)) ? String(raw.judgement) : 'miss';
    const lane = Number.isInteger(raw.lane) && raw.lane >= 0 && raw.lane <= 3 ? raw.lane : null;
    normalized.push({
      schemaVersion: PERFORMANCE_SCHEMA_VERSION,
      id: String(raw.id ?? `${raw.noteId ?? 'event'}-${index}`),
      noteId: raw.noteId == null ? null : String(raw.noteId),
      eventTimestampMs: Number.isFinite(Number(raw.eventTimestampMs)) ? Number(raw.eventTimestampMs) : null,
      expectedTimeMs,
      actualTimeMs: Number.isFinite(actualTimeMs) ? actualTimeMs : null,
      hitErrorMs: Number.isFinite(hitErrorMs) ? hitErrorMs : null,
      lane,
      noteType: String(raw.noteType ?? raw.type ?? 'tap'),
      judgement,
      combo: Number.isFinite(Number(raw.combo)) ? Math.max(0, Number(raw.combo)) : null,
      chartSection: raw.chartSection == null ? null : String(raw.chartSection),
      sectionId: raw.sectionId == null ? (raw.chartSection == null ? null : String(raw.chartSection)) : String(raw.sectionId),
      beatPosition: Number.isFinite(Number(raw.beatPosition)) ? Number(raw.beatPosition) : null,
      patternId: raw.patternId == null ? null : String(raw.patternId),
      difficulty: raw.difficulty == null ? null : String(raw.difficulty),
      density: Number.isFinite(Number(raw.density)) ? Number(raw.density) : null,
      source: raw.source === 'legacy' ? 'legacy' : 'recorded',
    });
  }
  normalized.sort((a, b) => a.expectedTimeMs - b.expectedTimeMs || (a.lane ?? 0) - (b.lane ?? 0));
  return normalized;
}

function timingStats(events) {
  const errors = events.map(event => event.hitErrorMs).filter(Number.isFinite);
  if (!errors.length) return { sampleSize: 0, meanMs: null, medianMs: null, standardDeviationMs: null, meanAbsoluteErrorMs: null, medianAbsoluteErrorMs: null, earlyPercent: null, latePercent: null, bias: 'unavailable', percentilesMs: { p5: null, p25: null, p75: null, p95: null }, confidence: 0 };
  const avg = mean(errors), sd = Math.sqrt(variance(errors) || 0), early = errors.filter(value => value < -1).length, late = errors.filter(value => value > 1).length;
  const abs = errors.map(Math.abs), histogram = Array.from({ length: 41 }, (_, index) => ({ centerMs: -200 + index * 10, count: 0 }));
  for (const error of errors) { const index = Math.max(0, Math.min(40, Math.round((Math.max(-200, Math.min(200, error)) + 200) / 10))); histogram[index].count++; }
  return {
    sampleSize: errors.length,
    meanMs: round(avg), medianMs: round(median(errors)), standardDeviationMs: round(sd),
    meanAbsoluteErrorMs: round(mean(abs)), medianAbsoluteErrorMs: round(median(abs)),
    earlyPercent: round(early / errors.length * 100), latePercent: round(late / errors.length * 100),
    bias: avg < -4 ? 'early' : avg > 4 ? 'late' : 'centred',
    percentilesMs: { p5: round(percentile(errors, .05)), p25: round(percentile(errors, .25)), p75: round(percentile(errors, .75)), p95: round(percentile(errors, .95)) },
    histogram: { rangeMs: 200, bucketWidthMs: 10, bins: histogram },
    confidence: round(clamp(errors.length / 50) * clamp(1 - 1 / (sd + 2)), 3),
  };
}

function summarizeEvents(events) {
  const counts = Object.fromEntries(JUDGEMENT_KEYS.map(key => [key, 0]));
  for (const event of events) counts[event.judgement] = (counts[event.judgement] || 0) + 1;
  const total = events.length, weighted = events.reduce((sum, event) => sum + JUDGEMENT_ACCURACY[event.judgement], 0);
  return { total, counts, accuracy: total ? round(weighted / total * 100) : null, percentages: Object.fromEntries(JUDGEMENT_KEYS.map(key => [key, total ? round(counts[key] / total * 100) : null])) };
}

function byDimension(events, dimension) {
  const groups = new Map();
  for (const event of events) {
    const key = event[dimension];
    if (key === null || key === undefined) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  return Object.fromEntries([...groups].map(([key, group]) => {
    const summary = summarizeEvents(group), timing = timingStats(group);
    return [key, { ...summary, timing }];
  }));
}

function detectGroups(events, predicate, minLength = 3) {
  const groups = []; let start = -1;
  for (let i = 0; i <= events.length; i++) {
    const active = i < events.length && predicate(events[i], events[i - 1], i);
    if (active && start < 0) start = i;
    if (!active && start >= 0) {
      if (i - start >= minLength) groups.push(events.slice(start, i));
      start = -1;
    }
  }
  return groups;
}

function metricSkill(events, evidenceCount, scoreFn, minimum = 5) {
  if (evidenceCount < minimum) return { score: null, confidence: 0, sampleSize: evidenceCount, status: 'insufficient-data' };
  const score = clamp(scoreFn(events), 0, 1) * 100;
  return { score: round(score), confidence: round(clamp(evidenceCount / (minimum * 4))), sampleSize: evidenceCount, status: 'measured' };
}

export function analyzeTiming(events) {
  const normalized = normalizePerformanceEvents(events);
  const byLane = {};
  for (let lane = 0; lane < 4; lane++) byLane[lane] = timingStats(normalized.filter(event => event.lane === lane));
  return { overall: timingStats(normalized), byLane, byNoteType: Object.fromEntries([...new Set(normalized.map(event => event.noteType))].map(type => [type, timingStats(normalized.filter(event => event.noteType === type))])) };
}

export function analyzeLanes(events) {
  const normalized = normalizePerformanceEvents(events), result = {};
  for (let lane = 0; lane < 4; lane++) {
    const laneEvents = normalized.filter(event => event.lane === lane), summary = summarizeEvents(laneEvents), timing = timingStats(laneEvents);
    result[lane] = { ...summary, timing, holdEvents: laneEvents.filter(event => event.noteType.startsWith('hold')).length, noteDensityPerSecond: laneEvents.length && laneEvents.length > 1 ? round((laneEvents.length - 1) / Math.max(.001, (laneEvents.at(-1).expectedTimeMs - laneEvents[0].expectedTimeMs) / 1000), 2) : null, sampleAdequate: laneEvents.length >= 12 };
  }
  const measured = Object.values(result).filter(lane => lane.sampleAdequate && lane.accuracy !== null);
  const ranked = Object.entries(result).filter(([, lane]) => lane.sampleAdequate).sort((a, b) => a[1].accuracy - b[1].accuracy);
  const laneSpread = ranked.length >= 2 ? ranked.at(-1)[1].accuracy - ranked[0][1].accuracy : 0;
  // Equal-performing lanes are tied, not a meaningful weak/strong-lane diagnosis.
  const weakLane = laneSpread >= 2 ? Number(ranked[0][0]) : null;
  const strongLane = laneSpread >= 2 ? Number(ranked.at(-1)[0]) : null;
  return { lanes: result, weakLane, strongLane, confidence: round(clamp(measured.length / 4)) };
}

export function analyzeSkills(events, chartMetadata = {}) {
  const normalized = normalizePerformanceEvents(events), sorted = normalized.filter(event => event.judgement !== 'miss' || event.actualTimeMs !== null);
  const noteEvents = sorted.filter(event => !event.noteType.endsWith('-tail'));
  const streams = detectGroups(noteEvents, (event, previous) => !!previous && event.expectedTimeMs - previous.expectedTimeMs <= 180 && event.expectedTimeMs - previous.expectedTimeMs > 0, 5);
  const jacks = detectGroups(noteEvents, (event, previous) => !!previous && event.lane !== null && event.lane === previous.lane && event.expectedTimeMs - previous.expectedTimeMs <= 260, 3);
  const bursts = detectGroups(noteEvents, (event, previous) => !!previous && event.expectedTimeMs - previous.expectedTimeMs <= 95 && event.expectedTimeMs - previous.expectedTimeMs > 0, 3);
  const chords = [];
  for (let i = 0; i < noteEvents.length;) {
    let j = i + 1;
    while (j < noteEvents.length && noteEvents[j].expectedTimeMs - noteEvents[i].expectedTimeMs <= 18) j++;
    if (j - i >= 2) chords.push(noteEvents.slice(i, j));
    i = j;
  }
  const accuracyOf = group => group.length ? mean(group.map(event => JUDGEMENT_ACCURACY[event.judgement])) : null;
  const errorConsistency = group => {
    const errors = group.map(event => event.hitErrorMs).filter(Number.isFinite);
    const sd = Math.sqrt(variance(errors) || 0);
    return errors.length ? clamp(1 - sd / 90) : accuracyOf(group) ?? 0;
  };
  const holdHeads = sorted.filter(event => event.noteType === 'hold-head'), holdTails = sorted.filter(event => event.noteType === 'hold-tail');
  const readingFeatures = noteEvents.filter(event => event.lane !== null);
  const laneChanges = readingFeatures.slice(1).filter((event, index) => event.lane !== readingFeatures[index].lane).length;
  const jumpGroups = chords.filter(chord => chord.length >= 2).length + streams.filter(group => group.some((event, index) => index > 0 && event.lane !== group[index - 1].lane)).length;
  return {
    stream: metricSkill(streams.flat(), streams.reduce((sum, group) => sum + group.length, 0), group => errorConsistency(group) * .55 + (accuracyOf(group) ?? 0) * .45),
    jack: metricSkill(jacks.flat(), jacks.reduce((sum, group) => sum + group.length, 0), group => errorConsistency(group) * .4 + (accuracyOf(group) ?? 0) * .6),
    chord: metricSkill(chords.flat(), chords.reduce((sum, group) => sum + group.length, 0), group => accuracyOf(group) ?? 0),
    burst: metricSkill(bursts.flat(), bursts.reduce((sum, group) => sum + group.length, 0), group => errorConsistency(group) * .5 + (accuracyOf(group) ?? 0) * .5),
    jumpstream: metricSkill(noteEvents, jumpGroups, group => errorConsistency(group) * .5 + (accuracyOf(group) ?? 0) * .5),
    hold: metricSkill(holdHeads.concat(holdTails), Math.min(holdHeads.length, holdTails.length), group => accuracyOf(group) ?? 0, 3),
    reading: metricSkill(readingFeatures, readingFeatures.length, group => clamp(.7 * (accuracyOf(group) ?? 0) + .3 * Math.min(1, laneChanges / Math.max(1, readingFeatures.length * .5))), 12),
    evidence: { streamGroups: streams.length, jackGroups: jacks.length, chordGroups: chords.length, burstGroups: bursts.length, holdHeads: holdHeads.length, holdTails: holdTails.length, sourcePatternMetadata: normalized.some(event => event.patternId !== null), chartDifficulty: chartMetadata.difficulty ?? null },
  };
}

export function analyzeSections(events, sections = []) {
  const normalized = normalizePerformanceEvents(events);
  if (!Array.isArray(sections) || !sections.length) return { available: false, sections: [], strongest: null, weakest: null };
  const results = sections.filter(section => Number.isFinite(Number(section.startTimeMs)) && Number.isFinite(Number(section.endTimeMs)) && section.endTimeMs > section.startTimeMs).map((section, index) => {
    const sectionEvents = normalized.filter(event => event.expectedTimeMs >= section.startTimeMs && event.expectedTimeMs < section.endTimeMs), summary = summarizeEvents(sectionEvents), timing = timingStats(sectionEvents);
    return { id: String(section.id ?? index), name: section.name ?? section.label ?? `Section ${index + 1}`, startTimeMs: Number(section.startTimeMs), endTimeMs: Number(section.endTimeMs), startBeat: section.startBeat ?? null, endBeat: section.endBeat ?? null, noteCount: sectionEvents.length, accuracy: summary.accuracy, missCount: summary.counts.miss, meanHitErrorMs: timing.meanMs, timingStdDevMs: timing.standardDeviationMs, maxCombo: Math.max(0, ...sectionEvents.map(event => event.combo ?? 0)), patterns: countBy(sectionEvents.filter(event => event.patternId), event => event.patternId), performanceScore: summary.accuracy === null ? null : round(summary.accuracy * clamp(1 - (timing.meanAbsoluteErrorMs ?? 0) / 160)) };
  });
  const sampled = results.filter(section => section.noteCount >= 3 && section.accuracy !== null);
  return { available: results.length > 0, sections: results, strongest: sampled.length ? sampled.reduce((a, b) => a.accuracy > b.accuracy ? a : b).id : null, weakest: sampled.length ? sampled.reduce((a, b) => a.accuracy < b.accuracy ? a : b).id : null };
}

export function analyzePatterns(events) {
  const normalized = normalizePerformanceEvents(events), groups = new Map();
  for (const event of normalized) if (event.patternId) {
    if (!groups.has(event.patternId)) groups.set(event.patternId, []);
    groups.get(event.patternId).push(event);
  }
  return Object.fromEntries([...groups].map(([pattern, group]) => {
    const summary = summarizeEvents(group), timing = timingStats(group);
    return [pattern, { occurrenceCount: group.length, accuracy: summary.accuracy, missRate: summary.total ? round(summary.counts.miss / summary.total * 100) : null, timingConsistencyMs: timing.standardDeviationMs, averageDensity: round(mean(group.map(event => event.density).filter(Number.isFinite))), averageDifficulty: group.find(event => event.difficulty)?.difficulty ?? null, confidence: round(clamp(group.length / 30)) }];
  }));
}

export function calculateRFPerformanceRating({ accuracy, timing, maxCombo, maxPossibleCombo, chartDifficulty = 1, skills = {}, sampleSize = 0, hasTimingData = true } = {}) {
  const timingStatsData = timing?.overall ?? timing ?? {}, confidence = clamp(sampleSize / 40) * (hasTimingData ? 1 : .55);
  if (sampleSize < 5 || !Number.isFinite(Number(accuracy))) return { value: null, confidence: round(confidence), status: 'insufficient-data', version: PERFORMANCE_ALGORITHM_VERSION };
  const acc = clamp(Number(accuracy) / 100), combo = clamp(Number(maxCombo) / Math.max(1, Number(maxPossibleCombo) || 1));
  const precision = hasTimingData && Number.isFinite(timingStatsData.meanAbsoluteErrorMs) ? clamp(1 - timingStatsData.meanAbsoluteErrorMs / 160) : .75;
  const skillValues = Object.values(skills).map(skill => skill?.score).filter(Number.isFinite);
  const skillFactor = skillValues.length ? mean(skillValues) / 100 : .75;
  const stars = clamp(Number(chartDifficulty) / 12, .05, 1);
  const performance = (acc ** 1.8) * (.55 + .25 * precision + .2 * combo) * (.85 + .15 * skillFactor);
  return { value: round(Math.max(0, stars * performance * 100), 2), confidence: round(confidence), status: 'provisional', version: PERFORMANCE_ALGORITHM_VERSION, components: { chartDifficulty: round(Number(chartDifficulty)), accuracy: round(acc * 100), precision: round(precision * 100), combo: round(combo * 100), skillFactor: round(skillFactor * 100) } };
}

export function generatePracticeRecommendations(analysis) {
  const recommendations = [], timing = analysis?.timing?.overall, lanes = analysis?.lanes?.lanes, skills = analysis?.skills;
  if (timing?.sampleSize >= 20 && timing.bias === 'early') recommendations.push({ issue: 'Consistently early timing', evidence: { meanHitErrorMs: timing.meanMs, sampleSize: timing.sampleSize }, target: 'Timing control', practice: 'Use a steady beat chart and aim for the centre of the hit window.', confidence: timing.confidence });
  if (timing?.sampleSize >= 20 && timing.bias === 'late') recommendations.push({ issue: 'Consistently late timing', evidence: { meanHitErrorMs: timing.meanMs, sampleSize: timing.sampleSize }, target: 'Timing control', practice: 'Use a steady beat chart and aim for the centre of the hit window.', confidence: timing.confidence });
  if (lanes) {
    const weak = Object.entries(lanes).filter(([, lane]) => lane.sampleAdequate).sort((a, b) => a[1].accuracy - b[1].accuracy)[0];
    if (weak && weak[1].accuracy < 90) recommendations.push({ issue: `Lane ${Number(weak[0]) + 1} underperformed`, evidence: { accuracy: weak[1].accuracy, missRate: weak[1].percentages.miss, sampleSize: weak[1].total }, target: `Lane ${Number(weak[0]) + 1}`, practice: 'Use a short lane-isolation exercise before returning to full charts.', confidence: clamp(weak[1].total / 40) });
  }
  for (const [key, title, target, practice] of [['jack', 'Jack sequences need work', 'Jack control', 'Practise repeated notes with relaxed, even spacing.'], ['stream', 'Stream consistency needs work', 'Stream control', 'Practise sustainable streams and keep timing even through the sequence.'], ['hold', 'Hold-note control needs work', 'Hold timing', 'Practise holding through the tail and releasing near the end.'], ['chord', 'Chord synchronization needs work', 'Chord accuracy', 'Practise two-key chords with both inputs landing together.']]) {
    const skill = skills?.[key];
    if (skill?.status === 'measured' && skill.score < 80) recommendations.push({ issue: title, evidence: { score: skill.score, sampleSize: skill.sampleSize }, target, practice, confidence: skill.confidence });
  }
  return recommendations;
}

function analyzeStability(events) {
  const ordered = [...events].sort((a,b) => a.expectedTimeMs-b.expectedTimeMs), windowSize = 24, windows = [];
  for (let start = 0; start < ordered.length; start += windowSize) {
    const group = ordered.slice(start, start + windowSize); if (group.length < 8) continue;
    const summary = summarizeEvents(group), timing = timingStats(group);
    windows.push({ startTimeMs: group[0].expectedTimeMs, endTimeMs: group.at(-1).expectedTimeMs, sampleSize: group.length, accuracy: summary.accuracy, missRate: summary.percentages.miss, meanHitErrorMs: timing.meanMs, timingStdDevMs: timing.standardDeviationMs });
  }
  const first = windows[0], last = windows.at(-1), timingDriftMs = first && last && Number.isFinite(first.meanHitErrorMs) && Number.isFinite(last.meanHitErrorMs) ? round(last.meanHitErrorMs-first.meanHitErrorMs) : null;
  const accuracyDriftPoints = first && last ? round(last.accuracy-first.accuracy) : null;
  const misses = ordered.map((event,index)=>event.judgement==='miss'?index:-1).filter(index=>index>=0), recovery=[];
  for (const missIndex of misses) {
    const tail = ordered.slice(missIndex+1,missIndex+11); if (!tail.length) continue;
    const recoveredAt = tail.findIndex(event => event.judgement!=='miss' && Number.isFinite(event.hitErrorMs) && Math.abs(event.hitErrorMs)<=30);
    recovery.push({ eventsToRecovery: recoveredAt<0?null:recoveredAt+1, recovered: recoveredAt>=0 });
  }
  const recovered = recovery.filter(item=>item.recovered);
  return { windows, timingDriftMs, accuracyDriftPoints, recovery: { missEvents: misses.length, measuredRecoveries: recovery.length, recoveredCount: recovered.length, recoveryRate: recovery.length?round(recovered.length/recovery.length*100):null, meanEventsToRecovery: recovered.length?round(mean(recovered.map(item=>item.eventsToRecovery))):null, confidence: round(clamp(recovery.length/10)) } };
}

export function analyzePlay(playData = {}) {
  const events = normalizePerformanceEvents(playData.events ?? []), summary = summarizeEvents(events), timing = analyzeTiming(events), lanes = analyzeLanes(events), skills = analyzeSkills(events, playData.chartMetadata ?? {}), sections = analyzeSections(events, playData.sections ?? []), patterns = analyzePatterns(events);
  const split = events.length >= 40 ? Math.floor(events.length / 2) : 0;
  const firstHalf = split ? summarizeEvents(events.slice(0, split)) : null, secondHalf = split ? summarizeEvents(events.slice(split)) : null;
  const deterioration = split && firstHalf.accuracy !== null && secondHalf.accuracy !== null ? round(firstHalf.accuracy - secondHalf.accuracy) : null;
  const consistency = timing.overall.sampleSize >= 12 ? round(clamp(1 - (timing.overall.standardDeviationMs ?? 100) / 110) * 100) : null;
  const stability = analyzeStability(events);
  const rating = calculateRFPerformanceRating({ accuracy: summary.accuracy, timing, maxCombo: playData.maxCombo, maxPossibleCombo: playData.maxPossibleCombo, chartDifficulty: playData.chartMetadata?.difficultyRating ?? playData.chartDifficulty ?? 1, skills, sampleSize: events.length, hasTimingData: timing.overall.sampleSize >= 5 });
  const result = {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION, algorithmVersion: PERFORMANCE_ALGORITHM_VERSION,
    summary: { ...summary, sampleSize: events.length, dataCompleteness: events.length ? round(events.filter(event => event.actualTimeMs !== null).length / events.length) : 0 },
    timing, lanes, skills, sections, patterns, stability,
    consistency: { score: consistency, sampleSize: timing.overall.sampleSize, confidence: round(clamp(timing.overall.sampleSize / 40)) },
    progression: { firstHalfAccuracy: firstHalf?.accuracy ?? null, secondHalfAccuracy: secondHalf?.accuracy ?? null, changePercentagePoints: deterioration === null ? null : -deterioration, accuracyDeteriorationPoints: deterioration, possiblePerformanceDeterioration: deterioration !== null && deterioration >= 5 },
    rating,
    recommendations: [],
    limitations: [...(timing.overall.sampleSize < 5 ? ['Insufficient timing samples for a timing diagnosis.'] : []), ...(sections.available ? [] : ['No section metadata was available for this play.']), ...(Object.keys(patterns).length ? [] : ['No reliable pattern metadata was recorded.'])],
  };
  result.recommendations = generatePracticeRecommendations(result);
  return result;
}

export function updatePlayerSkillProfile(previousProfile, analysis) {
  const previous = previousProfile && typeof previousProfile === 'object' ? previousProfile : { schemaVersion: PERFORMANCE_SCHEMA_VERSION, plays: 0, skills: {} };
  const next = structuredCloneSafe(previous);
  next.schemaVersion = PERFORMANCE_SCHEMA_VERSION;
  next.algorithmVersion = PERFORMANCE_ALGORITHM_VERSION;
  next.plays = Math.max(0, Number(next.plays) || 0) + 1;
  next.updatedAt = Date.now();
  next.lastSummary = { accuracy: analysis?.summary?.accuracy ?? null, consistency: analysis?.consistency?.score ?? null, rating: analysis?.rating?.value ?? null };
  next.skills ||= {};
  for (const [key, skill] of Object.entries(analysis?.skills ?? {})) {
    if (!skill || skill.status !== 'measured') continue;
    const old = next.skills[key], oldSamples = Math.max(0, Number(old?.sampleSize) || 0), weight = Math.max(1, skill.sampleSize || 1);
    next.skills[key] = { score: old ? round((old.score * oldSamples + skill.score * weight) / (oldSamples + weight)) : skill.score, sampleSize: oldSamples + weight, confidence: round(clamp((oldSamples + weight) / 80)), status: 'measured' };
  }
  return next;
}

export function comparePerformances(playA = {}, playB = {}) {
  const a = playA.analysis ?? analyzePlay(playA), b = playB.analysis ?? analyzePlay(playB);
  return { accuracyDelta: Number.isFinite(a.summary.accuracy) && Number.isFinite(b.summary.accuracy) ? round(b.summary.accuracy - a.summary.accuracy) : null, meanTimingDeltaMs: Number.isFinite(a.timing.overall.meanMs) && Number.isFinite(b.timing.overall.meanMs) ? round(b.timing.overall.meanMs - a.timing.overall.meanMs) : null, consistencyDelta: Number.isFinite(a.consistency.score) && Number.isFinite(b.consistency.score) ? round(b.consistency.score - a.consistency.score) : null, sampleSizes: [a.summary.sampleSize, b.summary.sampleSize] };
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/** Read-only history query helper. Records without event data remain valid legacy entries. */
export function getPerformanceHistory(records = [], options = {}) {
  if (!Array.isArray(records)) throw new TypeError('Performance history must be an array.');
  const limit = Math.max(1, Math.min(500, Math.trunc(Number(options.limit) || 100)));
  const from = Number.isFinite(Number(options.from)) ? Number(options.from) : -Infinity;
  const to = Number.isFinite(Number(options.to)) ? Number(options.to) : Infinity;
  const chartId = options.chartId == null ? null : String(options.chartId);
  const difficulty = options.difficulty == null ? null : String(options.difficulty).toLowerCase();
  return records.filter(record => {
    if (!record || typeof record !== 'object') return false;
    const playedAt = Number(record.playedAt ?? record.createdAt ?? record.timestamp ?? 0);
    if (playedAt < from || playedAt > to) return false;
    if (chartId && String(record.chartId ?? record.chart?.id ?? '') !== chartId) return false;
    if (difficulty && String(record.difficulty ?? record.chartMetadata?.difficulty ?? '').toLowerCase() !== difficulty) return false;
    return true;
  }).sort((a, b) => Number(b.playedAt ?? b.createdAt ?? b.timestamp ?? 0) - Number(a.playedAt ?? a.createdAt ?? a.timestamp ?? 0)).slice(0, limit);
}

/**
 * Wrap a legacy result in the current versioned contract without manufacturing events.
 * Old aggregate counts/scores are retained as legacySummary; timing/skill analyses remain unavailable.
 */
export function migrateLegacyPerformanceRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('A legacy performance record must be an object.');
  const rawEvents = Array.isArray(record.events) ? record.events : [];
  const events = normalizePerformanceEvents(rawEvents).map(event => ({ ...event, source: 'legacy' }));
  const alreadyCurrent = Number(record.schemaVersion) === PERFORMANCE_SCHEMA_VERSION;
  return {
    ...record,
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    algorithmVersion: PERFORMANCE_ALGORITHM_VERSION,
    migratedFromSchemaVersion: alreadyCurrent ? (record.migratedFromSchemaVersion ?? null) : (record.schemaVersion ?? 0),
    events,
    analysisAvailable: events.length >= 5,
    dataCompleteness: events.length ? round(events.filter(event => event.hitErrorMs !== null).length / events.length) : 0,
    legacySummary: record.legacySummary ?? record.summary ?? {
      score: Number.isFinite(Number(record.score)) ? Number(record.score) : null,
      accuracy: Number.isFinite(Number(record.accuracy)) ? Number(record.accuracy) : null,
      grade: record.grade ?? null,
      counts: record.counts ?? null,
    },
  };
}
