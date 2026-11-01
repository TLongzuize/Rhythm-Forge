import { analyzeSamples, analyzeSamplesIncremental } from './core.js';
self.onmessage = async event => {
  try {
    const job = event.data || {}, samples = new Float32Array(job.samples);
    if (job.incremental) {
      const result = await analyzeSamplesIncremental(samples, job.sampleRate, { onProgress: progress => self.postMessage({ progress }) });
      self.postMessage({ analysis: result.analysis, incrementalStats: result.stats });
    } else self.postMessage({ analysis: analyzeSamples(samples, job.sampleRate) });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Audio analysis failed.' }); }
};
