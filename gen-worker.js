import { generateAllSmart, generateSmart } from './smartgen.js';
self.onmessage = ev => {
  try { const j = ev.data; self.postMessage({ result: j.kind === 'all' ? generateAllSmart(j.analysis, j.title, j.seed, j.opts) : generateSmart(j.analysis, j.title, j.opts) }); }
  catch (e) { self.postMessage({ error: e instanceof Error ? e.message : 'Generation failed.' }); }
};
