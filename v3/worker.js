import { analyzeV3 } from './timeline.js';
import { validateChart } from '../core.js';
import { generateV3Set } from './engine.js';

self.onmessage = ({ data }) => {
  try {
    const progress = (value) => self.postMessage({ progress: value });
    const analysis =
      data.analysis ||
      analyzeV3(new Float32Array(data.samples), data.sampleRate, (fraction) => progress(20 + 55 * fraction));
    progress(78);
    const opts = { ...data.opts };
    // Older clients may send an effort preference. The application worker
    // always uses the current automatic policy.
    delete opts.effort;
    const results = generateV3Set(analysis, data.title, opts, (fraction) =>
      progress(78 + 21 * fraction)
    );
    for (const { chart, diagnostics } of results) {
      const validation = validateChart(chart);
      if (!validation.valid) throw Error(validation.errors[0].message);
      if (diagnostics.report.counts.collisions) throw Error('V3 produced a lane collision.');
      if (diagnostics.report.counts.releaseConflicts) throw Error('V3 produced a press too close to a hold release.');
    }
    self.postMessage({ results, analysis: data.analysis ? undefined : analysis });
  } catch (error) {
    self.postMessage({ error: error.message || 'V3 generation failed.' });
  }
};
