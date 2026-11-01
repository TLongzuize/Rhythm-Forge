// Section có thể sửa/khóa và lưu cùng chart (chart.generator.sectionEdits). Section đã sửa/khóa không bao giờ bị phân tích lại ghi đè.
const secClone = s => ({ ...s });
const secByStart = (a, b) => a.startMs - b.startMs;
export const lockedRangesFrom = secs => (secs || []).filter(s => s.locked).map(s => ({ from: s.startMs, to: s.endMs }));
const secFind = (secs, id) => { const i = secs.findIndex(s => s.id === id); if (i < 0) throw new Error(`Section "${id}" was not found.`); return i; };
export function setSectionLocked(secs, id, locked = true) { const out = secs.map(secClone), i = secFind(out, id); out[i] = { ...out[i], locked: !!locked, userEdited: true }; return out; }
export function renameSection(secs, id, label) { if (!label || typeof label !== 'string') throw new Error('Invalid section label.'); const out = secs.map(secClone), i = secFind(out, id); out[i] = { ...out[i], label, userEdited: true }; return out; }
export function splitSection(secs, id, atMs) {
  const out = secs.map(secClone), i = secFind(out, id), s = out[i];
  if (!(atMs > s.startMs + 500 && atMs < s.endMs - 500)) throw new Error('The split point must be inside the section and at least 500 ms from either edge.');
  if (s.locked) throw new Error('This section is locked. Unlock it before splitting.');
  out.splice(i, 1, { ...s, id: `${s.id}a`, endMs: Math.round(atMs), userEdited: true }, { ...s, id: `${s.id}b`, startMs: Math.round(atMs), userEdited: true });
  return out;
}
export function mergeSectionWithNext(secs, id) {
  const out = secs.map(secClone).sort(secByStart), i = secFind(out, id); if (i >= out.length - 1) throw new Error('There is no following section to merge.');
  const a = out[i], b = out[i + 1]; if (a.locked || b.locked) throw new Error('Locked sections cannot be merged.');
  const da = a.endMs - a.startMs, db = b.endMs - b.startMs, w = (x, y) => (x * da + y * db) / (da + db);
  out.splice(i, 2, { ...a, endMs: b.endMs, energy: w(a.energy, b.energy), activity: w(a.activity ?? 0, b.activity ?? 0), rhythmicDensity: w(a.rhythmicDensity ?? 0, b.rhythmicDensity ?? 0), confidence: Math.min(a.confidence ?? 1, b.confidence ?? 1), userEdited: true });
  return out;
}
// Quy tắc không ghi đè: section user đã sửa/khóa giữ nguyên; phần khoảng trống được lấp bằng section phát hiện mới (cắt cho vừa).
export function applySavedSections(detected, saved) {
  const keep = (saved || []).filter(s => s.locked || s.userEdited).map(secClone).sort(secByStart); if (!keep.length) return detected;
  const out = []; let cur = 0; const end = Math.max(detected.length ? detected[detected.length - 1].endMs : 0, keep[keep.length - 1].endMs);
  const fill = (a, b) => { for (const d of detected) { const s = Math.max(a, d.startMs), e = Math.min(b, d.endMs); if (e - s >= 400) out.push({ ...d, id: `${d.id}`, startMs: s, endMs: e }); } };
  for (const k of keep) { if (k.startMs > cur) fill(cur, k.startMs); out.push(k); cur = Math.max(cur, k.endMs); }
  if (cur < end) fill(cur, end);
  return out.sort(secByStart).map((s, i, a) => (a.findIndex(x => x.id === s.id) !== i ? { ...s, id: `${s.id}-${i}` } : s));
}
// Giữ note thuộc vùng khóa của chart cũ, bỏ note mới trong vùng đó.
export function mergeLockedNotes(oldNotes, freshNotes, ranges) {
  if (!ranges.length) return freshNotes; const inR = t => ranges.some(r => t >= r.from && t <= r.to);
  const kept = oldNotes.filter(n => inR(n.timeMs) || (n.endTimeMs && inR(n.endTimeMs))), ids = new Set(kept.map(n => n.id));
  const fresh = freshNotes.filter(n => !inR(n.timeMs) && !(n.endTimeMs && inR(n.endTimeMs))).map(n => { if (!ids.has(n.id)) return n; let id = `${n.id}-n`; while (ids.has(id)) id += 'n'; ids.add(id); return { ...n, id }; });
  return [...kept, ...fresh];
}
