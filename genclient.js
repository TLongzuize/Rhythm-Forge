// Chạy sinh chart trong Web Worker (hủy được), tự động fallback luồng chính khi Worker không có / lỗi.
import { generateAllSmart, generateSmart } from './smartgen.js';
import { generateAllRfV2, generateRfV2 } from './rfgen-v2.js';
let current = null, seq = 0;
export const cancelGeneration = () => { if (current) { current.worker.terminate(); current.reject(Object.assign(new Error('Generation cancelled.'), { cancelled: true })); current = null; } };
function viaWorker(job) {
  cancelGeneration();
  return new Promise((resolve, reject) => {
    const id = ++seq; let worker;
    try { worker = new Worker(new URL('./gen-worker.js', import.meta.url), { type: 'module' }); } catch (e) { reject(Object.assign(e, { noWorker: true })); return; }
    current = { worker, reject, id };
    worker.onmessage = ev => { if (!current || current.id !== id) return; current = null; worker.terminate(); ev.data.error ? reject(new Error(ev.data.error)) : resolve(ev.data.result); };
    worker.onerror = ev => { if (current?.id === id) current = null; worker.terminate(); reject(Object.assign(new Error(ev.message || 'Worker failed'), { noWorker: true })); };
    worker.postMessage(job);
  });
}
async function run(job, local) {
  if (typeof Worker === 'undefined') return local();
  try { return await viaWorker(job); }
  catch (e) { if (e.cancelled) throw e; if (e.noWorker) { console.warn('[genclient] Worker failed; falling back to the main thread:', e.message); return local(); } throw e; }
}
export const generateAllSmartAsync = (analysis, title, seed, opts = {}) => run({ kind: 'all', analysis, title, seed, opts }, () => generateAllSmart(analysis, title, seed, opts));
export const generateSmartAsync = (analysis, title, opts = {}) => run({ kind: 'one', analysis, title, opts }, () => generateSmart(analysis, title, opts));
export const generateAllRfV2Async = (analysis, title, seed, opts = {}) => run({ kind: 'all', analysis, title, seed, opts, engine: 'v2' }, () => generateAllRfV2(analysis, title, seed, opts));
export const generateRfV2Async = (analysis, title, opts = {}) => run({ kind: 'one', analysis, title, opts, engine: 'v2' }, () => generateRfV2(analysis, title, opts));
