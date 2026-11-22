import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { analyzeSamples, generateChart } from '../core.js';
import { generateRfV2 } from '../rfgen-v2.js';
import { generateV3 } from '../v3/engine.js';
import { analyzeV3, interpretTimeline } from '../v3/timeline.js';
import { matchAttacks, compareAttacks } from './onset-matching.mjs';

const [folder, ...splits] = process.argv.slice(2);
assert.ok(splits.length && folder);
const output = [];
for (const split of splits) {
  const wav = join(folder, split+'.wav'), midi = join(folder, split+'.midi');
  const { source, notes } = JSON.parse(readFileSync(join(folder,split+'.json')));
  const groups = [];
  for (const n of notes) {
    if (!groups.length || n.startMs-groups.at(-1).time > 25) groups.push({time:n.startMs, notes:[]});
    groups.at(-1).notes.push(n);
  }
  const bytes = execFileSync('ffmpeg',['-v','error','-i',wav,'-ac','1','-ar','22050','-f','f32le','-'],{maxBuffer:24e6});
  const pcm = new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
  const tl = interpretTimeline(analyzeV3(pcm,22050));
  const legacy = analyzeSamples(pcm,22050);
  const opts = { difficulty:'expert',mode:'balanced',densityScale:1,seed:25094 };
  const charts = { v1:generateChart(legacy,split,opts).chart, v2:generateRfV2(legacy,split,opts).chart,
    phrase:generateV3(tl,split,{...opts, compositionRevision:'phrase-1'}).chart,
    spectral:generateV3(tl,split,opts).chart };
  const stats = {};
  for (const [key,c] of Object.entries(charts)) {
    const byTime = Map.groupBy(c.notes, n => n.timeMs);
    const heads = [...byTime.keys()], chords = heads.filter(t=>byTime.get(t).length > 1);
    const measuredChords = groups.filter(g=>g.notes.length>1);
    const paired = matchAttacks(heads,groups.map(g=>g.time),25);
    const matchedChordHeads = paired.filter(([,j]) => groups[j].notes.length > 1);
    const correctWidth = matchedChordHeads.filter(([i]) => byTime.get(heads[i]).length > 1);
    const releaseErrors = [];
    for (const [i,j] of paired) for (const n of byTime.get(heads[i])) {
      if (n.type === 'hold') releaseErrors.push(Math.min(...groups[j].notes.map(ref=>Math.abs(ref.keyUpMs-n.endTimeMs))));
    }
    releaseErrors.sort((a,b)=>a-b);
    stats[key] = { heads:compareAttacks(heads,groups.map(g=>g.time),25),
      chords:compareAttacks(chords,measuredChords.map(g=>g.time),25),
      matchedChordHeads:matchedChordHeads.length, voicedMatchedChords:correctWidth.length,
      holds:c.notes.filter(n=>n.type==='hold').length, releaseAgainstKeyUpMs:releaseErrors };
  }
  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  output.push({split,source,wavSha256:hash(wav),midiSha256:hash(midi),stats});
}
console.log(JSON.stringify(output,null,2));
