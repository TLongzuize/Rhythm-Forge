let cachedSource = null,
  cachedAnalysis = null,
  decodeQueue = Promise.resolve();

function makeV3Worker() {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}

function checkV3Abort(signal) {
  if (signal.aborted) throw signal.reason || Error('V3 generation cancelled.');
}

async function decodeV3(file, signal, compact) {
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Offline) throw Error('V3 requires a browser with offline Web Audio decoding.');
  if (!file?.size || file.size > (compact ? 64 : 192) * 1024 * 1024)
    throw Error('This audio file exceeds the V3 decode budget or is empty.');
  const bytes = await file.arrayBuffer();
  checkV3Abort(signal);
  const decoder = new Offline(1, 1, 22050);
  const audio = await decoder.decodeAudioData(bytes);
  checkV3Abort(signal);
  if (
    audio.duration > (compact ? 900 : 1800) ||
    audio.length * audio.numberOfChannels * 4 > (compact ? 128 : 384) * 1024 * 1024
  )
    throw Error('The decoded song exceeds the V3 memory budget on this device.');
  // Web Audio performs resampling and speaker downmix outside the UI JS loop.
  if (audio.numberOfChannels === 1) return audio.getChannelData(0);
  const mixer = new Offline(1, audio.length, audio.sampleRate);
  const source = mixer.createBufferSource();
  source.buffer = audio;
  source.connect(mixer.destination);
  source.start();
  const rendered = await mixer.startRendering();
  checkV3Abort(signal);
  const mono = rendered.getChannelData(0);
  if (audio.numberOfChannels === 2) {
    // An inverted stereo pair can disappear in a speaker downmix. Compare
    // bounded samples across the recording before transferring a channel.
    const left = audio.getChannelData(0), right = audio.getChannelData(1);
    let mixPower = 0, leftPower = 0, rightPower = 0;
    const stride = Math.max(1, Math.floor(mono.length / 8192));
    for (let i = 0; i < mono.length; i += stride) {
      mixPower += mono[i]*mono[i];
      leftPower += left[i]*left[i];
      rightPower += right[i]*right[i];
    }
    if (mixPower < .015*Math.max(leftPower,rightPower))
      return leftPower >= rightPower ? left : right;
  }
  return mono;
}

export async function runV3(file, title, opts, signal, onProgress = () => {}, sourceKey = file) {
  checkV3Abort(signal);
  if (typeof Worker === 'undefined') throw Error('V3 requires Web Workers. Choose V1 or V2 in this browser.');
  const compact =
    (globalThis.navigator?.deviceMemory ?? 8) <= 4 || (globalThis.navigator?.hardwareConcurrency ?? 8) <= 4;
  const worker = makeV3Worker();
  return new Promise((resolve, reject) => {
    let finished = false;
    function finish(value, failed = false) {
      if (finished) return;
      finished = true;
      worker.terminate();
      signal.removeEventListener('abort', abort);
      if (failed) reject(value);
      else resolve(value);
    }
    const abort = () => finish(signal.reason || Error('V3 generation cancelled.'), true);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => finish(Error(event.message || 'The V3 worker could not start.'), true);
    worker.onmessageerror = () => finish(Error('The V3 worker returned unreadable data.'), true);
    worker.onmessage = ({ data }) => {
      if (finished) return;
      if (Number.isFinite(data.progress)) {
        onProgress(data.progress);
        return;
      }
      if (data.error) {
        finish(Error(data.error), true);
        return;
      }
      if (data.analysis) {
        cachedSource = sourceKey;
        cachedAnalysis = data.analysis;
      }
      finish(data.results);
    };
    (async () => {
      const job = { title, opts: { ...opts, resourceClass: compact ? 'compact' : 'standard' } };
      if (cachedSource === sourceKey && cachedAnalysis) job.analysis = cachedAnalysis;
      else {
        // Native decode cannot be interrupted. Serialize retries and discard a
        // cancelled decode before any features are extracted or results applied.
        const decoded = decodeQueue.then(() => {
          checkV3Abort(signal);
          if (finished) throw Error('V3 worker closed before audio decode.');
          return decodeV3(file, signal, compact);
        });
        decodeQueue = decoded.then(
          () => {},
          () => {}
        );
        const samples = await decoded;
        job.samples = samples.buffer;
        job.sampleRate = 22050;
      }
      checkV3Abort(signal);
      if (!finished) worker.postMessage(job, job.samples ? [job.samples] : []);
    })().catch((error) => finish(error, true));
  });
}
