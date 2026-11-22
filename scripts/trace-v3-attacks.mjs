import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { analyzeSamples, generateChart } from '../core.js';
import { generateRfV2 } from '../rfgen-v2.js';
import { analyzeV3, interpretTimeline } from '../v3/timeline.js';
import { generateV3 } from '../v3/engine.js';
import { compareAttacks, matchAttacks } from './onset-matching.mjs';

const [oggDir, output, ...tracks] = process.argv.slice(2);
assert.ok(oggDir && output, 'Supply the reference Ogg directory and output JSON.');
const json = path => JSON.parse(readFileSync(path));
const directory = 'benchmarks/v3-event-validation';
const { cuts } = json(join(directory,'reference.json'));
const networks = json(join(directory,'networks.json')).rows;
const polyphony = json(join(directory,'polyphony.json')).rows;
const files = new Map(json('benchmarks/v3-player-acceptance/exports/results.json').rows.map(r => [r.track,r.filename]));
files.set('no-no-no','TheFatRat - No No No.mp3');
files.set('abnormal','FUNK ABNORMAL (Slowed) - DJ V12.mp3');
const rows = [];
for (const [track, filename] of files) {
  if (tracks.length && !tracks.includes(track)) continue;
  const path = join(filename.endsWith('.ogg') ? oggDir : 'audio_file_to_test', filename);
  const pcm = execFileSync('ffmpeg',['-v','error','-i',path,'-ac','1','-ar','22050','-f','f32le','-'],{maxBuffer:64e6});
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length/4);
  const raw = [];
  const analysis = analyzeV3(samples, 22050, undefined, raw);
  const timeline = interpretTimeline(analysis);
  const legacy = analyzeSamples(samples,22050);
  const opts = { difficulty:'expert', mode:'balanced', densityScale:1, seed:25094 };
  const v1 = generateChart(legacy,track,opts).chart, v2 = generateRfV2(legacy,track,opts).chart;
  const before = generateV3(timeline,track,{ ...opts, compositionRevision:'phrase-1', traceEvents:true });
  const after = generateV3(timeline,track,{ ...opts, traceEvents:true });
  for (const cut of cuts.filter(c => c.track === track)) {
    assert.equal(createHash('sha256').update(pcm).digest('hex'), cut.pcmSha256);
    const inside = t => t >= cut.start*1000 && t < cut.end*1000;
    const external = networks.find(r => r.track === track && r.start === cut.start);
    const pitchedGroups = polyphony.find(r => r.track === track && r.start === cut.start).groups;
    const references = { networkAgreement:external.agreement, rnn:external.rnn, cnn:external.cnn,
      dspAgreement: cut.cues.filter(c => c.evidence === 'agreement').map(c => c.ms),
      uncertainDSP: cut.cues.filter(c => c.evidence !== 'agreement').map(c => c.ms) };
    const coverage = {}, matched = {};
    const layouts = { v1, v2, phrase:before.chart, spectral:after.chart };
    const headTimes = {};
    for (const [name,chart] of Object.entries(layouts)) {
      const notes = chart.notes.filter(n => inside(n.timeMs));
      const heads = [...new Set(notes.map(n => n.timeMs))];
      headTimes[name] = heads;
      matched[name] = new Set(matchAttacks(heads,references.networkAgreement,25).map(([,j]) => j));
      const chordTimes = [...Map.groupBy(notes,n=>n.timeMs)].filter(([,keys])=>keys.length>1).map(([t])=>t);
      coverage[name] = { pitchModelChords:compareAttacks(chordTimes,pitchedGroups.filter(g=>g.pitches.length>=2).map(g=>g.ms),25), notes:notes.length, heads:heads.length, chordKeys:notes.length-heads.length,
        references:Object.fromEntries(Object.entries(references).map(([id,times]) =>
          [id,compareAttacks(heads,times,25)])) };
    }
    const decisions = lineage => lineage.filter(c => inside(c.refinedMs));
    const lineage = decisions(after.diagnostics.lineage), priorLineage = decisions(before.diagnostics.lineage);
    const productionRaw = raw.filter(c => inside(c.sourceMs));
    const classify = (time, rows, source) => {
      const near = rows.filter(e => Math.abs(e.refinedMs-time) <= 25 && e.decision !== 'difficulty-or-mode')
        .sort((a,b) => Math.abs(a.refinedMs-time)-Math.abs(b.refinedMs-time));
      if (near.some(x => x.final.length)) return 'one-to-one-match-conflict';
      if (near.length) return near[0].decision;
      return source?.some(r => Math.abs(r.sourceMs-time) <= 25) ? 'raw-peak-without-candidate' : 'no-candidate';
    };
    const referenceEvents = references.networkAgreement.map((time,j) => ({ time,
      v2:matched.v2.has(j), phrase:matched.phrase.has(j), spectral:matched.spectral.has(j),
      ...(!matched.phrase.has(j) && { phraseMiss:classify(time,priorLineage) }),
      ...(!matched.spectral.has(j) && { spectralMiss:classify(time,lineage,productionRaw) }) }));
    // A second ledger reconciles the two charts without assuming either chart is right.
    const pairs = matchAttacks(headTimes.v2,headTimes.phrase,25);
    const used = new Set(pairs.map(([i]) => i));
    const v2Only = headTimes.v2.flatMap((time,i) => used.has(i) ? [] :
      [{time, phraseMiss:classify(time,priorLineage), networkNearby:references.networkAgreement.some(t=>Math.abs(t-time)<=25)}]);
    rows.push({track,start:cut.start,end:cut.end,sourceSha256:cut.sourceSha256,pcmSha256:cut.pcmSha256,coverage,
      referenceEvents,sharedV2PhraseHeads:pairs.length,v2Only,
      ...(track === 'galaxy' && cut.start === 200 ? {lineage, priorLineage, raw:productionRaw} : {})});
  }
}
writeFileSync(output, JSON.stringify({sampleRate:22050,settings:{difficulty:'expert', seed:25094, mode:'balanced',densityScale:1},rows})+'\n');
