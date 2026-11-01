import { fingerprint, cacheKey, analysisCache, featureChunkCache } from './cache.js';
/* Rhythm Forge core: audio analysis, deterministic chart generation, validation and scoring. */
export const DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'];
export const LANE_COLORS = ['#a78bfa', '#67e8f9', '#fb7185', '#fbbf24'];
export const DEFAULT_SETTINGS = { keys: ['d','f','j','k'], speed: 1, direction: 'down', upscroll: false, line: .925, layoutV: 3, showHitError: true, hitErrorWidth: 420, noteSize: 11.6, receptorSize: 11.6, laneSpacing: 14, receptorThickness: 5, noteOpacity: 1, hudScale: 1, noFail: true, showPP: true, showHealth: true, showScore: true, showCombo: true, showBPM: true, showCPS: true, showJudgement: true, showProgress: true, volume: .85, sfx: .6, dim: .55, effects: true, theme: 'violet', skin: 'midnight', bgmEnabled: true, bgmVolume: .22, offset: 0, reducedMotion: false, difficulty: 'normal', seed: 1337 };
const PROFILES = {
  easy:   { minScore: .36, minGap: 225, subdivisions: ['beat', 'onset'], chord: .01, density: .68, complexity: .2, maxNps: 3.8, holdChance: .055, patternBias: .36 },
  normal: { minScore: .29, minGap: 145, subdivisions: ['beat', 'eighth', 'onset'], chord: .075, density: .94, complexity: .44, maxNps: 6.2, holdChance: .13, patternBias: .46 },
  hard:   { minScore: .24, minGap: 98, subdivisions: ['beat', 'eighth', 'sixteenth', 'onset'], chord: .12, density: 1.08, complexity: .7, maxNps: 9.2, holdChance: .2, patternBias: .56 },
  expert: { minScore: .2, minGap: 72, subdivisions: ['beat', 'eighth', 'sixteenth', 'onset'], chord: .17, density: 1.2, complexity: .94, maxNps: 12, holdChance: .26, patternBias: .64 },
};
export function clamp(n, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, n)); }
function median(xs) { if (!xs.length) return 0; const a=[...xs].sort((x,y)=>x-y), m=a.length>>1; return a.length%2?a[m]:(a[m-1]+a[m])/2; }
export const ANALYSIS_FRAME_SIZE = 1024;
export const ANALYSIS_HOP_MS = 10;
export const ANALYSIS_CHUNK_MS = 30000;
export const ANALYSIS_CONTEXT_MS = 750;

// Extract un-normalized features so chunks can be cached independently and normalized globally.
export function extractFeatureFrames(samples, sampleRate, frameSize = ANALYSIS_FRAME_SIZE, hopSize = Math.max(1, Math.round(sampleRate * ANALYSIS_HOP_MS / 1000)), timeOffsetMs = 0) {
  const out = []; let prevRms = 0, prevLow = 0, prevMid = 0, prevHigh = 0, lowState = 0, midState = 0;
  const alphaLow = Math.exp(-2 * Math.PI * 180 / sampleRate), alphaMid = Math.exp(-2 * Math.PI * 1500 / sampleRate);
  for (let start = 0; start + 32 < samples.length; start += hopSize) {
    const end = Math.min(samples.length, start + frameSize); let sumSq = 0, loSq = 0, miSq = 0, hiSq = 0, lp = lowState, mp = midState, weight = 0, weighted = 0;
    for (let i = start; i < end; i++) { const sample = samples[i] || 0; sumSq += sample * sample; lp = (1 - alphaLow) * sample + alphaLow * lp; mp = (1 - alphaMid) * sample + alphaMid * mp; loSq += lp * lp; miSq += (mp - lp) ** 2; const high = sample - mp; hiSq += high * high; const a = Math.abs(sample); weight += a; weighted += (i - start) * a; }
    lowState = lp; midState = mp; const count = Math.max(1, end - start), rms = Math.sqrt(sumSq / count), low = Math.sqrt(loSq / count), mid = Math.sqrt(miSq / count), high = Math.sqrt(hiSq / count);
    const onset = Math.max(0, rms - prevRms) + Math.max(0, low - prevLow) * .75 + Math.max(0, mid - prevMid) * .7 + Math.max(0, high - prevHigh) * .6;
    out.push({ timeMs: timeOffsetMs + (start + count / 2) / sampleRate * 1000, onset, rms, low, mid, high, centroid: weight ? weighted / weight / count : .5 });
    prevRms = rms; prevLow = low; prevMid = mid; prevHigh = high;
  }
  return out;
}
function normalizeFeatureFrames(frames) {
  if (!frames.length) return [];
  const med = median(frames.map(f => f.onset)); let scale = 1e-6;
  for (const frame of frames) if (frame.onset > scale) scale = frame.onset;
  return frames.map(f => ({ ...f, onset: clamp((f.onset - med * .35) / scale * 1.6) }));
}
export function extractFeatures(samples, sampleRate, frameSize = ANALYSIS_FRAME_SIZE, hopSize = Math.max(1, Math.round(sampleRate * ANALYSIS_HOP_MS / 1000))) {
  return normalizeFeatureFrames(extractFeatureFrames(samples, sampleRate, frameSize, hopSize));
}

function correlationAtLag(env, lag) {
  if (!Number.isFinite(lag) || lag < 1 || lag >= env.length * .9) return 0;
  const first = Math.max(1, Math.ceil(lag)); let score = 0, count = 0;
  for (let i = first; i < env.length; i++) {
    const at = i - lag, lo = Math.floor(at), frac = at - lo, a = env[lo] || 0, b = env[Math.min(env.length - 1, lo + 1)] || 0;
    score += (env[i] || 0) * (a * (1 - frac) + b * frac); count++;
  }
  return score / Math.max(1, count);
}
function metricalPhaseEvidence(features, bpm, durationMs, hopMs) {
  const period = 60000 / bpm, step = Math.max(8, hopMs), firstTime = features[0]?.timeMs || 0;
  const rmsValues = features.map(f => f.rms || 0).sort((a, b) => a - b), lowValues = features.map(f => f.low || 0).sort((a, b) => a - b);
  const rmsRef = rmsValues[Math.floor(Math.max(0, rmsValues.length - 1) * .9)] || 1, lowRef = lowValues[Math.floor(Math.max(0, lowValues.length - 1) * .9)] || 1;
  let best = { score: -1, beat: 0, downbeat: 0, phase: 0 };
  for (let phase = 0; phase < period; phase += step) {
    let beatSum = 0, beatCount = 0, downSum = 0, downCount = 0, beatIndex = 0;
    for (let time = phase; time < durationMs; time += period, beatIndex++) {
      const index = Math.round((time - firstTime) / hopMs); let value = 0;
      for (let j = Math.max(0, index - 2); j <= Math.min(features.length - 1, index + 2); j++) {
        const f = features[j]; if (!f) continue;
        // Onset alone can saturate weak syncopated hits. Preserve accent differences
        // with a light RMS + low-band term (the latter is useful for soft kick pulses).
        const strength = .65 * (f.onset || 0) + .22 * clamp((f.rms || 0) / rmsRef) + .13 * clamp((f.low || 0) / lowRef);
        value = Math.max(value, strength);
      }
      beatSum += value; beatCount++;
      if (beatIndex % 4 === 0) { downSum += value; downCount++; }
    }
    const beat = beatSum / Math.max(1, beatCount), downbeat = downSum / Math.max(1, downCount);
    const score = beat * .35 + downbeat * .65;
    if (score > best.score) best = { score, beat, downbeat, phase };
  }
  return best;
}
export function inferTempo(features, durationMs, hopMs = 10) {
  const env = features.map(f => f.onset || 0), scores = [];
  // Fractional-lag autocorrelation avoids systematic octave errors caused by rounding
  // a 375 ms beat to 37 frames in a ~10 ms feature stream. Four-beat correlation and
  // a phase-aware downbeat score make syncopated accents less likely to masquerade as BPM.
  for (let bpm = 65; bpm <= 190; bpm++) {
    const lag = 60000 / bpm / hopMs;
    const beatScore = correlationAtLag(env, lag), halfBarScore = correlationAtLag(env, lag * 2), barScore = correlationAtLag(env, lag * 4);
    const phase = metricalPhaseEvidence(features, bpm, durationMs, hopMs);
    scores.push({ bpm, autoScore: beatScore * .42 + halfBarScore * .18 + barScore * .40, phaseScore: phase.score, beatScore, halfBarScore, barScore, phase });
  }
  const maxAuto = Math.max(1e-9, ...scores.map(x => x.autoScore)), maxPhase = Math.max(1e-9, ...scores.map(x => x.phaseScore));
  for (const x of scores) x.score = .2 * x.autoScore / maxAuto + .8 * x.phaseScore / maxPhase;
  scores.sort((a, b) => b.score - a.score);
  let best = scores[0] || { bpm: 120, score: 0, phase: { phase: 0 } };
  // When both octaves explain the same pulse (straight click tracks), choose the
  // faster reading; expose the slower interpretation as a candidate.
  const octaveUp = scores.find(x => x.bpm === best.bpm * 2);
  if (octaveUp && octaveUp.score >= best.score * .93) best = octaveUp;
  const mean = scores.reduce((sum, item) => sum + item.score, 0) / Math.max(1, scores.length);
  const octavePeer = scores.find(x => x.bpm === best.bpm / 2), ambiguous = octavePeer ? octavePeer.score / Math.max(best.score, 1e-9) : 0;
  let confidence = clamp((best.score - mean) / Math.max(best.score, 1e-6) * 3.8);
  const period = 60000 / best.bpm, offset = best.phase?.phase ?? 0;
  const avg = env.reduce((sum, value) => sum + value, 0) / Math.max(1, env.length);
  confidence = clamp(confidence * Math.min(1, avg * 4 + .25) * (ambiguous > .9 ? .78 : 1));
  const distinct = [];
  for (const item of scores) {
    if (distinct.some(existing => Math.abs(item.bpm - existing.bpm) < Math.max(4, existing.bpm * .045))) continue;
    distinct.push({ bpm: item.bpm, relativeScore: +(item.score / Math.max(best.score, 1e-9)).toFixed(3), beatScore: +item.beatScore.toFixed(5), barScore: +item.barScore.toFixed(5), downbeatScore: +item.phase.downbeat.toFixed(3) });
    if (distinct.length >= 6) break;
  }
  return { bpm: best.bpm, confidence, offsetMs: offset, candidates: distinct };
}
// Sub-frame peak position (parabolic interpolation of the onset curve), in ms relative to features[i].
function peakShift(fs,i){const a=fs[i-1].onset,b=fs[i].onset,c=fs[i+1].onset,den=a-2*b+c;if(!den)return 0;const h=(fs[i+1].timeMs-fs[i-1].timeMs)/2;return clamp((a-c)/(2*den),-.5,.5)*h;}
export function buildCandidates(features,bpm,offsetMs,durationMs){
  if(!features.length)return [];const hopMs=features[1]?.timeMs-features[0]?.timeMs||10, med=median(features.map(f=>f.onset)), map=new Map();
  const add=(time,onset,subdivision,alignment)=>{if(time<100||time>durationMs-120)return;const key=Math.round(time/10)*10,tExact=Math.round(time),idx=clamp(Math.round(time/hopMs),0,features.length-1)|0,f=features[idx];const energy=clamp(f.rms*3.2+f.low*1.3),strength=clamp(onset),score=clamp(strength*.46+energy*.24+alignment*.2+f.high*.3);const c={timeMs:tExact,confidence:clamp(score*.86+.08),onsetStrength:strength,beatAlignment:alignment,subdivision,localEnergy:energy,score};if(!map.has(key)||map.get(key).score<score)map.set(key,c);};
  for(let i=2;i<features.length-2;i++){const f=features[i];if(f.onset>features[i-1].onset&&f.onset>=features[i+1].onset&&f.onset>Math.max(.16,med*1.45)){const p=60000/bpm,r=((f.timeMs-offsetMs)%p+p)%p,d=Math.min(r,p-r);add(f.timeMs+peakShift(features,i),f.onset,'onset',clamp(1-d/(p*.26)));}}
  const period=60000/bpm;for(let s=0;s<Math.ceil(durationMs/(period/4));s++){const time=offsetMs+s*period/4;if(time<0||time>=durationMs)continue;const idx=clamp(Math.round(time/hopMs),0,features.length-1)|0,f=features[idx],mod=s%4,alignment=mod===0?1:mod===2?.68:.36,tag=mod===0?'beat':mod===2?'eighth':'sixteenth';add(time,f.onset*.72+f.rms*1.2,tag,alignment);}
  return [...map.values()].sort((a,b)=>a.timeMs-b.timeMs);
}
function analyzeFeatureFrames(rawFeatures, sampleRate, durationMs) {
  const features = normalizeFeatureFrames(rawFeatures);
  const hopMs = features.length > 1 ? features[1].timeMs - features[0].timeMs : ANALYSIS_HOP_MS;
  const tempo = inferTempo(features, durationMs, hopMs), candidates = buildCandidates(features, tempo.bpm, tempo.offsetMs, durationMs);
  const windowSize = Math.max(1, Math.round(4000 / hopMs)), sections = []; let previous = null;
  for (let i = windowSize; i < features.length - windowSize; i += windowSize) {
    let before = 0, after = 0;
    for (let j = i - windowSize; j < i; j++) before += features[j].rms;
    for (let j = i; j < i + windowSize; j++) after += features[j].rms;
    before /= windowSize; after /= windowSize;
    const contrast = Math.abs(after - before) / Math.max(.02, before, after);
    if (contrast > .48 && (previous === null || features[i].timeMs - previous >= 6000)) { sections.push(Math.round(features[i].timeMs)); previous = features[i].timeMs; }
  }
  return { durationMs, sampleRate, bpm: tempo.bpm, bpmConfidence: tempo.confidence, beatOffsetMs: tempo.offsetMs, gridConfidence: tempo.confidence, tempoCandidates: tempo.candidates, features, candidates, sections };
}
export function analyzeSamples(samples, sampleRate) {
  if (!(samples instanceof Float32Array) && !ArrayBuffer.isView(samples)) throw new TypeError('Audio samples must be a typed array.');
  if (!Number.isFinite(sampleRate) || sampleRate < 1000) throw new RangeError('Invalid audio sample rate.');
  if (!samples.length) throw new Error('Audio sample buffer is empty.');
  const durationMs = samples.length / sampleRate * 1000;
  const hopSize = Math.max(1, Math.round(sampleRate * ANALYSIS_HOP_MS / 1000));
  return analyzeFeatureFrames(extractFeatureFrames(samples, sampleRate, ANALYSIS_FRAME_SIZE, hopSize), sampleRate, durationMs);
}

// Feature chunks are cached before global normalization. An edit to one time range invalidates
// only the chunk(s) whose content or overlap context changed; the global tempo/sections are then
// recomputed from the merged feature stream to preserve whole-track consistency.
export async function analyzeSamplesIncremental(samples, sampleRate, {
  chunkMs = ANALYSIS_CHUNK_MS, contextMs = ANALYSIS_CONTEXT_MS, cache = featureChunkCache,
  shouldCancel = () => false, onProgress = () => {},
} = {}) {
  if (!(samples instanceof Float32Array) && !ArrayBuffer.isView(samples)) throw new TypeError('Audio samples must be a typed array.');
  if (!Number.isFinite(sampleRate) || sampleRate < 1000) throw new RangeError('Invalid audio sample rate.');
  if (!samples.length) throw new Error('Audio sample buffer is empty.');
  if (!Number.isFinite(chunkMs) || chunkMs < 2000 || !Number.isFinite(contextMs) || contextMs < 0 || contextMs >= chunkMs / 2) throw new RangeError('Invalid incremental analysis chunk settings.');
  const durationMs = samples.length / sampleRate * 1000, hopSize = Math.max(1, Math.round(sampleRate * ANALYSIS_HOP_MS / 1000));
  const merged = []; let cacheHits = 0, computedChunks = 0, chunkCount = 0;
  for (let coreFromMs = 0; coreFromMs < durationMs; coreFromMs += chunkMs) {
    if (shouldCancel()) throw Object.assign(new Error('Analysis cancelled.'), { cancelled: true });
    const coreToMs = Math.min(durationMs, coreFromMs + chunkMs);
    const wantedFrom = Math.max(0, coreFromMs - contextMs), wantedTo = Math.min(durationMs, coreToMs + contextMs);
    const startSample = Math.floor((wantedFrom * sampleRate / 1000) / hopSize) * hopSize;
    const endSample = Math.min(samples.length, Math.ceil(wantedTo * sampleRate / 1000));
    const chunkSamples = samples.subarray(startSample, endSample), startMs = startSample / sampleRate * 1000;
    const key = cacheKey(fingerprint(chunkSamples), { kind: 'raw-feature-chunk', sampleRate, startSample, coreFromMs, coreToMs, frameSize: ANALYSIS_FRAME_SIZE, hopSize, contextMs });
    let frames = cache ? await cache.get(key) : null;
    if (frames) cacheHits++;
    else {
      frames = extractFeatureFrames(chunkSamples, sampleRate, ANALYSIS_FRAME_SIZE, hopSize, startMs).filter(f => f.timeMs >= coreFromMs && f.timeMs < coreToMs);
      if (cache) await cache.set(key, frames);
      computedChunks++;
    }
    merged.push(...frames); chunkCount++;
    onProgress(chunkCount / Math.ceil(durationMs / chunkMs) * 100);
    await Promise.resolve();
  }
  merged.sort((a, b) => a.timeMs - b.timeMs);
  const analysis = analyzeFeatureFrames(merged, sampleRate, durationMs);
  return { analysis, stats: { chunks: chunkCount, cacheHits, computedChunks, chunkMs, contextMs } };
}

export async function analyzeAudioFile(file, onProgress = () => {}, shouldCancel = () => false) {
  if (!file || !file.size) throw Error('This audio file is empty.');
  if (file.size > 500 * 1024 * 1024) throw Error('Audio files are limited to 500 MB.');
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw Error('This browser does not support Web Audio API.');
  const ctx = new AC();
  try {
    onProgress(5); const arr = await file.arrayBuffer();
    const cKey = cacheKey(fingerprint(arr), { analysis: 'core-incremental' }), hit = await analysisCache.get(cKey);
    if (hit) { if (shouldCancel()) throw Error('Analysis cancelled.'); onProgress(100); return hit; }
    onProgress(20); const buffer = await ctx.decodeAudioData(arr.slice(0)); onProgress(42);
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) { const data = buffer.getChannelData(c); for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels; }
    if (shouldCancel()) throw Error('Analysis cancelled.'); onProgress(55);
    const fallbackSamples = mono.slice();
    const runWorker = () => new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = event => {
          const data = event.data || {};
          if (Number.isFinite(data.progress)) { onProgress(55 + data.progress * .43); return; }
          worker.terminate();
          if (data.error) reject(new Error(data.error)); else resolve({ analysis: data.analysis, incrementalStats: data.incrementalStats || null });
        };
        worker.onerror = event => { worker.terminate(); reject(new Error(event.message || 'Analysis Worker failed.')); };
        worker.postMessage({ samples: mono.buffer, sampleRate: buffer.sampleRate, durationMs: buffer.duration * 1000, incremental: true }, [mono.buffer]);
      } catch (error) { if (worker) worker.terminate(); reject(error); }
    });
    let computed, workerStats = null;
    try { const result = await runWorker(); computed = result.analysis; workerStats = result.incrementalStats; }
    catch (workerError) {
      // Worker/CSP failure is recoverable; reuse feature chunks on the main thread.
      if (shouldCancel()) throw Error('Analysis cancelled.');
      onProgress(58);
      const result = await analyzeSamplesIncremental(fallbackSamples, buffer.sampleRate, { shouldCancel, onProgress: p => onProgress(58 + p * .38) });
      computed = result.analysis; computed.incrementalStats = { ...result.stats, fallback: true, workerError: workerError?.message || String(workerError) };
    }
    if (shouldCancel()) throw Error('Analysis cancelled.');
    await analysisCache.set(cKey, computed);
    // Runtime diagnostics are returned to the caller but are not required in persistent cache records.
    if (workerStats) computed.incrementalStats = workerStats;
    onProgress(100); return computed;
  } finally { await ctx.close().catch(() => {}); }
}
function rng(seed){let state=(seed>>>0)||0x9e3779b9;return()=>{state+=0x6D2B79F5;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
function nearSubdivision(time,bpm,offset){const beat=60000/bpm;let best={label:'onset',alignment:.12,distance:Infinity};for(const s of [{n:1,label:'beat',a:1},{n:2,label:'eighth',a:.72},{n:4,label:'sixteenth',a:.42}]){const distance=Math.abs((time-offset)/(beat/s.n)-Math.round((time-offset)/(beat/s.n)))*beat/s.n;if(distance<best.distance)best={label:s.label,alignment:s.a,distance};}return {label:best.label,alignment:best.distance<24?best.alignment:.12};}
function densityAt(notes,t){let n=0;for(const x of notes)if(Math.abs(x.timeMs-t)<=1000)n++;return n;}
const LANE_MOTIFS = [
  { name: 'staircase-up', seq: [0,1,2,3,1,2,3,0,2,3,0,1,3,0,1,2] },
  { name: 'staircase-down', seq: [3,2,1,0,2,1,0,3,1,0,3,2,0,3,2,1] },
  { name: 'zigzag', seq: [0,2,1,3,2,0,3,1,0,2,1,3,2,0,3,1] },
  { name: 'outer-inner', seq: [0,3,1,2,0,2,1,3,3,0,2,1,3,1,2,0] },
  { name: 'alternating-pairs', seq: [0,0,2,2,1,1,3,3,0,2,0,2,1,3,1,3] },
  { name: 'crossovers', seq: [1,3,0,2,3,1,2,0,1,2,3,0,2,1,0,3] },
  { name: 'center-out', seq: [1,2,0,3,2,1,3,0,1,3,2,0,3,0,1,2] },
  { name: 'broken-run', seq: [0,1,2,0,3,2,1,3,1,0,3,2,0,2,3,1] },
  { name: 'syncopated-jump', seq: [0,2,2,1,3,1,0,3,2,0,1,1,3,2,0,3] },
  { name: 'spiral', seq: [0,1,3,2,1,3,2,0,3,2,0,1,2,0,1,3] },
];
function lanePick(c,t,notes,random,bpm,profile,preferredLane=-1){
  const beat=60000/bpm,phase=((t%beat)+beat)%beat/beat,barStep=Math.floor(t/(beat*4)),recent=notes.slice(-16).filter(n=>t>=n.timeMs&&t-n.timeMs<1250),counts=[0,0,0,0];
  for(const n of recent)counts[n.lane]++;
  const prev=recent.at(-1),prev2=recent.at(-2),prev3=recent.at(-3),lastJump=prev&&prev2?Math.sign(prev.lane-prev2.lane):0;
  const scores=[0,1,2,3].map(l=>{
    let score=(2-counts[l])*.27+(random()-.5)*.38;
    if(prev&&l===prev.lane)score-=.64+profile.complexity*.38;
    if(prev2&&prev2.lane===l&&prev&&prev.lane!==l)score-=.19;
    if(prev3&&prev2&&prev&&prev3.lane===prev.lane&&prev2.lane===prev.lane-1&&l===prev2.lane)score-=.5;
    if(prev){const jump=Math.abs(l-prev.lane);if(jump===1)score+=.2;if(jump===2)score+=.14+profile.complexity*.09;if(jump===3)score+=profile.complexity*.16;}
    if(prev2&&prev&&lastJump&&Math.sign(l-prev.lane)===lastJump&&Math.abs(l-prev.lane)===1)score+=.07;
    const phraseLane=(barStep+Math.floor(phase*4)+Math.floor((c.high||0)*3))%4;
    if(l===phraseLane)score+=.1;
    if((c.low||0)>(c.high||0)*1.3&&(l===0||l===3))score+=.07;
    if((c.high||0)>(c.low||0)*.8&&(l===1||l===2))score+=.06;
    if(c.onsetStrength>.72&&l===(Math.round(t/beat)%2===0?0:3))score+=.09;
    if(l===preferredLane)score+=profile.patternBias||0;
    return {lane:l,score};
  });
  scores.sort((a,b)=>b.score-a.score);return scores[0].lane;
}
export function validateChart(chart){const errors=[],warnings=[];const err=(code,message,noteId)=>errors.push({severity:'error',code,message,noteId}),warn=(code,message,noteId)=>warnings.push({severity:'warning',code,message,noteId});if(!chart||typeof chart!=='object'){err('schema','Chart must be a JSON object.');return {valid:false,errors,warnings};}if(chart.schemaVersion!==1)err('version','Unsupported schemaVersion; expected 1.');if(typeof chart.chartId!=='string'||!chart.chartId.trim())err('chart-id','chartId must be a non-empty string.');const m=chart.metadata;if(!m||typeof m!=='object')err('metadata','metadata is missing.');else{if(typeof m.title!=='string'||!m.title.trim())err('title','metadata.title must be a non-empty string.');if(!Number.isFinite(m.audioDurationMs)||m.audioDurationMs<=0)err('duration','audioDurationMs must be positive.');if(!Number.isFinite(m.offsetMs))err('offset','offsetMs must be finite.');if(m.bpm!==undefined&&(!Number.isFinite(m.bpm)||m.bpm<30||m.bpm>300))warn('bpm-range','BPM is outside typical 30–300 range.');if(!DIFFICULTIES.includes(m.difficulty))err('difficulty','Difficulty must be easy, normal, hard, or expert.');}if(!Array.isArray(chart.notes)){err('notes','notes must be an array.');return {valid:false,errors,warnings};}const ids=new Set(),laneTimes=new Map(),sorted=[...chart.notes].sort((a,b)=>(a?.timeMs||0)-(b?.timeMs||0)),duration=m?.audioDurationMs??Infinity;let previous=-Infinity;for(const n of sorted){if(!n?.id||typeof n.id!=='string')err('note-id','Every note needs a string ID.',n?.id);else if(ids.has(n.id))err('duplicate-id',`Duplicate note ID: ${n.id}.`,n.id);else ids.add(n.id);if(!Number.isFinite(n?.timeMs)){err('time','Note time must be finite.',n?.id);continue;}if(n.timeMs<0)err('negative-time','Note time cannot be negative.',n.id);if(n.timeMs>duration+50)warn('past-duration','Note is beyond the audio duration.',n.id);if(!Number.isInteger(n.lane)||n.lane<0||n.lane>3)err('lane','Lane must be integer 0–3.',n.id);if(!['tap','hold'].includes(n.type))err('note-type','Note type must be tap or hold.',n.id);if(n.type==='hold'&&(!Number.isFinite(n.endTimeMs)||n.endTimeMs<=n.timeMs))err('hold-duration','Hold endTimeMs must exceed timeMs.',n.id);const last=laneTimes.get(n.lane);if(last!==undefined&&n.timeMs-last<45)warn('lane-overlap','Two notes in one lane are less than 45 ms apart.',n.id);laneTimes.set(n.lane,n.timeMs);previous=Math.max(previous,n.timeMs);}for(let i=0;i<sorted.length;i++){let j=i;while(j<sorted.length&&sorted[j].timeMs-sorted[i].timeMs<=1000)j++;if(j-i>18){warn('density','More than 18 notes occur in a one-second window.',sorted[i].id);break;}}return {valid:!errors.length,errors,warnings};}
function refineGrid(analysis,bpm0,off0,fixBpm,fixOff){
  const cs=(analysis.candidates||[]).filter(c=>c.subdivision==='onset'&&(c.onsetStrength||0)>.3);
  if(cs.length<12||(fixBpm&&fixOff))return {bpm:bpm0,offset:off0};
  const w=cs.map(c=>(c.onsetStrength||0)+.6*(c.localEnergy||0));let best={s:-1,bpm:bpm0,off:off0};
  const bpms=fixBpm?[bpm0]:Array.from({length:121},(_,i)=>bpm0*(1+(i-60)*.0005));
  for(const b of bpms){const beat=60000/b,half=beat/2,sig=Math.min(18,beat*.045),phases=fixOff?[off0]:Array.from({length:Math.ceil(beat/4)},(_,i)=>i*4);
    for(const ph of phases){let s=0;for(let i=0;i<cs.length;i++){const r=(((cs[i].timeMs-ph)%beat)+beat)%beat,d1=Math.min(r,beat-r),r2=r%half,d2=Math.min(r2,half-r2);s+=w[i]*(Math.exp(-d1*d1/(2*sig*sig))+.45*Math.exp(-d2*d2/(2*sig*sig)));}
      if(s>best.s)best={s,bpm:b,off:ph};}}
  return {bpm:Math.round(best.bpm*100)/100,offset:best.off};
}
export function generateChart(analysis,title,{difficulty='normal',seed=1337,bpmOverride,offsetOverrideMs,minConfidence=.1,densityScale=1}={}){
  const started=performance.now();
  const baseProfile=PROFILES[difficulty]||PROFILES.normal;
  const profile={...baseProfile,density:baseProfile.density*densityScale};
  const fixBpm=bpmOverride>=30&&bpmOverride<=300,grid=refineGrid(analysis,fixBpm?bpmOverride:(analysis.bpm||120),offsetOverrideMs??analysis.beatOffsetMs??0,fixBpm,offsetOverrideMs!==undefined);
  const biasMs=0,bpm=grid.bpm,offset=offsetOverrideMs!==undefined?grid.offset:grid.offset+biasMs;
  const beat=60000/bpm,barMs=beat*4,random=rng(seed);
  const cfgs={
    easy:{thr:.36,gap:240,nps:3.2,chord:0,hand:0,ln:.055,maxLvl:i=>i>.72?1:0},
    normal:{thr:.30,gap:160,nps:5,chord:.3,hand:0,ln:.12,maxLvl:i=>i>.9?2:1},
    hard:{thr:.25,gap:110,nps:8,chord:.55,hand:0,ln:.16,maxLvl:i=>i>.45?2:1},
    expert:{thr:.21,gap:82,nps:11.5,chord:.8,hand:.3,ln:.2,maxLvl:()=>2},
  };
  const cfg=cfgs[difficulty]||cfgs.normal,features=analysis.features||[];
  const hop=features.length>1?(features[1].timeMs-features[0].timeMs)||10:10,t0=features[0]?.timeMs||0,step=beat/4;
  const fAt=t=>features[clamp(Math.round((t-t0)/hop),0,Math.max(0,features.length-1))|0]||{};
  const onsetNear=(t,r)=>{let m=0;const i=Math.round((t-t0)/hop),k=Math.max(1,Math.round(r/hop));for(let j=i-k;j<=i+k;j++){const f=features[j];if(f&&f.onset>m)m=f.onset;}return m;};
  const candidates=(analysis.candidates||[]).slice().sort((a,b)=>a.timeMs-b.timeMs);
  const candNear=(t,r)=>{let lo=0,hi=candidates.length;while(lo<hi){const m=(lo+hi)>>1;if(candidates[m].timeMs<t-r)lo=m+1;else hi=m;}let best=0;for(let k=lo;k<candidates.length&&candidates[k].timeMs<=t+r;k++)best=Math.max(best,candidates[k].score||0);return best;};
  // 1) Local grid fit: the tempo estimate drifts, so each bar gets a small phase correction measured from strong onsets nearby.
  const nBars=Math.ceil(Math.max(1,analysis.durationMs-offset)/barMs)+2,resid=Array.from({length:nBars},()=>[]);
  for(const c of candidates){if(c.subdivision!=='onset'||(c.onsetStrength||0)<.4)continue;const rel=c.timeMs-offset,sl=Math.round(rel/step),r=rel-sl*step;if(rel>=0&&Math.abs(r)<step*.45){const b=Math.floor(rel/barMs);if(resid[b])resid[b].push(r);}}
  const phase=new Array(nBars).fill(0);let prevPh=0;
  for(let b=0;b<nBars;b++){const xs=[];for(let k=b-3;k<=b+3;k++)if(resid[k])xs.push(...resid[k]);phase[b]=xs.length>=4?clamp(median(xs),-Math.min(step*.5,60),Math.min(step*.5,60)):prevPh;prevPh=phase[b];}
  // 2) Score every grid slot (1/16 beat) from onset, metric position and energy.
  const first=Math.max(0,Math.ceil((110-offset)/step)),lastSlot=Math.floor((analysis.durationMs-150-offset)/step),slots=[];
  for(let s=first;s<=lastSlot;s++){const b=Math.max(0,Math.floor(s*step/barMs)),t=Math.round(offset+s*step+(phase[b]||0)),f=fAt(t);
    slots.push({s,b,t,f,ow:onsetNear(t,Math.min(55,step*.42)),cs:candNear(t,45),lvl:s%4===0?0:s%2===0?1:2,metric:s%16===0?1:s%4===0?.8:s%2===0?.5:.26});}
  const owSorted=slots.map(x=>x.ow).sort((a,b)=>a-b),p90=Math.max(.15,owSorted[Math.floor(owSorted.length*.9)]||.3);
  for(const x of slots)x.score=clamp(clamp(x.ow/p90)*.48+x.cs*.14+x.metric*.2+clamp((x.f.rms||0)*3.2+(x.f.low||0)*1.3)*.18);
  // 3) Section intensity (0..1 percentile per bar, smoothed) decides how fine the rhythm may get.
  const barTop=Array.from({length:nBars},()=>[]);for(const x of slots)barTop[x.b]?.push(x.score);
  const rawInt=barTop.map(a=>{a.sort((p,q)=>q-p);const top=a.slice(0,6);return top.length?top.reduce((p,q)=>p+q,0)/top.length:0;});
  const ranked=[...rawInt].sort((p,q)=>p-q),pct=rawInt.map(v=>ranked.indexOf(v)/Math.max(1,ranked.length-1));
  const barInt=pct.map((v,i)=>(pct[i-1]??v)*.25+v*.5+(pct[i+1]??v)*.25);
  for(const x of slots)x.inten=barInt[x.b]??.5;
  // 4) Pick rhythm: threshold per subdivision level, drop lonely 16ths, fill steady pulses, then cap density strongest-first.
  const n=slots.length,sel=new Array(n).fill(false),thBase=cfg.thr/Math.pow(Math.max(.3,densityScale),.7),th=x=>thBase+[0,.06,.14][x.lvl]-x.inten*.07;
  for(let j=0;j<n;j++){const x=slots[j];if(x.lvl<=cfg.maxLvl(x.inten)&&x.score>=th(x))sel[j]=true;}
  for(let j=0;j<n;j++)if(sel[j]&&slots[j].lvl===2&&!(sel[j-1]||sel[j+1]||sel[j-2]||sel[j+2])&&slots[j].score<th(slots[j])+.14)sel[j]=false;
  for(let j=0;j<n;j++){const x=slots[j];if(sel[j]||x.lvl>1||x.lvl>cfg.maxLvl(x.inten))continue;const d=x.lvl===0?4:2;if(sel[j-d]&&sel[j+d]&&x.score>th(x)*.72)sel[j]=true;}
  const keep=new Array(n).fill(false),win=Math.max(2,Math.round(500/step));
  for(const lv of [0,1,2])for(let j=0;j<n;j++){
    if(!sel[j]||slots[j].lvl!==lv)continue;const t=slots[j].t;let bad=false;
    for(let k=j-1;k>=0&&t-slots[k].t<cfg.gap;k--)if(keep[k]){bad=true;break;}
    for(let k=j+1;!bad&&k<n&&slots[k].t-t<cfg.gap;k++)if(keep[k]){bad=true;break;}
    if(bad)continue;let c=0;for(let k=Math.max(0,j-win);k<=Math.min(n-1,j+win);k++)if(keep[k])c++;
    if(c>=cfg.nps*Math.max(.5,densityScale))continue;keep[j]=true;
  }
  const rows=[];for(let j=0;j<n;j++)if(keep[j])rows.push(slots[j]);
  const ONSET_BIAS_MS=biasMs,R=Math.min(step*.45,70);
  for(const r of rows){let bi=-1,bv=.04;const i0=Math.round((r.t-t0)/hop),k=Math.round(R/hop);for(let q=i0-k;q<=i0+k;q++){const f=features[q];if(f&&f.onset>bv){bv=f.onset;bi=q;}}if(bi>=0){const w=[];for(let q=i0-25;q<=i0+25;q++)if(features[q])w.push(features[q].onset);w.sort((a,b)=>a-b);const med=w[w.length>>1]||0;if(bv>=Math.max(.04,med*3))r.t=Math.round(features[bi].timeMs+ONSET_BIAS_MS);}}
  for(let q=1;q<rows.length;q++)if(rows[q].t-rows[q-1].t<Math.min(cfg.gap,60)){rows.splice(rows[q].score>rows[q-1].score?q-1:q,1);q--;}
  const selected=rows,subdivisions={};
  // 5) Lanes: whole phrases use readable templates (stairs, rolls, trills, zigzags), repeated and mirrored like a human mapper would.
  const PAT={stairUp:[0,1,2,3],stairDown:[3,2,1,0],roll:[0,1,2,3,2,1],trillA:[0,2],trillB:[1,3],trillC:[0,1],trillD:[2,3],trillE:[1,2],zigzag:[0,2,1,3],split:[0,3,1,2],sweep:[0,3],spiral:[0,1,3,2],ladder:[0,1,0,2,1,3,2,3],outIn:[0,3,1,2,1,3],bounce:[1,0,2,3,2,0],gallop:[0,0,2,1,1,3],tripleStair:[0,1,2,1,2,3],cross:[0,2,3,1],jackPair:[1,1,2,2,0,0,3,3],wave:[0,1,2,3,3,2,1,0]};
  const fastNames=['stairUp','stairDown','roll','trillA','trillB','trillC','trillD','zigzag','spiral','ladder','bounce','tripleStair','cross','wave'],slowNames=[...fastNames,'split','sweep','trillE','outIn','gallop','jackPair'];
  const notes=[],barMotifs=new Map(),lvlName=['beat','eighth','sixteenth'];let id=0,chords=0,pat=null,patUses=0,lastName='',holds=[],prevLanes=[],prevT=-1e9,chordStreak=0;
  const makeId=()=>`rf-${(seed>>>0).toString(16)}-${(id++).toString(36).padStart(4,'0')}`;
  const sustainMs=t=>{const ref=fAt(t+60).rms||0;if(ref<.01)return 0;let dt=120;for(;dt<beat*4;dt+=step){if((fAt(t+dt).rms||0)<ref*.55)break;if(dt>step*1.5&&onsetNear(t+dt,15)>.55)break;}return dt;};
  for(let i=0;i<rows.length;i++){
    const r=rows[i],t=r.t;holds=holds.filter(h=>h.end+step*.45>t);
    const free=[0,1,2,3].filter(l=>!holds.some(h=>h.lane===l)),gapPrev=t-prevT,gapNext=rows[i+1]?rows[i+1].t-t:1e9,fast=Math.min(gapPrev,gapNext)<150;
    if(!free.length){continue;}
    let size=1;
    if(cfg.chord>0&&gapPrev>=120&&free.length>=2&&chordStreak<2&&(!holds.length||difficulty==='expert')&&random()<cfg.chord*clamp((r.score-.38)*2+(r.metric>=.8?.4:0)))size=2;
    if(size===2&&cfg.hand>0&&r.metric>=.8&&r.score>.7&&free.length>=3&&!holds.length&&random()<cfg.hand)size=3;
    if(!pat||pat.left<=0){
      const reuse=pat&&patUses<2&&random()<.6,pool=(fast?fastNames:slowNames).filter(nm=>nm!==lastName),name=reuse?pat.name:pool[Math.floor(random()*pool.length)],base=PAT[name],pl=prevLanes[0]??-1;
      const variants=[base,base.map(x=>3-x),[...base].reverse(),[...base].reverse().map(x=>3-x)];
      let best=variants[0],bc=1e9;for(const v of variants){const c=(v[0]===pl?5:0)+Math.abs(v[0]-(pl<0?v[0]:pl))*.6+random()*.6;if(c<bc){bc=c;best=v;}}
      patUses=reuse?patUses+1:1;pat={name,seq:best,pos:0,left:Math.max(base.length,Math.round(8/base.length)*base.length)};lastName=name;barMotifs.set(name,{name});
    }
    const want=pat.seq[pat.pos%pat.seq.length];pat.pos++;pat.left--;
    const avoid=gapPrev<280?prevLanes:[],pick=(w,av)=>{const c=free.filter(l=>!av.includes(l)),p=(c.length?c:free).slice().sort((a,b)=>Math.abs(a-w)-Math.abs(b-w)||random()-.5);return p[0];};
    let lanes=[];const primary=pick(want,avoid);lanes.push(primary);
    if(size===2){const pc=(a,b)=>{const d=Math.abs(a-b);return (a+b===3?0:d===2?.5:d===1?.8:1.2)+(avoid.includes(b)?3:0)+random()*.3;};const alts=free.filter(l=>l!==primary).sort((a,b)=>pc(primary,a)-pc(primary,b));if(alts.length)lanes.push(alts[0]);}
    if(size===3){const x=free.includes(prevLanes[0])?prevLanes[0]:free[Math.floor(random()*free.length)];lanes=free.filter(l=>l!==x).slice(0,3);if(lanes.length<3)lanes=free.slice(0,3);}
    lanes.sort((a,b)=>a-b);
    let endT=0;
    // Hold planner: short holds (1/4-1 beat), medium (1-2 beats) and long (2+ beats). Length is clamped by the next onset in the same lane and by the rows that follow, so a hold never smothers the rhythm.
    const maxHolds=difficulty==='easy'?1:difficulty==='normal'?2:3;
    if(cfg.ln>0&&r.lvl<=2&&lanes.length<=(difficulty==='expert'?2:1)&&holds.length<maxHolds&&gapPrev>=Math.min(cfg.gap*1.2,200)){
      const inten=r.inten,strong=r.score>.5,sus=Math.max(sustainMs(t),inten<.7?Math.min(gapNext,beat*4)*.85:0);
      // chance rises with sustained sound (real held note) and falls for dense sections
      let p=cfg.ln*(sus>=beat*1.5?4.2:sus>=beat*.75?2.4:1.3)*(1.15-inten*.5)*(strong?1.15:.9);
      if(r.metric>=.8)p*=1.25;
      p=Math.min(.62,p);
      if(random()<p){
        // choose a length class
        const roll=random(),longOk=sus>=beat*1.4&&r.lvl<=1;
        const cls=longOk&&roll<.4?'long':sus>=beat*.7&&roll<.65?'mid':'short';
        const unit=cls==='short'?step:cls==='mid'?step*2:step*4;
        let target=cls==='short'?step*(1+Math.floor(random()*3)+(r.lvl===0&&random()<.4?1:0)):cls==='mid'?beat*(1+Math.floor(random()*2)*.5):Math.min(sus,beat*(2+Math.floor(random()*3)));
        if(cls!=='short')target=Math.min(target,Math.max(sus,beat*.75));
        // never extend past the next row that would land in the same lane region: stop one 1/16 before the next selected row when density is high
        const nextRowT=rows[i+1]?rows[i+1].t:1e9,fastNext=nextRowT-t<beat*.5;
        let len=Math.floor(target/unit)*unit;
        if(len<step)len=step;
        if(cls==='short'&&fastNext)len=Math.min(len,Math.max(step,nextRowT-t-step*.6));
        if(len>=step*.9&&t+len<analysis.durationMs-100){endT=Math.round(t+len);}
      }
    }
    for(const l of lanes){const nt={id:makeId(),timeMs:t,lane:l,type:'tap'};if(endT){nt.type='hold';nt.endTimeMs=endT;holds.push({lane:l,end:endT});}notes.push(nt);}
    subdivisions[lvlName[r.lvl]]=(subdivisions[lvlName[r.lvl]]||0)+1;if(lanes.length>1)chords++;
    chordStreak=lanes.length>1?chordStreak+1:0;prevLanes=lanes;prevT=t;
  }
  notes.sort((a,b)=>a.timeMs-b.timeMs||a.lane-b.lane||a.id.localeCompare(b.id));
  const unique=notes.filter((n,i,a)=>!(i&&a[i-1].timeMs===n.timeMs&&a[i-1].lane===n.lane));
  const holdCount=unique.filter(n=>n.type==='hold').length;
  const chordCount=unique.filter((n,i,a)=>i>0&&a[i-1].timeMs===n.timeMs).length;
  const rating=clamp(unique.length/Math.max(1,analysis.durationMs/1000)*1.35+profile.complexity*1.8+chordCount*.04+holdCount*.08,1,12);
  const chart={schemaVersion:1,chartId:`chart-${(seed>>>0).toString(16)}-${difficulty}-${Math.round(analysis.durationMs)}`,metadata:{title:title||'Untitled track',audioDurationMs:Math.round(analysis.durationMs),bpm,offsetMs:Math.round(offset),difficulty,difficultyRating:Math.round(rating*10)/10},generator:{engineVersion:'0.3.0',seed,profileId:`${difficulty}-mapper-v3`,sourceFingerprint:`${Math.round(analysis.durationMs)}ms-${analysis.sampleRate}hz`},notes:unique};
  const validation=validateChart(chart);
  const peak=Math.max(0,...unique.map(n=>densityAt(unique,n.timeMs)));
  const eventPatterns=unique.slice(1).map((n,i)=>{
    const prev=unique[i],gap=n.timeMs-prev.timeMs,laneDelta=n.lane-prev.lane;
    const rhythm=gap<150?'burst':gap<260?'flow':gap>520?'sparse':'steady';
    const movement=Math.abs(laneDelta)===0?'repeat':Math.abs(laneDelta)===1?'step':Math.abs(laneDelta)===2?'jump':'cross';
    return `${rhythm}-${movement}`;
  });
  const motifNames=new Set([...barMotifs.values()].map(m=>m.name));
  const repetition=eventPatterns.slice(1).filter((p,i)=>p===eventPatterns[i]).length/Math.max(1,eventPatterns.length);
  const warnings=[];
  if(analysis.bpmConfidence<.3)warnings.push('BPM estimate has low confidence; adjust tempo and offset if the grid drifts.');
  const inferredBpm=analysis.bpm||bpm,alternatives=(analysis.tempoCandidates||[]).filter(c=>c.bpm!==inferredBpm),doubleTime=alternatives.find(c=>c.relativeScore>=.65&&Math.abs(c.bpm-inferredBpm*2)<=Math.max(5,inferredBpm*.04)),halfTime=alternatives.find(c=>c.relativeScore>=.65&&Math.abs(c.bpm-inferredBpm/2)<=Math.max(3,inferredBpm*.025)),ambiguous=doubleTime||halfTime,alternateBpm=doubleTime?Math.round(inferredBpm*2):Math.round(inferredBpm/2);
  if(ambiguous&&bpmOverride===undefined)warnings.push(`Possible half-time/double-time ambiguity: ${inferredBpm} BPM and about ${alternateBpm} BPM both score plausibly. Confirm the grid or set BPM manually.`);
  if(unique.length<20)warnings.push('Sparse chart: source may be quiet or confidence threshold may be high.');
  if(validation.warnings.length)warnings.push(`${validation.warnings.length} chart quality warning(s) remain.`);
  if(!selected.length)warnings.push('No confident audio candidates survived selection; fallback notes were used.');
  const laneDistribution=[0,0,0,0];for(const note of unique)laneDistribution[note.lane]++;
  return {chart,diagnostics:{bpm,bpmConfidence:analysis.bpmConfidence,gridConfidence:analysis.gridConfidence,tempoCandidates:analysis.tempoCandidates||[],candidateCount:candidates.length,selectedCount:selected.length,rejectedCount:Math.max(0,candidates.length-selected.length),noteCount:unique.length,holdCount,notesPerSecond:unique.length/Math.max(.001,analysis.durationMs/1000),peakLocalDensity:peak,subdivisionDistribution:subdivisions,chordRatio:unique.length?chordCount/unique.length:0,laneDistribution,patternVariety:Math.max(motifNames.size,new Set(eventPatterns).size),patternNames:[...motifNames],repetitionRate:repetition,validationErrors:validation.errors.length,warnings,generationMs:Math.max(0,performance.now()-started)}};
}
export function generateAllDifficulties(analysis,title,seed=1337,overrides={}){return DIFFICULTIES.map((difficulty,i)=>generateChart(analysis,title,{...overrides,difficulty,seed:(seed+i*7919)>>>0}));}
export function demoAnalysis(){const bpm=120,period=60000/bpm,durationMs=24000,features=Array.from({length:2400},(_,i)=>{const timeMs=i*10,p=((timeMs%period)+period)%period,kick=Math.exp(-p/33),cp=((timeMs%(period*2))+period*2)%(period*2),clap=Math.exp(-Math.abs(cp-period)/26),rms=.08+.26*kick+.16*clap+.035*Math.sin(timeMs/1900);return {timeMs,onset:clamp((kick*.7+clap*.4)*(timeMs%1500<80?.4:1)),rms,low:rms*.72,mid:rms*.43,high:rms*.3,centroid:.48};}),candidates=features.filter((f,i)=>i%12===0).map(f=>{const d=Math.min(f.timeMs%period,period-f.timeMs%period),beatAlignment=clamp(1-d/(period*.25));return {...f,confidence:.45+f.onset*.4,onsetStrength:f.onset,beatAlignment,subdivision:(Math.round(f.timeMs/(period/4))%4===0?'beat':Math.round(f.timeMs/(period/4))%2===0?'eighth':'sixteenth'),localEnergy:f.rms,score:f.onset*.5+f.rms*.4+beatAlignment*.1};});return {durationMs,sampleRate:44100,bpm,bpmConfidence:.99,beatOffsetMs:0,gridConfidence:.99,features,candidates,sections:[6000,12000,18000]};}
export function createDemoCharts(){const durationMs=24000,bpm=120,beat=500,profiles={easy:{step:1,chord:0,skip:3,rating:2.1,holdEvery:23},normal:{step:.5,chord:8,skip:5,rating:4.4,holdEvery:15},hard:{step:.5,chord:5,skip:0,rating:7.2,holdEvery:11},expert:{step:.25,chord:4,skip:0,rating:9.5,holdEvery:9}},all=[];for(const difficulty of DIFFICULTIES){const p=profiles[difficulty],notes=[];let idx=0,lastLane=1;for(let t=1000;t<durationMs-300;t+=beat*p.step){const step=Math.round((t-1000)/(beat*p.step));if(p.skip&&step%p.skip===2)continue;const pulse=Math.round(t/beat),phrase=Math.floor(t/(beat*8));let lane=(pulse+(phrase%2)+(step%3===0?1:0))%4;if(lane===lastLane&&step%2===0)lastLane=(lane+1+step%3)%4;else lastLane=lane;const timeMs=Math.round(t+(step%7===5&&difficulty!=='easy'?18:0));notes.push({id:`demo-${difficulty}-${String(idx++).padStart(4,'0')}`,timeMs,lane:lastLane,type:'tap'});if(p.chord&&step%p.chord===p.chord-1&&t>3500&&t<22000)notes.push({id:`demo-${difficulty}-${String(idx++).padStart(4,'0')}`,timeMs,lane:(lastLane+2)%4,type:'tap'});}notes.sort((a,b)=>a.timeMs-b.timeMs||a.lane-b.lane);for(let ni=0;ni<notes.length;ni++){const note=notes[ni];if(ni%p.holdEvery!==Math.floor(p.holdEvery*.42))continue;let nextSame=Infinity;for(let nj=ni+1;nj<notes.length;nj++)if(notes[nj].lane===note.lane){nextSame=notes[nj].timeMs;break;}const nominal=beat*(difficulty==='easy'?1.5:2+(ni%3)*.5),endTimeMs=Math.min(note.timeMs+nominal,durationMs-100,nextSame-90);if(endTimeMs-note.timeMs>=beat*.72){note.type='hold';note.endTimeMs=Math.round(endTimeMs);}}const chart={schemaVersion:1,chartId:`forge-demo-${difficulty}-v1`,metadata:{title:'NEON CIRCUIT',artist:'Rhythm Forge Original Demo',audioDurationMs:durationMs,bpm,offsetMs:1000,difficulty,difficultyRating:p.rating},generator:{engineVersion:'0.1.0',seed:42,profileId:`demo-${difficulty}`,sourceFingerprint:'original-synthetic-demo-v1'},notes},v=validateChart(chart),lanes=[0,0,0,0];for(const n of notes)lanes[n.lane]++;all.push({chart,diagnostics:{bpm,bpmConfidence:.99,gridConfidence:.99,candidateCount:Math.round(notes.length*1.25),selectedCount:notes.length,rejectedCount:Math.round(notes.length*.25),noteCount:notes.length,holdCount:notes.filter(n=>n.type==='hold').length,notesPerSecond:notes.length/24,peakLocalDensity:Math.max(0,...notes.map(n=>notes.filter(x=>Math.abs(x.timeMs-n.timeMs)<=1000).length)),subdivisionDistribution:{beat:notes.filter(n=>Math.abs(n.timeMs/beat-Math.round(n.timeMs/beat))<.03).length,'off-beat':notes.filter(n=>Math.abs(n.timeMs/beat-Math.round(n.timeMs/beat))>=.03).length},chordRatio:notes.length?notes.filter((n,i)=>i>0&&notes[i-1].timeMs===n.timeMs).length/notes.length:0,laneDistribution:lanes,patternVariety:5,repetitionRate:.18,validationErrors:v.errors.length,warnings:v.warnings.map(w=>w.message),generationMs:0}});}return all;}
export const JUDGEMENT_TIERS = [
  { key: 'marvelous', label: 'MARVELOUS', windowMs: 45, score: 1000, accuracy: 1 },
  { key: 'perfect', label: 'PERFECT', windowMs: 70, score: 950, accuracy: .97 },
  { key: 'great', label: 'GREAT', windowMs: 100, score: 800, accuracy: .85 },
  { key: 'good', label: 'GOOD', windowMs: 135, score: 600, accuracy: .65 },
  { key: 'ok', label: 'OK', windowMs: 170, score: 350, accuracy: .4 },
  { key: 'bad', label: 'BAD', windowMs: 220, score: 100, accuracy: .15 },
  { key: 'miss', label: 'MISS', windowMs: Infinity, score: 0, accuracy: 0 },
];
export function judgeDelta(delta){
  const d=Math.abs(delta);
  return JUDGEMENT_TIERS.find(t=>d<=t.windowMs)?.key||'miss';
}
export function accuracyFor(counts){
  const tiers=JUDGEMENT_TIERS;
  const total=tiers.reduce((sum,t)=>sum+(counts[t.key]||0),0);
  return total?tiers.reduce((sum,t)=>sum+(counts[t.key]||0)*t.accuracy,0)/total*100:100;
}
export function gradeFor(accuracy,misses){if(accuracy>=99)return'SS';if(accuracy>=95)return'S';if(accuracy>=90)return'A';if(accuracy>=80)return'B';if(accuracy>=70)return'C';return'D';}
