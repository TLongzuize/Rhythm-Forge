import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

test('standalone bundle binds every core dependency and can build a tempo map', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rhythm-forge-bundle-'));
  try {
    const htmlPath = join(dir, 'standalone.html');
    execFileSync('python3', ['scripts/build-artifact.py', htmlPath], { stdio: 'pipe', timeout: 30000 });
    const html = readFileSync(htmlPath, 'utf8');
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    assert.ok(html.includes(`<meta name="application-version" content="${version}" />`));
    assert.doesNotMatch(html, /rf-generator-v[23]\.mp4|rf-intro-dialog|data:video\/mp4;base64/);
    const orbitron = html.match(/@font-face\s*\{[^}]*font-family: 'Orbitron'[^}]*data:font\/woff2;base64,([A-Za-z0-9+/=]+)/);
    assert.ok(orbitron, 'standalone gameplay must load Orbitron offline');
    assert.deepEqual(Buffer.from(orbitron[1], 'base64'), readFileSync('public/fonts/orbitron-latin.woff2'));
    assert.ok(html.includes('SIL OPEN FONT LICENSE'), 'the embedded font must include its license');
    const match = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
    assert.ok(match, 'classic inline script must exist so standalone works from file://');
    const script = match[1].replace(/<\\\/script/g, '</script');
    assert.match(script, /const \{[^}]*\binferTempo\s*\}=RF;/, 'inferTempo must be injected into flattened modules');
    assert.doesNotMatch(script, /^\s*import\s+.*from\s+/m, 'standalone script must not depend on external module imports');
    assert.doesNotMatch(script, /^\s*export\s+/m, 'standalone script must not contain module exports');
    assert.match(html, /rf-boot-fallback/, 'a visible fallback must be present before application startup');
    assert.match(script, /Paint the application shell immediately/, 'the app must render before waiting for IndexedDB');
    assert.match(script, /file:\/\/ and privacy-restricted contexts may disable localStorage/, 'settings persistence must tolerate blocked localStorage');
    assert.match(script, /data-action="set-gen-mode"/, 'mode cards must use the live selection action');
    assert.match(html, /\.gen-mode-grid\s*\{/, 'mode card styling must be embedded in the standalone HTML');
    assert.match(script, /osu-menu lz-menu open/, 'the home action strip must be visible on first launch');

    const appStart = script.indexOf("const root = document.querySelector('#root');");
    assert.ok(appStart > 0, 'app entrypoint marker must exist');
    const modulePreamble = script.slice(0, appStart);
    const smoke = `
      const features = Array.from({length: 1400}, (_, i) => ({
        timeMs: i * 10,
        onset: i % 50 === 0 ? 1 : (i % 50 === 1 ? .12 : 0),
        rms: i % 50 === 0 ? .3 : .01,
        low: i % 50 === 0 ? .2 : 0,
        mid: .01, high: .01, centroid: .1
      }));
      const map = buildTempoMap({ durationMs: 14000, bpm: 120, bpmConfidence: .8, beatOffsetMs: 0, features });
      if (!map?.segments?.length) throw new Error('Tempo map did not contain any segments');
      globalThis.__rfStandaloneSmoke = map.segments[0].bpm;
    `;
    const context = { console, performance, setTimeout, clearTimeout, Date, Math, Map, Set, Uint8Array, Float32Array, ArrayBuffer, DataView, Blob, URL, TextEncoder, TextDecoder };
    vm.runInNewContext(`${modulePreamble}\n${smoke}`, context, { timeout: 20000 });
    assert.ok(Math.abs(context.__rfStandaloneSmoke - 120) < 3, `expected 120 BPM, received ${context.__rfStandaloneSmoke}`);

    const worker = script.match(/new Blob\(\[("(?:\\.|[^"\\])*")\],\{type:'text\/javascript'\}\)/);
    assert.ok(worker, 'standalone must embed a classic V3 worker');
    const messages = [];
    const self = { postMessage: message => messages.push(message) };
    const pcm = new Float32Array(22050);
    for (let i = 1000; i < 1500; i++) pcm[i] = Math.sin(i / 7) * 0.5;
    vm.runInNewContext(JSON.parse(worker[1]), { self, performance }, { timeout: 20000 });
    self.onmessage({ data: { samples:pcm.buffer, sampleRate:22050, title:'Embedded worker', opts:{} } });
    const finished = messages.at(-1);
    assert.equal(finished?.error, undefined);
    assert.equal(finished?.results?.length, 4);
    assert.ok(finished.results[0].chart.notes.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
