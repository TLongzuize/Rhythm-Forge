// Tempo Map Engine — phân đoạn tempo từ audio thật, beat position liên tục (không reset phase).
// Dữ liệu là tùy chọn (chart cũ không cần), có thể serialize JSON.
import { inferTempo, clamp } from './core.js';
export const TEMPO_MAP_VERSION = 1;
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const hopOf = f => (f.length > 1 ? f[1].timeMs - f[0].timeMs : 10) || 10;

function peaksOf(f, t0, t1) {
  const hop = hopOf(f), a = Math.max(1, Math.floor(t0 / hop)), b = Math.min(f.length - 1, Math.ceil(t1 / hop)); let mx = 0;
  for (let i = a; i < b; i++) mx = Math.max(mx, f[i].onset || 0);
  const out = [];
  for (let i = a; i < b; i++) { const o = f[i].onset || 0; if (o > mx * .35 && o >= f[i - 1].onset && o > f[i + 1].onset) out.push(f[i].timeMs); }
  return out;
}
// Hồi quy t = a + k·p trên các peak gần lưới (a0,p0). Trả {a,p,n}.
function fit(peaks, a0, p0, tol = .18) {
  const pts = []; for (const t of peaks) { const k = Math.round((t - a0) / p0); if (Math.abs(t - a0 - k * p0) < tol * p0) pts.push([k, t]); }
  const ks = new Set(pts.map(x => x[0])); if (ks.size < 4) return { a: a0, p: p0, n: ks.size };
  const n = pts.length, sk = pts.reduce((s, x) => s + x[0], 0), st = pts.reduce((s, x) => s + x[1], 0), skk = pts.reduce((s, x) => s + x[0] * x[0], 0), skt = pts.reduce((s, x) => s + x[0] * x[1], 0), den = n * skk - sk * sk;
  if (!den) return { a: a0, p: p0, n: ks.size };
  const p = (n * skt - sk * st) / den; return { a: (st - p * sk) / n, p, n: ks.size };
}
function localTempo(f, t0, t1, hint, hintOffsetMs, hintConfidence = 0) {
  const hop = hopOf(f), i0 = Math.max(0, Math.floor(t0 / hop)), i1 = Math.min(f.length, Math.ceil(t1 / hop));
  const tp = inferTempo(f.slice(i0, i1).map((x, i) => ({ timeMs: i * hop, onset: x.onset })), t1 - t0, hop);
  const pk = peaksOf(f, t0, t1);
  // Chọn octave: lưới giải thích được nhiều peak (explained) VÀ mỗi beat của lưới đều có peak (support).
  const grid = (bpm, phaseHintMs) => { const p0 = 60000 / bpm; let a0 = t0 + tp.offsetMs; if (Number.isFinite(phaseHintMs)) a0 = phaseHintMs + Math.round((t0 - phaseHintMs) / p0) * p0; const ft = fit(pk, a0, p0), hit = pk.filter(t => { const k = Math.round((t - ft.a) / ft.p); return Math.abs(t - ft.a - k * ft.p) < .18 * ft.p; }).length; return { ft, score: (hit / Math.max(1, pk.length)) * clamp(ft.n / Math.max(1, (t1 - t0) / ft.p)) }; };
  let best = grid(tp.bpm); for (const r of [2, .5]) { const b = tp.bpm * r; if (b < 60 || b > 200) continue; const g = grid(b); if (g.score > best.score * 1.15) best = g; }
  // Ưu tiên khoảng tempo phổ biến: nếu kết quả <80 BPM mà gấp đôi (≤170) giải thích gần ngang thì chọn gấp đôi (nhạc 130 BPM hay bị đọc 65).
  { const cur = 60000 / best.ft.p; if (cur < 80 && cur * 2 <= 170) { const g = grid(cur * 2); if (g.score >= .85 * best.score) best = g; } }
  // Gợi ý tempo chủ đạo của cả bài (chỉ dùng ở lượt 2 cho cửa sổ lệch theo tỉ lệ liên quan như 2:3 của mẫu syncopated).
  // Global BPM + phase are a weak metrical prior. Apply only to octave/triplet-family
  // aliases; do not flatten genuine local tempo changes (e.g. 120→140 BPM).
  if (hint && hintConfidence >= .4) { const ratio = (60000 / best.ft.p) / hint, alias = [2, .5, 3 / 2, 2 / 3].some(q => Math.abs(ratio / q - 1) < .045); if (alias) { const g = grid(hint, hintOffsetMs); if (g.score >= .55 * best.score) best = g; } }
  const ft = best.ft, p0 = ft.p, expected = Math.max(1, (t1 - t0) / ft.p);
  const matched = clamp(ft.n / expected), conf = clamp(matched * .6 + tp.confidence * .4);
  return { t0, t1, bpm: 60000 / ft.p, conf: pk.length < 4 ? 0 : conf, phase: ft.a };
}

export function buildTempoMapBase(analysis, { windowMs = 8000, minSegmentMs = 8000, changeRatio = .025, minConfidence = .25 } = {}) {
  const f = analysis.features || [], dur = analysis.durationMs || 0;
  if (f.length < 20 || dur < 2000) return fallbackMap(analysis);
  const W = Math.min(windowMs, dur), wins = [];
  for (let t = 0; t + W <= dur + 1; t += W / 2) wins.push(localTempo(f, t, Math.min(dur, t + W), analysis.bpm, analysis.beatOffsetMs, analysis.bpmConfidence ?? 0));
  const valid = wins.filter(w => w.conf >= minConfidence); if (!valid.length) return fallbackMap(analysis);
  while (valid.length > 3 && valid[0].conf < .35 && Math.abs(valid[1].bpm / valid[2].bpm - 1) < .03 && Math.abs(valid[0].bpm / valid[1].bpm - 1) > .03) valid.shift(); // cửa sổ mở đầu yếu, lệch tempo: bỏ để không tạo đoạn giả
  // Lượt 2: tempo chủ đạo (histogram 1 BPM theo confidence). Cửa sổ lệch D theo tỉ lệ 2/3, 3/2, 1/2, 2 (khóa nhầm subdivision) được tính lại với gợi ý D;
  // đổi tempo thật (tỉ lệ khác) giữ nguyên.
  { const bins = new Map(); for (const w of valid) { const k = Math.round(w.bpm); bins.set(k, (bins.get(k) || 0) + w.conf); } let D = 0, bw = 0; for (const [k, v] of bins) { const s = v + (bins.get(k - 1) || 0) * .5 + (bins.get(k + 1) || 0) * .5; if (s > bw) { bw = s; D = k; } }
    if (D) for (const w of valid) { const r = w.bpm / D; if (Math.abs(r - 1) > .03 && [2 / 3, 3 / 2, .5, 2].some(q => Math.abs(r / q - 1) < .04)) { const n = localTempo(f, w.t0, w.t1, D, analysis.beatOffsetMs, analysis.bpmConfidence ?? 0); if (Math.abs(n.bpm / D - 1) <= .03) Object.assign(w, n); } } }
  let ref = valid[0].bpm; for (const w of valid) { for (const r of [.5, 2]) if (Math.abs(w.bpm * r - ref) / ref < changeRatio * 1.5) w.bpm *= r; ref = w.bpm; } // gập octave theo cửa sổ trước
  // gom cụm: đổi tempo phải kéo dài ≥ 2 cửa sổ mới tính
  const groups = []; let cur = [valid[0]], pend = [];
  for (const w of valid.slice(1)) {
    const m = med(cur.map(x => x.bpm));
    if (Math.abs(w.bpm - m) / m <= changeRatio) { cur.push(...pend, w); pend = []; }
    else { pend.push(w); const pm = med(pend.map(x => x.bpm)); if (pend.length >= 2 && pend.every(x => Math.abs(x.bpm - pm) / pm <= changeRatio)) { groups.push(cur); cur = pend; pend = []; } else if (pend.length > 2) { cur.push(...pend); pend = []; } }
  }
  cur.push(...pend); groups.push(cur);
  const merged = []; for (const g of groups) { const last = merged[merged.length - 1], bpm = med(g.map(x => x.bpm)); if (last && Math.abs(last.bpm - bpm) / bpm <= changeRatio * .8) last.ws.push(...g), last.bpm = med(last.ws.map(x => x.bpm)); else merged.push({ ws: g, bpm }); }
  // ranh giới: tối ưu thời điểm đổi tempo theo phần dư của peak (mô hình liên tục)
  const peaks = peaksOf(f, 0, dur), segs = merged.map((g, i) => ({ start: i ? 0 : 0, bpm: g.bpm, conf: clamp(g.ws.reduce((s, x) => s + x.conf, 0) / g.ws.length), t0: g.ws[0].t0, t1: g.ws[g.ws.length - 1].t1, phase: g.ws[0].phase }));
  const first = fit(peaks.filter(t => t >= segs[0].t0 && t < segs[0].t1), segs[0].phase, 60000 / segs[0].bpm);
  let anchor = first.a, p = first.p; segs[0].p = p; segs[0].start = 0;
  for (let i = 1; i < segs.length; i++) {
    const pB = 60000 / segs[i].bpm, lo = segs[i].t0 - W / 2, hi = Math.min(segs[i].t0 + W / 2, dur); let best = null;
    for (let tb = Math.max(segs[i - 1].start + minSegmentMs, lo); tb <= hi; tb += 50) {
      const bA = (tb - anchor) / p; let cost = 0, n = 0;
      for (const t of peaks) { if (t < tb - 4000 || t > tb + 4000) continue; const b = t < tb ? (t - anchor) / p : bA + (t - tb) / pB, r = Math.abs(b - Math.round(b)); cost += Math.min(r, .3); n++; }
      if (n && (!best || cost / n < best.c)) best = { tb, c: cost / n };
    }
    segs[i].start = best ? best.tb : segs[i].t0; segs[i].p = pB;
    // đồng bộ phase: beat tại ranh giới liên tục; refit chu kỳ (chỉ độ dốc) cho đoạn trước
    segs[i - 1].p = p; anchor = anchor + Math.ceil((segs[i].start - anchor) / p) * p; p = pB;
  }
  return assemble(segs, dur, peaks, first.a, analysis);
}

function assemble(segs, dur, peaks, firstBeatMs, analysis) {
  // refit chu kỳ từng đoạn theo anchor liên tục, rồi dựng startBeat tích lũy
  const out = []; let anchorT = firstBeatMs, startBeat = -firstBeatMs / segs[0].p, prevP = segs[0].p;
  segs.forEach((s, i) => {
    const end = i + 1 < segs.length ? segs[i + 1].start : dur, tStart = s.start;
    const beatAtStart = i ? out[i - 1].startBeat + (tStart - out[i - 1].startTime) / out[i - 1].beatPeriod : startBeat;
    const inSeg = peaks.filter(t => t >= tStart && t < end), tA = anchorFor(beatAtStart, tStart, s.p);
    let p = s.p; const pts = []; for (const t of inSeg) { const k = Math.round((t - tA) / p); const r = t - tA - k * p; if (Math.abs(r) < .18 * p && k > 0) pts.push([k, r]); }
    if (pts.length >= 6) { const d = pts.reduce((a, x) => a + x[0] * x[1], 0) / pts.reduce((a, x) => a + x[0] * x[0], 0); p = clamp(p + d, p * .98, p * 1.02); }
    out.push({ startTime: Math.round(tStart), endTime: Math.round(end), bpm: +(60000 / p).toFixed(3), beatPeriod: p, startBeat: beatAtStart, beatPhase: ((beatAtStart % 1) + 1) % 1, confidence: s.conf ?? 0, source: 'analysis', manualOverride: false });
  });
  return { version: TEMPO_MAP_VERSION, firstBeatMs, durationMs: dur, segments: out };
}
const anchorFor = (beat, t, p) => t - beat * p; // thời điểm của beat 0 theo đoạn hiện tại

function fallbackMap(analysis) {
  const bpm = analysis.bpm || 120, p = 60000 / bpm, off = analysis.beatOffsetMs || 0, d = analysis.durationMs || 0;
  return { version: TEMPO_MAP_VERSION, firstBeatMs: off, durationMs: d, segments: [{ startTime: 0, endTime: d, bpm, beatPeriod: p, startBeat: -off / p, beatPhase: ((-off / p % 1) + 1) % 1, confidence: analysis.bpmConfidence ?? 0, source: 'global-bpm', manualOverride: false }] };
}

/* ---------- API truy vấn ---------- */
const segIdx = (m, t) => { const s = m.segments; for (let i = s.length - 1; i > 0; i--) if (t >= s[i].startTime) return i; return 0; };
export const getTempoAt = (m, t) => m.segments[segIdx(m, t)];
export const getLocalBeatPeriod = (m, t) => getTempoAt(m, t).beatPeriod;
export const getBeatPosition = (m, t) => { const s = getTempoAt(m, t); return s.startBeat + (t - s.startTime) / s.beatPeriod; };
export function getBeatTime(m, beat) { const s = m.segments; let i = 0; for (let j = s.length - 1; j > 0; j--) if (beat >= s[j].startBeat) { i = j; break; } return s[i].startTime + (beat - s[i].startBeat) * s[i].beatPeriod; }
export function getNearestBeat(m, t) { const beat = Math.round(getBeatPosition(m, t)), time = getBeatTime(m, beat); return { beat, time, errorMs: t - time }; }
export const getSubdivisionTime = (m, beat, sub = 4, index = 0) => getBeatTime(m, beat + index / sub);

/* ---------- Chỉnh tay (giữ liên tục beat tại điểm đổi) ---------- */
const rebuild = m => { const s = m.segments; for (let i = 1; i < s.length; i++) { s[i].startBeat = s[i - 1].startBeat + (s[i].startTime - s[i - 1].startTime) / s[i - 1].beatPeriod; s[i].beatPhase = ((s[i].startBeat % 1) + 1) % 1; } s.forEach((x, i) => { x.endTime = i + 1 < s.length ? s[i + 1].startTime : m.durationMs; }); return m; };
const clone = m => JSON.parse(JSON.stringify(m));
export function setSegmentBpm(m, i, bpm) { const c = clone(m), s = c.segments[i]; s.bpm = bpm; s.beatPeriod = 60000 / bpm; s.manualOverride = true; s.source = 'manual'; return rebuild(c); }
export function splitSegment(m, t) { const c = clone(m), i = segIdx(c, t), s = c.segments[i]; if (t - s.startTime < 1000 || s.endTime - t < 1000) return c; c.segments.splice(i + 1, 0, { ...s, startTime: Math.round(t), startBeat: s.startBeat + (t - s.startTime) / s.beatPeriod, manualOverride: true, source: 'manual' }); return rebuild(c); }
export function mergeSegments(m, i) { const c = clone(m); if (i + 1 >= c.segments.length) return c; c.segments.splice(i + 1, 1); return rebuild(c); }

// Phát hiện tempo đổi dần: ≥3 đoạn có BPM đơn điệu (đảo chiều ≤1.5%) và tổng thay đổi ≥6% → dựng lại với cửa sổ mịn hơn (4s)
// và đánh dấu gradual (xấp xỉ bậc thang; KHÔNG phải nội suy tuyến tính liên tục — xem tài liệu).
const monotone = segs => { if (segs.length < 3) return 0; let up = 0, dn = 0; for (let i = 1; i < segs.length; i++) { const r = segs[i].bpm / segs[i - 1].bpm; if (r > 1.015) up++; else if (r < .985) dn++; else if (Math.abs(r - 1) > .015) return 0; } const tot = segs[segs.length - 1].bpm / segs[0].bpm; return (up && !dn && tot > 1.06) ? 1 : (dn && !up && tot < .94) ? -1 : 0; };
// Bằng chứng nhịp: onset được chuẩn hóa (max=1) nên phải đếm số đỉnh mạnh thật. Nhạc ambient/nhiễu/im lặng có <6 đỉnh >0.3 mỗi phút.
export function rhythmicEvidence(analysis) {
  const f = analysis.features || [], dur = (analysis.durationMs || 0) / 60000, strong = f.filter(x => (x.onset || 0) > .3).length, perMin = dur > 0 ? strong / dur : 0;
  return { strongPerMin: +perMin.toFixed(1), hasRhythm: perMin >= 6 && f.length > 20 };
}
export function buildTempoMap(analysis, opts) {
  const m = buildTempoMapCore(analysis, opts), ev = rhythmicEvidence(analysis); if (ev.hasRhythm) return m;
  return { ...m, lowConfidence: true, evidence: ev, segments: m.segments.map(s => ({ ...s, confidence: Math.min(s.confidence ?? 0, .1), lowConfidence: true })) };
}
function buildTempoMapCore(analysis, opts) {
  const base = buildTempoMapBase(analysis, opts); if (opts && Object.keys(opts).length) return base;
  const dir = monotone(base.segments); if (!dir) return base;
  const fine = buildTempoMapBase(analysis, { windowMs: 4000, minSegmentMs: 4000 }), d2 = monotone(fine.segments);
  if (d2 !== dir) return base;
  return { ...fine, gradual: { direction: dir > 0 ? 'accelerando' : 'ritardando', fromBpm: fine.segments[0].bpm, toBpm: fine.segments[fine.segments.length - 1].bpm, approximation: 'stepwise' }, segments: fine.segments.map(s => ({ ...s, gradual: true })) };
}
