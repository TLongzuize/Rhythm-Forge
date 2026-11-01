// Tự sửa lỗi có preview + undo. Không bao giờ chạm note `manual:true` hoặc note trong vùng khóa.
import { evaluateChart, sanitize } from './smartgen.js';
const inR = (rs, t) => rs.some(r => t >= r.from && t <= r.to);
const protectedNote = (n, locked) => n.manual || inR(locked, n.timeMs) || (n.endTimeMs && inR(locked, n.endTimeMs));
// Trả về danh sách sửa đề xuất, mỗi sửa là patch thuần dữ liệu (không đổi chart).
export function suggestFixes(chart, analysis, { maxNps = 0 } = {}) {
  const locked = [...(chart.generator?.lockedRanges || [])], notes = chart.notes || [], fixes = []; let k = 0;
  const add = (kind, description, from, to, patch) => fixes.push({ id: `fix-${k++}`, kind, description, from, to, patch });
  // 1. note không hợp lệ
  const dur = analysis.durationMs || chart.metadata?.audioDurationMs || Infinity;
  for (const n of notes) if (!Number.isFinite(n.timeMs) || n.timeMs < 0 || n.timeMs > dur + 50 || !(n.lane >= 0 && n.lane < 4) || (n.type === 'hold' && !(n.endTimeMs > n.timeMs))) if (!protectedNote(n, locked)) add('remove-invalid', `Remove invalid note ${n.id}`, n.timeMs, n.timeMs, { remove: [n.id] });
  // 2. hold chồng note cùng lane → rút ngắn hold (hoặc đổi thành tap nếu quá ngắn)
  for (const h of notes.filter(n => n.type === 'hold' && n.endTimeMs > n.timeMs && !protectedNote(n, locked))) {
    const nxt = notes.filter(o => o !== h && o.lane === h.lane && o.timeMs > h.timeMs && o.timeMs <= h.endTimeMs).sort((a, b) => a.timeMs - b.timeMs)[0]; if (!nxt) continue;
    const end = nxt.timeMs - 40; add('fix-hold-overlap', `Shorten hold ${h.id} to avoid overlapping the next note`, h.timeMs, h.endTimeMs, { update: [{ id: h.id, set: end - h.timeMs >= 120 ? { endTimeMs: end } : { type: 'tap', endTimeMs: undefined } }] });
  }
  // 3. jack quá dài (≥6 note cùng lane trong <400ms mỗi bước) → đổi lane note thứ 6, 12...
  const sing = notes.slice().sort((a, b) => a.timeMs - b.timeMs).filter((n, i, a) => i === 0 || n.timeMs !== a[i - 1].timeMs); let run = 1;
  for (let i = 1; i < sing.length; i++) {
    run = sing[i].lane === sing[i - 1].lane && sing[i].timeMs - sing[i - 1].timeMs < 400 ? run + 1 : 1;
    if (run >= 6 && run % 6 === 0 && !protectedNote(sing[i], locked)) {
      const n = sing[i], busy = l => notes.some(o => o.lane === l && o.type === 'hold' && n.timeMs >= o.timeMs - 30 && n.timeMs <= o.endTimeMs + 30) || notes.some(o => o.lane === l && Math.abs(o.timeMs - n.timeMs) < 30);
      const alt = [0, 1, 2, 3].filter(l => l !== n.lane && !busy(l)).sort((a, b) => Math.abs(a - n.lane) - Math.abs(b - n.lane))[0];
      if (alt !== undefined && n.type !== 'hold') add('break-jack', `Move note ${n.id} from lane ${n.lane + 1} to lane ${alt + 1} to break the jack run`, sing[i - 5].timeMs, n.timeMs, { update: [{ id: n.id, set: { lane: alt } }] });
    }
  }
  // 4. đỉnh mật độ: bỏ bớt note tap yếu nhất trong cửa sổ 1s vượt ngưỡng (mặc định = 1.6 × NPS cao nhất hợp lý theo độ khó)
  const cap = maxNps || ({ easy: 3, normal: 5, hard: 8, expert: 12 }[chart.metadata?.difficulty] || 8), f = analysis.features || [], hop = f.length > 1 ? (f[1].timeMs - f[0].timeMs) || 10 : 10;
  const str = n => { let m = 0; const c = Math.round(n.timeMs / hop); for (let q = -4; q <= 4; q++) m = Math.max(m, f[c + q]?.onset || 0); return m; };
  const ts = [...new Set(notes.map(n => n.timeMs))].sort((a, b) => a - b), gone = new Set();
  for (const t0 of ts) {
    const live = () => notes.filter(n => !gone.has(n.id) && n.timeMs >= t0 && n.timeMs < t0 + 1000), cnt0 = new Set(live().map(n => n.timeMs)).size; if (cnt0 <= cap) continue;
    const rm = []; for (const n of live().filter(n => n.type !== 'hold' && !protectedNote(n, locked)).sort((a, b) => str(a) - str(b))) { if (new Set(live().map(x => x.timeMs)).size <= cap) break; gone.add(n.id); rm.push(n.id); }
    if (rm.length) add('reduce-density', `Remove the ${rm.length} weakest notes at ${t0} ms (density ${cnt0}/s > ${cap}/s)`, t0, t0 + 1000, { remove: rm });
  }
  return fixes;
}
const patchNotes = (notes, fixes) => {
  const rm = new Set(fixes.flatMap(f => f.patch.remove || [])), up = new Map(); fixes.forEach(f => (f.patch.update || []).forEach(u => up.set(u.id, { ...(up.get(u.id) || {}), ...u.set })));
  return notes.filter(n => !rm.has(n.id)).map(n => { if (!up.has(n.id)) return n; const m = { ...n, ...up.get(n.id) }; if (m.endTimeMs === undefined) delete m.endTimeMs; return m; });
};
// Preview: kết quả nếu áp dụng (không đổi chart). fixIds=undefined → tất cả.
export function previewFixes(chart, analysis, fixes, fixIds) {
  const sel = fixIds ? fixes.filter(f => fixIds.includes(f.id)) : fixes, notes = sanitize(patchNotes(chart.notes, sel)), after = { ...chart, notes };
  const before = chart.quality || evaluateChart(chart, analysis), q = evaluateChart(after, analysis);
  return { notes, fixes: sel, before: { overall: before.overall, issues: before.issues.length, noteCount: chart.notes.length }, after: { overall: q.overall, issues: q.issues.length, noteCount: notes.length } };
}
// Áp dụng; trả undo token (bản sao notes cũ). Undo khôi phục chính xác.
export function applyFixes(chart, analysis, fixes, fixIds) {
  const p = previewFixes(chart, analysis, fixes, fixIds), out = { ...chart, notes: p.notes };
  out.quality = evaluateChart(out, analysis);
  return { chart: out, changes: p.fixes.map(f => ({ id: f.id, kind: f.kind, description: f.description, from: f.from, to: f.to })), undo: { chartId: chart.chartId, notes: chart.notes.map(n => ({ ...n })), quality: chart.quality }, report: p };
}
export function undoFixes(chart, undo) {
  if (!undo || !Array.isArray(undo.notes)) throw new Error('Invalid undo token.'); if (undo.chartId !== undefined && undo.chartId !== chart.chartId) throw new Error('Undo token belongs to a different chart.');
  return { ...chart, notes: undo.notes.map(n => ({ ...n })), quality: undo.quality };
}
