// Complete a measured figure after selecting the baseline layout. Keep its
// notes and holds intact while testing legal optional presses on both sides.
const DETAIL_POLICY = {
  easy: { chordGap: 320, mateGap: 250 },
  normal: { chordGap: 235, mateGap: 170, cadence: 1.45, confidence: 0.21 },
  hard: { chordGap: 155, mateGap: 135, cadence: 0.85, confidence: 0.15 },
  expert: { chordGap: 105, mateGap: 100, cadence: 0.55, confidence: 0.12 }
};

function arrangementIndex(sequence, time) {
  let left = 0, right = sequence.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if ((sequence[middle].timeMs ?? sequence[middle]) < time) left = middle + 1;
    else right = middle;
  }
  return left;
}

function recurringNeighborhood(event, witnesses, quiet, quietStarts) {
  const t = event.timeMs;
  const begin = arrangementIndex(witnesses, t - 216);
  const end = arrangementIndex(witnesses, t + 216);
  const quietIndex = arrangementIndex(quietStarts, t);
  const leftBoundary = quiet[quietIndex - 1]?.endMs ?? -Infinity;
  const rightBoundary = quiet[quietIndex]?.startMs ?? Infinity;
  for (let i = begin; i < end; i++) {
    const step = Math.abs(witnesses[i].timeMs - t);
    if (step < 70) continue;
    const tolerance = Math.min(10, step * 0.085);
    const find = multiple => {
      const target = t + step * multiple;
      const at = arrangementIndex(witnesses, target - tolerance);
      const found = witnesses[at];
      return found && found.timeMs <= target + tolerance && found.timeMs >= leftBoundary &&
        found.timeMs < rightBoundary ? found : null;
    };
    const left = find(-1), right = find(1);
    if (!left || !right) continue;
    const secondLeft = find(-2), secondRight = find(2);
    if ((secondLeft || secondRight) &&
        (left.band === event.band && right.band === event.band ||
         left.band === right.band && (secondLeft?.band === event.band || secondRight?.band === event.band))) return true;
  }
  return false;
}

function withinPeakLimit(lanes, time) {
  const nearby = lanes.flatMap(notes => notes.slice(
    arrangementIndex(notes, time - 1000), arrangementIndex(notes, time + 1001)
  ).map(n => n.timeMs)).sort((a, b) => a - b);
  let left = 0;
  return !nearby.some((t, i) => {
    while (t - nearby[left] > 1000) left++;
    return i - left + 1 >= 18 && Math.max(t, time) - Math.min(nearby[left], time) <= 1000;
  });
}

export function arrangeV3Technical(notes, timeline, {difficulty, mode, minConfidence = 0.10, densityScale}, profile) {
  const technique = { addedChords: 0, recoveredAttacks: 0, brackets: 0, tonalAttacks: 0, phraseNotes: 0 };
  if (!notes.length || !DETAIL_POLICY[difficulty] || mode === 'relax' || mode === 'beat')
    return { notes, technique };

  const policy = DETAIL_POLICY[difficulty];
  const groups = new Map();
  for (const note of notes) {
    const group = groups.get(note.timeMs);
    if (group) group.push(note);
    else groups.set(note.timeMs, [note]);
  }
  const heads = [...groups.keys()];
  const chords = heads.filter(t => groups.get(t).length > 1);
  const quiet = timeline.quietRanges ?? [];
  const quietStarts = quiet.map(range => range.startMs);
  const credible = timeline.events.filter(e => e.confidence >= Math.max(minConfidence, 0.12));
  const lowerTier = difficulty === 'easy' || difficulty === 'normal';
  const witnessesByHead = new Map(lowerTier ? credible.map(event => [Math.round(event.timeMs), event]) : []);
  const phraseLevels = timeline.phrases.map(() => []);
  for (const event of credible) phraseLevels[event.phraseId].push(event.salience);
  const medians = phraseLevels.map(values => {
    values.sort((a,b) => a-b);
    return values[Math.floor(values.length / 2)];
  });
  const candidates = [];
  for (const event of timeline.events) {
    const { salience, confidence, coattack = 0, period, phraseId } = event;
    const time = Math.round(event.timeMs);
    if (time >= timeline.durationMs) continue;
    const pause = arrangementIndex(quietStarts, time + 1);
    if (time < (quiet[pause - 1]?.endMs ?? -Infinity)) continue;
    const core = groups.get(time);
    const at = arrangementIndex(heads,time);
    const before = time - (heads[at - 1] ?? -Infinity);
    const after = (heads[at + Number(Boolean(core))] ?? Infinity) - time;
    // Leave a quiet lead-in and an exposed tail intact. Require a surrounding
    // charted phrase instead of treating volume alone as a difficulty signal.
    if (Math.min(before,after) > period * 1.35) continue;
    const median = medians[phraseId];
    const samePassage = time - before >= (quiet[pause - 1]?.endMs ?? -Infinity) &&
      time + after < (quiet[pause]?.startMs ?? Infinity);
    const sustained = event.trackedSustain?.state === 'release' ||
      Math.max(event.holdEvidence?.endTimeMs ?? time, event.tonalHoldEvidence?.endTimeMs ?? time) - time >= period * 0.65;
    if (difficulty !== 'easy' && core?.length === 1 && core[0].type === 'tap' && !sustained &&
        phraseLevels[phraseId].length >= 7 && confidence >= Math.max(minConfidence,policy.confidence) &&
        event.bandSpread >= 0.42 && coattack >= 0.20 &&
        salience >= Math.max(0.145, median * (difficulty === 'normal' ? 1.20 : 1.02)) &&
        // Supplement locally clear accents that the old absolute gate
        // misses. Established high-contrast accents are already composed.
        (salience < 0.24 || confidence < 0.22) &&
        before >= policy.mateGap && after >= policy.mateGap) {
      candidates.push({ time, coreLane: core[0].lane, period, score: salience * 1.4 + Math.min(coattack,0.9) * 0.35 });
      continue;
    }
    if (!core && lowerTier && densityScale >= 1 && samePassage &&
        confidence >= Math.max(minConfidence, 0.12) && event.strength >= 0.15) {
      // Complete an evenly spaced figure only when its flanking heads have
      // reliable attacks and the new press leaves this difficulty's gaps.
      const left = witnessesByHead.get(heads[at - 1]), right = witnessesByHead.get(heads[at]);
      const gap = (before + after) / 2;
      const short = difficulty === 'easy' ? 260 : 175;
      if (left && right && Math.min(before, after) >= short && Math.max(before, after) <= 700 &&
          Math.abs(before - after) <= Math.min(24, gap * 0.1) &&
          (left.band === event.band && right.band === event.band ||
           Math.abs(gap - period) < 25 || Math.abs(gap - period / 2) < 16)) {
        candidates.push({ time, period, score: salience, short, phrase: true });
      }
    }
    const short = difficulty === 'expert' ? 53 : 77;
    if (!core && !lowerTier && minConfidence === 0.10 && densityScale === 1 && samePassage &&
        confidence >= 0.025 && confidence < 0.10 && event.strength >= 0.135 &&
        before >= short && after >= short && before <= 230 && after <= 230 &&
        arrangementIndex(heads,time + 500) - arrangementIndex(heads,time - 500) < (difficulty === 'expert' ? 9 : 7) &&
        (event.tonalEntry || recurringNeighborhood(event, credible, quiet, quietStarts))) {
      candidates.push({ time, period, score: salience + (event.tonalEntry ? 0.035 : 0), short, tonal: event.tonalEntry });
    }
  }
  candidates.sort((a,b) => b.score-a.score || a.time-b.time);
  const lanes = [0,1,2,3].map(lane => notes.filter(note => note.lane === lane));
  const added = [];
  let sequence = 0;
  const used = new Set(notes.map(note=>note.id));
  for (const {time, coreLane, period, short, tonal, phrase} of candidates) {
    const isChord = coreLane !== undefined;
    const at = arrangementIndex(heads,time);
    const previousHead = heads[at - 1] ?? -Infinity;
    const followingHead = heads[at + Number(isChord)] ?? Infinity;
    const gap = isChord ? policy.mateGap : short;
    if (time - previousHead < gap || followingHead - time < gap) continue;
    const chordAt = arrangementIndex(chords,time);
    const nearestChord = Math.min(time-(chords[chordAt-1]??-Infinity),(chords[chordAt]??Infinity)-time);
    const cadence = isChord ? Math.max(profile.laneGap*2, period * policy.cadence / densityScale) : profile.laneGap;
    if (nearestChord < cadence) continue;

    const options = [];
    for (const [lane, presses] of lanes.entries()) {
      if (lane === coreLane) continue;
      const i = arrangementIndex(presses,time);
      const previous = presses[i-1], following = presses[i];
      const left = time-(previous?.timeMs??-Infinity), right = (following?.timeMs??Infinity)-time;
      if (Math.min(left,right) < policy.chordGap || time < (previous?.endTimeMs??-Infinity)+45) continue;
      const sameHand = isChord && (lane >> 1) === (coreLane >> 1);
      if (sameHand) {
        // A bracket needs deliberate space on its own hand and an exit to
        // the other hand. Do not turn ongoing single-hand work into a chord.
        const exit = groups.get(followingHead);
        if (difficulty !== 'expert' || time-previousHead < policy.chordGap*1.35 ||
            !exit || exit.some(n => n.lane >> 1 === lane >> 1) || followingHead-time < policy.chordGap) continue;
      } else {
        const mate = lanes[lane^1], k = arrangementIndex(mate,time);
        if (time-(mate[k-1]?.timeMs??-Infinity) < policy.mateGap ||
            (mate[k]?.timeMs??Infinity)-time < policy.mateGap)
          continue;
      }
      options.push({lane,i,sameHand,room:Math.min(left,right)});
    }
    if (!options.length || !withinPeakLimit(lanes,time)) continue;
    options.sort((a,b) => Number(b.sameHand)-Number(a.sameHand) || b.room-a.room || a.lane-b.lane);
    const { lane, i, sameHand } = options[0];
    while (used.has('v3-context-'+sequence)) sequence++;
    const note = { id:'v3-context-'+sequence++, timeMs:time, lane, type:'tap' };
    lanes[lane].splice(i,0,note);
    added.push(note);
    if (isChord) {
      chords.splice(chordAt,0,time);
      technique.addedChords++;
      if (sameHand) technique.brackets++;
    } else {
      heads.splice(at,0,time);
      if (phrase) technique.phraseNotes++;
      else {
        technique.recoveredAttacks++;
        if (tonal) technique.tonalAttacks++;
      }
    }
    if (isChord) groups.get(time).push(note);
    else groups.set(time,[note]);
  }
  return { notes: added.length ? [...notes,...added].sort((a,b)=>a.timeMs-b.timeMs) : notes, technique };
}
