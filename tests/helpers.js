// Âm thanh tổng hợp có ground truth: click theo beat liên tục qua các đoạn tempo.
export function synthClicks({ segments, sr = 22050, startMs = 0, gain = 1, noise = 0, accentEvery = 0, eighths = false, seed = 7 }) {
  // segments: [{bpm, ms}] nối tiếp, beat liên tục; beat đầu tiên ở startMs.
  const total = startMs + segments.reduce((a, s) => a + s.ms, 0), x = new Float32Array(Math.ceil(total / 1000 * sr)), truth = [];
  let r = seed; const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296 - .5) * 2;
  let t = startMs, end = startMs;
  for (const seg of segments) { end += seg.ms; const p = 60000 / seg.bpm; while (t < end) { truth.push(t); click(x, sr, t, gain * (accentEvery && truth.length % accentEvery ? .6 : 1)); if (eighths) click(x, sr, t + p / 2, gain * .5); t += p; } }
  if (noise) for (let i = 0; i < x.length; i++) x[i] += rnd() * noise;
  return { samples: x, sr, truth, durationMs: total };
}
function click(x, sr, tMs, g) { const i0 = Math.round(tMs / 1000 * sr), n = Math.round(.03 * sr); for (let i = 0; i < n && i0 + i < x.length; i++) x[i0 + i] += g * Math.sin(2 * Math.PI * 1000 * i / sr) * Math.exp(-i / (.006 * sr)); }
// Tempo đổi dần tuyến tính: chu kỳ beat nội suy theo thời gian từ bpm0 → bpm1 trong ms; truth = thời điểm beat thật.
export function synthRamp({ bpm0, bpm1, ms, sr = 22050, startMs = 100, lead = 0, tail = 0 }) {
  const total = startMs + lead + ms + tail, x = new Float32Array(Math.ceil(total / 1000 * sr)), truth = []; let t = startMs;
  const bpmAt = u => u <= startMs + lead ? bpm0 : u >= startMs + lead + ms ? bpm1 : bpm0 + (bpm1 - bpm0) * (u - startMs - lead) / ms;
  while (t < total - 100) { truth.push(t); click(x, sr, t, 1); t += 60000 / bpmAt(t); }
  return { samples: x, sr, truth, durationMs: total };
}
