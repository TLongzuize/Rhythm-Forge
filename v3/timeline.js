import { detectAttacks, trackTempo } from './timing.js';
import { timingBreadth } from './effort.js';
import { addSustainEvidence } from './sustain.js';

// Decode the best local pulse sequence with a soft tempo-change penalty.
// A clear tempo transition can outweigh continuity. No attack gets moved.
function choosePulses(segments, breadth) {
  const paths = [];
  for (const segment of segments) {
    const options = segment.hypotheses.slice(0, breadth);
    if (!options.length) options.push({ bpm: segment.bpm, phaseMs: segment.phaseMs, score: 0 });
    const previous = paths.at(-1);
    paths.push(
      options.map((h) => {
        let score = 0,
          parent = 0;
        if (previous) {
          score = -Infinity;
          previous.forEach((p, i) => {
            const cost = Math.min(0.32, 0.4 * Math.abs(Math.log2(h.bpm / p.bpm)));
            if (p.score - cost > score) {
              score = p.score - cost;
              parent = i;
            }
          });
        }
        return { ...h, score: score + h.score, parent };
      })
    );
  }
  const last = paths.at(-1);
  let at = last.indexOf(last.reduce((a, b) => (a.score >= b.score ? a : b)));
  const selected = new Array(segments.length);
  for (let i = segments.length - 1; i >= 0; i--) {
    const choice = paths[i][at];
    selected[i] = { ...segments[i], bpm: choice.bpm, phaseMs: choice.phaseMs };
    at = choice.parent;
  }
  return selected;
}

function estimateDownbeat(events, segments, originBeat) {
  const accents = [0, 0, 0, 0],
    counts = [0, 0, 0, 0];
  let index = 0;
  for (const e of events) {
    while (index + 1 < segments.length && segments[index + 1].startTime <= e.timeMs) index++;
    const s = segments[index],
      period = 60000 / s.bpm;
    const pos = (e.timeMs - s.phaseMs) / period;
    if (Math.abs(pos - Math.round(pos)) * period > 35) continue;
    const slot = ((Math.round(s.startBeat + (e.timeMs - s.startTime) / period - originBeat) % 4) + 4) % 4;
    accents[slot] += e.strength * (e.band === 0 ? 1.2 : 1);
    counts[slot]++;
  }
  const means = accents.map((sum, i) => (counts[i] >= 2 ? sum / counts[i] : 0));
  const ordered = [...means].sort((a, b) => b - a);
  const confidence = ordered[0] ? (ordered[0] - ordered[1]) / ordered[0] : 0;
  return { beatClass: confidence > 0.08 ? means.indexOf(ordered[0]) : 0, confidence };
}

// All structure labels are estimates. Keep the measured attack time immutable
// when interpreting a different pulse, including manual grid overrides.
export function interpretTimeline(analysis, { bpmOverride, offsetOverrideMs, effort } = {}) {
  const { events, durationMs, tempoMap } = analysis;
  const segments = choosePulses(tempoMap.segments, timingBreadth(effort));
  const manualBpm = Number.isFinite(bpmOverride) && bpmOverride >= 30 && bpmOverride <= 300;
  const manualPhase = Number.isFinite(offsetOverrideMs) && Math.abs(offsetOverrideMs) <= durationMs;
  const origin = manualPhase ? offsetOverrideMs : segments[0].phaseMs;
  const originBeat = (origin * (manualBpm ? bpmOverride : segments[0].bpm)) / 60000;
  let beat = 0;
  for (const s of segments) {
    if (manualBpm) s.bpm = bpmOverride;
    const period = 60000 / s.bpm;
    if (manualBpm || manualPhase) s.phaseMs = s.startTime + (originBeat - beat) * period;
    s.startBeat = beat;
    beat += (s.endTime - s.startTime) / period;
  }
  const phrases = [];
  const timeline = [];
  let segIndex = 0;
  const downbeat = estimateDownbeat(events, segments, originBeat);
  const phraseOrigin = originBeat + (manualPhase ? 0 : downbeat.beatClass);
  const count = Math.max(1, Math.ceil((beat - Math.min(phraseOrigin, 0)) / 8) + 1);
  let phraseSegment = 0;
  for (let i = 0; i < count; i++) {
    const startBeat = phraseOrigin + i * 8;
    while (phraseSegment + 1 < segments.length && segments[phraseSegment + 1].startBeat <= startBeat)
      phraseSegment++;
    const s = segments[phraseSegment];
    const startMs =
      i === 0
        ? 0
        : Math.min(durationMs, Math.max(0, s.startTime + ((startBeat - s.startBeat) * 60000) / s.bpm));
    if (i && startMs >= durationMs) break;
    phrases.push({ id: i, startMs, mask: 0, eventCount: 0, intensity: 0 });
  }
  for (const event of events) {
    while (segIndex + 1 < segments.length && event.timeMs >= segments[segIndex + 1].startTime) segIndex++;
    const seg = segments[segIndex],
      period = 60000 / seg.bpm;
    const pos = (event.timeMs - seg.phaseMs) / period;
    const phaseError = Math.abs(pos - Math.round(pos)) * period;
    const pulse = Math.exp(-0.5 * (phaseError / 30) ** 2) * (manualBpm || manualPhase ? 1 : seg.confidence);
    const phraseBeat = Math.max(0, seg.startBeat + (event.timeMs - seg.startTime) / period - phraseOrigin);
    const phrase = phrases[Math.min(phrases.length - 1, Math.floor(phraseBeat / 8))];
    const slot = Math.round(phraseBeat * 2) % 16;
    phrase.mask |= 1 << slot;
    phrase.eventCount++;
    phrase.intensity += event.strength;
    timeline.push({
      ...event,
      phraseId: phrase.id,
      slot,
      pulse,
      period,
      salience: 0.57 * event.strength + 0.23 * event.confidence + 0.2 * pulse
    });
  }
  const sections = [];
  let previousIntensity = 0;
  const prototypes = [];
  for (const p of phrases) {
    p.intensity /= 8;
    const delta = p.intensity - previousIntensity;
    if (!sections.length || Math.abs(delta) > 0.32 || (!p.eventCount && previousIntensity > 0)) {
      sections.push({
        id: sections.length,
        firstPhrase: p.id,
        startMs: p.startMs,
        texture: !p.eventCount ? 'pause' : delta > 0.32 ? 'rising' : delta < -0.32 ? 'thinning' : 'steady'
      });
    }
    p.sectionId = sections.length - 1;
    // Permit two changed eighth-note positions in an otherwise recurring cell.
    let motif = prototypes.find((mask) => {
      let bits = mask ^ p.mask;
      bits &= bits - 1;
      return (bits & (bits - 1)) === 0;
    });
    if (motif === undefined) {
      motif = p.mask;
      if (prototypes.length < 64) prototypes.push(motif);
    }
    p.motif = motif;
    previousIntensity = p.intensity;
  }
  sections.forEach((s, i) => {
    s.endMs = sections[i + 1]?.startMs ?? durationMs;
  });
  segIndex = 0;
  const interpretAdditional = attacks => {
    segIndex = 0;
    return (attacks ?? []).map(event => {
    while (segments[segIndex + 1]?.startTime <= event.timeMs) segIndex++;
    const s = segments[segIndex], period = 60000 / s.bpm;
    const phraseBeat = Math.max(0, s.startBeat + (event.timeMs - s.startTime) / period - phraseOrigin);
    const fraction = (event.timeMs - s.phaseMs) / period;
    const error = (fraction - Math.round(fraction)) * period;
    const subdivisionError = Math.min(...[3, 4].map(division =>
      Math.abs(fraction * division - Math.round(fraction * division)) * period / division));
    const pulse = Math.exp(-0.5 * (error / 30) ** 2) * (manualBpm || manualPhase ? 1 : s.confidence);
    return { ...event, period, pulse, subdivisionError, slot: Math.round(phraseBeat * 2) % 16,
      phraseId: Math.min(phrases.length - 1, Math.floor(phraseBeat / 8)),
      salience: 0.57 * event.strength + 0.23 * event.confidence + 0.2 * pulse };
    });
  };
  const spectralAttacks = interpretAdditional(analysis.spectralAttacks);
  return {
    envelopes:interpretAdditional(analysis.envelopes),
    events: timeline,
    spectralAttacks,
    phrases,
    sections,
    durationMs,
    quietRanges: analysis.quietRanges,
    downbeat,
    tempoMap: {
      ...tempoMap,
      firstBeatMs: origin,
      globalBpm: segments.reduce((a, b) => (a.confidence >= b.confidence ? a : b)).bpm,
      segments
    }
  };
}

// Estimate how long this attack lifts its own band above the sound already
// present before it. A later same-band hit may terminate the search, but is
// insufficient evidence of a release by itself.
function measureHold(event, energy, hopMs, nextAttack, durationMs) {
  const bandEnergy = frame => energy[3 * frame + event.band];
  const start = Math.floor(event.timeMs / hopMs);
  const first = Math.max(0, start - Math.ceil(80 / hopMs));
  const last = Math.max(first, start - 2);
  let background = 0;
  for (let i = first; i < last; i++) background += bandEnergy(i);
  background /= Math.max(1, last - first);
  const peak = bandEnergy(event.frame);
  const floor = Math.max(0.004, background * 1.45 + 0.0015, peak * 0.42);
  const limit = Math.min(Math.floor(energy.length / 3),
    Math.ceil(event.sustainEndMs / hopMs) + 5, Math.floor(nextAttack / hopMs));
  const startFrame = event.frame;
  let below = 0, sum = 0;
  for (let i = startFrame; i < limit; i++) {
    const level = bandEnergy(i);
    if (level >= floor) {
      below = 0;
      sum += Math.min(1, Math.max(0, (level - background) / Math.max(0.004, peak - background)));
    } else if (++below === 4) {
      const endFrame = i - below + 1;
      const endTimeMs = endFrame * hopMs;
      if (endTimeMs - event.timeMs < 220) return undefined;
      return { endTimeMs, continuity: sum / (endFrame - startFrame) };
    }
  }
  // A tone sustained through the end of the recording has a real stop even
  // when the file cuts off before its envelope decays.
  if (limit === Math.floor(energy.length / 3) && limit * hopMs - event.timeMs >= 220 && below === 0)
    return { endTimeMs: durationMs, continuity: sum / (limit - startFrame) };
  const continuity = sum / (limit - startFrame);
  if (limit === Math.floor(nextAttack / hopMs) && nextAttack - event.timeMs >= 260 &&
      below === 0 && continuity >= 0.60 && event.confidence >= 0.25)
    return { endTimeMs: nextAttack, continuity, retrigger: true };
  return undefined;
}

export function analyzeV3(samples, sampleRate, onProgress = () => {}, rawTrace) {
  const { events, energy, hopMs, durationMs } = detectAttacks(samples, sampleRate, fraction => onProgress(fraction * 0.5), rawTrace);
  const nextAttack = [Infinity, Infinity, Infinity];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i],
      k = e.band;
    const limit = Math.min(
      Math.floor(energy.length / 3),
      e.frame + Math.ceil(1800 / hopMs),
      Math.floor(nextAttack[k] / hopMs)
    );
    let peak = energy[e.frame * 3 + k],
      last = e.frame,
      below = 0;
    for (let j = e.frame + 1; j < limit; j++) {
      const level = energy[j * 3 + k];
      peak = Math.max(level, peak);
      if (level >= Math.max(0.004, peak * 0.36)) {
        last = j;
        below = 0;
      } else if (++below >= 3) break;
    }
    e.sustainEndMs = Math.min(durationMs, (last + 1) * hopMs);
    if (e.sustainEndMs - e.timeMs >= 215) {
      const evidence = measureHold(e, energy, hopMs, nextAttack[k], durationMs);
      if (evidence) e.holdEvidence = evidence;
    }
    delete e.frame;
    nextAttack[k] = e.timeMs;
  }
  const quietRanges = [];
  let quietStart = null;
  for (let f = 0; f <= energy.length / 3; f++) {
    const base = f * 3;
    const quiet = base < energy.length && Math.max(energy[base], energy[base + 1], energy[base + 2]) < 0.0005;
    if (quiet && quietStart === null) quietStart = f * hopMs;
    if (!quiet && quietStart !== null) {
      const endMs = Math.min(durationMs, f * hopMs);
      if (endMs - quietStart >= 100) quietRanges.push({ startMs: quietStart, endMs });
      quietStart = null;
    }
  }
  const { additional:spectralAttacks, envelopes } = addSustainEvidence(samples, sampleRate, events, durationMs,
    fraction => onProgress(0.5 + 0.49 * fraction), { energy, hopMs, rawTrace });
  const tempoMap = trackTempo(events, durationMs);
  onProgress(1);
  return { events, spectralAttacks, envelopes, durationMs, quietRanges, tempoMap };
}
