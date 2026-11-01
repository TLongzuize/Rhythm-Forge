// Beat Grid Engine — lưới beat/subdivision dựa trên tempo map (liên tục qua đổi tempo).
import { getBeatPosition, getBeatTime, getLocalBeatPeriod, getTempoAt } from './tempomap.js';
export const SUBDIVISIONS = { quarter: 1, eighth: 2, triplet: 3, sixteenth: 4, thirtysecond: 8 };
const accentOf = (sub, idx, beat, beatsPerBar) => (idx !== 0 ? (sub === 2 ? .5 : sub === 3 ? .4 : .26) : beat % beatsPerBar === 0 ? 1 : beat % 2 === 0 ? .8 : .65);

// Danh sách ô lưới trong [fromMs,toMs]. subdivision: số phần mỗi beat (1,2,3,4,8 hoặc tùy ý); swing 0..1 trễ ô lẻ của 8th.
export function buildBeatGrid(map, fromMs, toMs, { subdivision = 4, beatsPerBar = 4, swing = 0 } = {}) {
  const out = [], b0 = Math.floor(getBeatPosition(map, fromMs)), b1 = Math.ceil(getBeatPosition(map, toMs));
  for (let b = b0; b <= b1; b++) for (let i = 0; i < subdivision; i++) {
    let frac = i / subdivision; if (swing && subdivision === 2 && i === 1) frac = .5 + swing / 6;
    const time = getBeatTime(map, b + frac); if (time < fromMs || time > toMs) continue;
    const seg = getTempoAt(map, time);
    out.push({ time, beatIndex: b, measureIndex: Math.floor(b / beatsPerBar), subdivisionIndex: i, subdivision, accent: accentOf(subdivision, i, b, beatsPerBar), confidence: seg.confidence, segmentStart: seg.startTime });
  }
  return out;
}
// Quantize thích ứng: chỉ snap khi lệch ≤ tolerance × (chu kỳ ô lưới); ngược lại giữ nguyên (bảo toàn syncopation).
export function quantize(map, t, { subdivision = 4, tolerance = .3 } = {}) {
  const pos = getBeatPosition(map, t) * subdivision, k = Math.round(pos), snapped = getBeatTime(map, k / subdivision), cell = getLocalBeatPeriod(map, t) / subdivision, err = t - snapped;
  return Math.abs(err) <= tolerance * cell ? { time: snapped, errorMs: err, snapped: true } : { time: t, errorMs: err, snapped: false };
}
// Mức nhịp của một thời điểm: subdivision thô nhất mà sai số tuyệt đối ≤ tolMs (1=beat, 2=8th, 4=16th, 8=32nd, 0=lệch lưới).
export function rhythmicLevel(map, t, tolMs = 20) {
  for (const s of [1, 2, 4, 8]) { const q = quantize(map, t, { subdivision: s, tolerance: 1 }); if (Math.abs(q.errorMs) <= tolMs) return s; }
  return 0;
}
