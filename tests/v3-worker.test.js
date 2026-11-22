import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runV3 } from '../v3/client.js';

test('cancellation terminates the worker and a queued stale reply cannot overwrite cached features', async (t) => {
  const workers = [];
  let decodes = 0;
  class FakeWorker {
    constructor() {
      workers.push(this);
    }
    terminate() {
      this.stopped = true;
    }
    postMessage(job) {
      this.job = job;
    }
    reply(data) {
      this.onmessage({ data });
    }
  }
  const originalWorker = globalThis.Worker,
    originalOffline = globalThis.OfflineAudioContext;
  t.after(() => {
    if (originalWorker) globalThis.Worker = originalWorker;
    else delete globalThis.Worker;
    if (originalOffline) globalThis.OfflineAudioContext = originalOffline;
    else delete globalThis.OfflineAudioContext;
  });
  globalThis.Worker = FakeWorker;
  globalThis.OfflineAudioContext = class {
    decodeAudioData() {
      decodes++;
      return {
        duration: 1,
        length: 22050,
        numberOfChannels: 1,
        getChannelData: () => new Float32Array(22050)
      };
    }
  };
  const file = new Blob(['test-input']);
  const first = new AbortController(),
    second = new AbortController(),
    progress = [];
  const old = runV3(file, 'old', {}, first.signal);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(workers[0].job.samples);
  first.abort();
  await assert.rejects(old, { name: 'AbortError' });
  assert.equal(workers[0].stopped, true);
  const current = runV3(file, 'new', {}, second.signal, (p) => progress.push(p));
  await new Promise((resolve) => setImmediate(resolve));
  workers[1].reply({ progress: 82 });
  workers[1].reply({ analysis: { id: 'new' }, results: ['new'] });
  assert.deepEqual(await current, ['new']);
  workers[0].reply({ analysis: { id: 'obsolete' }, results: ['obsolete'] });
  const repeated = runV3(file, 'again', {}, second.signal);
  assert.deepEqual(workers[2].job.analysis, { id: 'new' });
  assert.equal(decodes, 2);
  workers[2].onerror({ message: 'worker crashed' });
  await assert.rejects(repeated, /worker crashed/);
  assert.equal(workers[2].stopped, true);
  assert.deepEqual(progress, [82]);
});

test('missing worker capability is an actionable error before decoding', async () => {
  const saved = globalThis.Worker;
  try {
    delete globalThis.Worker;
    await assert.rejects(
      runV3(new Blob(['pcm']), '', {}, new AbortController().signal),
      /requires Web Workers/
    );
  } finally {
    if (saved) globalThis.Worker = saved;
  }
});

test('worker ignores obsolete effort options while reusing analysis and reporting progress', async () => {
  const { analyzeV3 } = await import('../v3/timeline.js');
  const { generateV3Set } = await import('../v3/engine.js');
  const previous = globalThis.self;
  const messages = [];
  globalThis.self = { postMessage: message => messages.push(message) };
  try {
    await import('../v3/worker.js');
    const analysis = analyzeV3(new Float32Array(22050), 22050);
    const opts = { effort:'max', difficulty:'expert', seed:27, resourceClass:'compact' };
    self.onmessage({data:{analysis,title:'Silence',opts}});
    assert.equal(opts.effort, 'max');
    assert.deepEqual(messages.slice(0,2), [{progress:78},{progress:99}]);
    assert.equal(messages.at(-1).analysis, undefined);
    const [result] = messages.at(-1).results;
    assert.deepEqual(result.chart,
      generateV3Set(analysis,'Silence',{difficulty:'expert',seed:27,resourceClass:'compact'})[0].chart);
    assert.equal(result.chart.generator.policyRevision,'automatic-1');
    assert.equal(Object.hasOwn(result.chart.generator,'effort'),false);
  } finally {
    if (previous === undefined) delete globalThis.self;
    else globalThis.self = previous;
  }
});
