// Persistent audio-analysis caches. IndexedDB failures always degrade to bounded memory caches.
export const ANALYSIS_VERSION = '2.2';
export const FEATURE_CACHE_VERSION = '1.0';
const IDB_NAME = 'rhythm-forge-analysis', IDB_STORE = 'analysis', CACHE_MAX = 6;
const FEATURE_DB_NAME = 'rhythm-forge-feature-cache', FEATURE_STORE = 'chunks', FEATURE_CACHE_MAX = 48;

// Fingerprint: two FNV-style hashes over file/sample bytes plus length.
// Large buffers are sampled with a stable stride and always include their tail.
export function fingerprint(data) {
  const u8 = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const stride = Math.max(1, Math.floor(u8.length / 4_000_000)); let h1 = 0x811c9dc5, h2 = 0x9747b28c;
  for (let i = 0; i < u8.length; i += stride) { const b = u8[i]; h1 = Math.imul(h1 ^ b, 16777619); h2 = Math.imul(h2 ^ (b + i), 2246822519); }
  if (stride > 1) for (let i = Math.max(0, u8.length - 4096); i < u8.length; i++) h1 = Math.imul(h1 ^ u8[i], 16777619);
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}-${u8.length.toString(16)}`;
}
const stableStr = v => v && typeof v === 'object' ? (Array.isArray(v) ? `[${v.map(stableStr)}]` : `{${Object.keys(v).sort().map(k => `${k}:${stableStr(v[k])}`).join(',')}}`) : JSON.stringify(v);
export const cacheKey = (fp, settings = {}) => `${ANALYSIS_VERSION}|${fp}|${stableStr(settings)}`;

export function validAnalysis(a) {
  return !!a && Array.isArray(a.features) && a.features.length > 0 && Number.isFinite(a.durationMs) && a.durationMs > 0 && Number.isFinite(a.bpm) && a.bpm > 0;
}
export function memoryStore() {
  const m = new Map();
  return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); }, async keys() { return [...m.keys()]; }, async clear() { m.clear(); }, kind: 'memory' };
}
export function indexedDbStore(idb = globalThis.indexedDB, { dbName = IDB_NAME, storeName = IDB_STORE } = {}) {
  if (!idb) return null;
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = idb.open(dbName, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(storeName)) r.result.createObjectStore(storeName); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error || new Error('IndexedDB open failed')); r.onblocked = () => rej(new Error('IndexedDB blocked'));
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      let request;
      try { const t = db.transaction(storeName, mode), s = t.objectStore(storeName); request = fn(s); t.oncomplete = () => res(request && 'result' in request ? request.result : undefined); t.onerror = t.onabort = () => rej(t.error || new Error('IndexedDB transaction failed')); }
      catch (e) { rej(e); }
    });
  };
  return { get: k => tx('readonly', s => s.get(k)), set: (k, v) => tx('readwrite', s => s.put(v, k)), delete: k => tx('readwrite', s => s.delete(k)), keys: () => tx('readonly', s => s.getAllKeys()), clear: () => tx('readwrite', s => s.clear()), kind: 'indexeddb' };
}

function boundedCache({ store, maxEntries, validate, version, label, warn }) {
  let primary = store !== undefined ? store : null;
  if (store === undefined) { try { primary = indexedDbStore(); } catch { primary = null; } }
  const fallback = memoryStore(), errors = [];
  const note = (op, e) => { const err = { op, message: e?.message || String(e), at: Date.now() }; errors.push(err); if (errors.length > 20) errors.shift(); warn(`[${label}]`, op, err.message); };
  const stores = () => primary ? [primary, fallback] : [fallback];
  return {
    errors, get kind() { return primary ? primary.kind : 'memory'; },
    async get(key) {
      for (const s of stores()) {
        try {
          const entry = await s.get(key); if (!entry) continue;
          if (entry.version !== version || entry.key !== key || !validate(entry.value)) { await s.delete(key).catch(() => {}); note('corrupt', new Error(`A corrupt or outdated cache entry was removed: ${key.slice(0, 40)}`)); continue; }
          entry.savedAt = Date.now(); await s.set(key, entry).catch(() => {}); return entry.value;
        } catch (e) { note('get', e); if (s === primary) primary = null; }
      }
      return null;
    },
    async set(key, value) {
      if (!validate(value)) { note('set', new Error('Refused to store invalid cache data.')); return false; }
      const entry = { key, version, savedAt: Date.now(), value };
      for (const s of stores()) {
        try {
          await s.set(key, entry); const ks = await s.keys();
          if (ks.length > maxEntries) { const all = await Promise.all(ks.map(async k => [k, (await s.get(k))?.savedAt || 0])); all.sort((a, b) => a[1] - b[1]); for (const [k] of all.slice(0, ks.length - maxEntries)) await s.delete(k); }
          return true;
        } catch (e) { note('set', e); if (s === primary) primary = null; }
      }
      return false;
    },
    async delete(key) { for (const s of stores()) try { await s.delete(key); } catch (e) { note('delete', e); if (s === primary) primary = null; } },
    async clear() { for (const s of stores()) try { await s.clear(); } catch (e) { note('clear', e); if (s === primary) primary = null; } },
  };
}

const validFeatureChunk = value => Array.isArray(value) && value.length > 0 && value.every(f => f && Number.isFinite(f.timeMs) && Number.isFinite(f.onset) && Number.isFinite(f.rms) && Number.isFinite(f.low) && Number.isFinite(f.mid) && Number.isFinite(f.high) && Number.isFinite(f.centroid));
export function createFeatureChunkCache({ store, maxEntries = FEATURE_CACHE_MAX, warn = (...a) => console.warn(...a) } = {}) {
  const primary = store === undefined ? (() => { try { return indexedDbStore(globalThis.indexedDB, { dbName: FEATURE_DB_NAME, storeName: FEATURE_STORE }); } catch { return null; } })() : store;
  return boundedCache({ store: primary, maxEntries, validate: validFeatureChunk, version: FEATURE_CACHE_VERSION, label: 'feature-cache', warn });
}

export function createAnalysisCache({ store, maxEntries = CACHE_MAX, warn = (...a) => console.warn(...a) } = {}) {
  const cache = boundedCache({ store, maxEntries, validate: validAnalysis, version: ANALYSIS_VERSION, label: 'analysis-cache', warn });
  return {
    errors: cache.errors, get kind() { return cache.kind; }, get: key => cache.get(key),
    set: async (key, analysis) => {
      // Do not persist transient tempo-map/worker internals with the base analysis record.
      const { tempoMap, ...clean } = analysis || {};
      return cache.set(key, clean);
    },
    delete: key => cache.delete(key), clear: () => cache.clear(),
  };
}
export const analysisCache = createAnalysisCache();
export const featureChunkCache = createFeatureChunkCache();
