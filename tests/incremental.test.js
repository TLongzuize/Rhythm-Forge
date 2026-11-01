import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSamples, analyzeSamplesIncremental } from '../core.js';
import { createFeatureChunkCache, memoryStore } from '../cache.js';
import { synthClicks } from './helpers.js';

test('incremental analysis: khớp full analysis, cache hit và chỉ tính lại chunk bị thay đổi', async () => {
  const source = synthClicks({ segments: [{ bpm: 120, ms: 40000 }], startMs: 230, sr: 22050 });
  const cache = createFeatureChunkCache({ store: memoryStore() });
  const full = analyzeSamples(source.samples, source.sr);
  const first = await analyzeSamplesIncremental(source.samples, source.sr, { chunkMs: 10000, contextMs: 500, cache });
  assert.equal(first.stats.chunks, 5);
  assert.equal(first.stats.computedChunks, 5);
  assert.equal(first.stats.cacheHits, 0);
  assert.equal(first.analysis.features.length, full.features.length);
  assert.ok(Math.abs(first.analysis.bpm - full.bpm) < .1, `incremental=${first.analysis.bpm} full=${full.bpm}`);
  for (let i = 0; i < full.features.length; i += 97) {
    assert.ok(Math.abs(first.analysis.features[i].timeMs - full.features[i].timeMs) < 1e-8);
    assert.ok(Math.abs(first.analysis.features[i].onset - full.features[i].onset) < 1e-6);
    assert.ok(Math.abs(first.analysis.features[i].rms - full.features[i].rms) < 1e-6);
  }

  const second = await analyzeSamplesIncremental(source.samples, source.sr, { chunkMs: 10000, contextMs: 500, cache });
  assert.equal(second.stats.cacheHits, 5);
  assert.equal(second.stats.computedChunks, 0);

  const edited = source.samples.slice();
  const editAt = Math.round(14500 / 1000 * source.sr);
  for (let i = 0; i < Math.round(.03 * source.sr); i++) edited[editAt + i] += .5 * Math.sin(2 * Math.PI * 900 * i / source.sr) * Math.exp(-i / (.006 * source.sr));
  const third = await analyzeSamplesIncremental(edited, source.sr, { chunkMs: 10000, contextMs: 500, cache });
  assert.equal(third.stats.chunks, 5);
  assert.ok(third.stats.computedChunks >= 1 && third.stats.computedChunks < 5, JSON.stringify(third.stats));
  assert.ok(third.stats.cacheHits >= 1, JSON.stringify(third.stats));
});
