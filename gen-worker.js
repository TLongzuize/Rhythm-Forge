import { generateAllSmart, generateSmart } from './smartgen.js';
import { generateAllRfV2, generateRfV2 } from './rfgen-v2.js';
self.onmessage = ev => {
  try { const j = ev.data; const v2 = j.engine === 'v2'; const all = j.kind === 'all'; self.postMessage({ result: v2 ? (all ? generateAllRfV2(j.analysis, j.title, j.seed, j.opts) : generateRfV2(j.analysis, j.title, j.opts)) : (all ? generateAllSmart(j.analysis, j.title, j.seed, j.opts) : generateSmart(j.analysis, j.title, j.opts)) }); }
  catch (e) { self.postMessage({ error: e instanceof Error ? e.message : 'Generation failed.' }); }
};
