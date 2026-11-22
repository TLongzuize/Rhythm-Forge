import { JUDGEMENT_TIERS } from './core.js';
import { SCORE_V2_JUDGEMENT_VALUES } from './score-v2.js';

// Distribute the requested accuracy over score objects. A missed hold head
// also misses its tail, so plan the two judgements together.
export function planAutoplay(notes, bounds, accuracy, human, random = Math.random) {
  const tiers = JUDGEMENT_TIERS.map(tier => ({
    ...tier, value: SCORE_V2_JUDGEMENT_VALUES[tier.key],
  }));
  const fullValue = tiers[0].value;
  const target = fullValue * accuracy / 100;
  const order = notes.filter(note => note.timeMs >= bounds.start && note.timeMs < bounds.end);
  if (human) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  let remainder = 0;
  const actions = [];
  for (const note of order) {
    const tail = note.type === 'hold' && Number.isFinite(note.endTimeMs) && note.endTimeMs < bounds.end;
    const objects = tail ? 2 : 1;
    const desired = target + remainder / objects;
    const tier = human ? tiers.reduce((best, candidate) =>
      Math.abs(candidate.value - desired) < Math.abs(best.value - desired) ? candidate : best) : tiers[0];
    remainder += (target - tier.value) * objects;
    const miss = tier.key === 'miss';
    let delta = 0;
    if (human && !miss) {
      const previous = tiers[tiers.indexOf(tier) - 1]?.windowMs ?? 0;
      const magnitude = previous + 1 + random() * (tier.windowMs - previous - 2);
      delta = random() < .5 ? -magnitude : magnitude;
      if (note.timeMs + delta < bounds.start || (tail ? note.endTimeMs : note.timeMs) + delta >= bounds.end)
        delta = -delta;
    }
    const headTime = note.timeMs + delta;
    actions.push({ note, time: Math.max(bounds.start, Math.min(bounds.end, headTime)), delta, miss, includesTail: tail });
    if (tail && !miss) {
      const tailTime = note.endTimeMs + delta;
      actions.push({ note, time: Math.max(bounds.start, Math.min(bounds.end, tailTime)), delta, tail: true });
    }
  }
  return actions.sort((a, b) => a.time - b.time || Number(!!a.tail) - Number(!!b.tail));
}

// Keep recorded judgement order when several notes are processed in one frame.
export function planReplay(notes, events, bounds) {
  const byId = new Map(notes.map(note => [note.id, note]));
  const actions = [];
  let time = bounds.start;
  for (const event of events) {
    const note = byId.get(event.noteId);
    if (!note) continue;
    const tail = event.noteType === 'hold-tail';
    const expected = tail ? note.endTimeMs : note.timeMs;
    const actual = event.actualTimeMs;
    const timestamp = actual ?? event.eventTimestampMs ?? expected;
    time = Math.min(bounds.end, Math.max(time, timestamp));
    actions.push({
      note, tail, time, judgement: event.judgement,
      delta: event.hitErrorMs ?? (actual == null ? 0 : actual - expected),
      miss: event.judgement === 'miss' && actual == null,
      includesTail: false,
    });
  }
  return actions;
}
