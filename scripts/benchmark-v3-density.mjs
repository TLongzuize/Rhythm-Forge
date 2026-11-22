import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateChart } from '../core.js';
import { analyzeV3, interpretTimeline } from '../v3/timeline.js';
import { composeV3, V3_PROFILES } from '../v3/composer.js';
import { generateV3 } from '../v3/engine.js';

const [phase, split, referenceDir, baselinePath] = process.argv.slice(2);
assert.ok(['before','after'].includes(phase) && ['development','held-out'].includes(split));
const manifest = JSON.parse(readFileSync('research/pattern-grammar/benchmark.json'));
const development = new Set(['galaxy','unity','mutilator']);
const settings = {mode:'balanced', resourceClass:'standard', compositionRevision:'event-1'};
const densities = [.55,.75,1,1.2,1.45];
const sha = input => createHash('sha256').update(input).digest('hex');
const rows = [];
let traceCompose;
if (phase==='before') {
  // Trace the frozen legacy path without changing production or counting an
  // event in several rejection categories.
  const source = readFileSync('v3/composer.js','utf8')
    .replace('const eligible = rank >= threshold * (supported ? 0.72 : 1) && e.timeMs - previousTime >= gap;',
      `const validRank = rank >= threshold * (supported ? 0.72 : 1);
       const eligible = validRank && e.timeMs - previousTime >= gap;
       globalThis.densityTrace.set(e,{stage:!validRank?'rank':!eligible?'transition':'objective',gap});`)
    .replace('  return selected.reverse();',`  const picked = selected.reverse();
      let next = 0;
      for (const {e} of group) {
        while (picked[next]?.timeMs < e.timeMs) next++;
        const row = globalThis.densityTrace.get(e);
        if (row.stage !== 'objective') continue;
        if (picked[next] === e) row.stage = 'attempted';
        else if (e.timeMs-(picked[next-1]?.timeMs ?? -Infinity)<row.gap ||
          (picked[next]?.timeMs ?? Infinity)-e.timeMs<(globalThis.densityTrace.get(picked[next])?.gap ?? 0))
          row.stage = 'spacing';
      }
      return picked;`)
    .replace('    const sustain = Math.min',`    globalThis.densityTrace.set(e,{stage:e.confidence < minConfidence?'confidence':'rank'});
      const sustain = Math.min`)
    .replace('      if (!technical && e.timeMs - lastTime >= spacing && selected.every((x) => Math.abs(x.timeMs - e.timeMs) >= spacing))\n        selected.push(e);',
      `      if (!technical) {
        const row = globalThis.densityTrace.get(e);
        if (e.timeMs-lastTime<spacing) row.stage='transition';
        else if (selected.some(x=>Math.abs(x.timeMs-e.timeMs)<spacing)) row.stage='spacing';
        else { selected.push(e); row.stage='attempted'; }
      }`)
    .replace('      if (!lanes.length) continue;',`      const tracked=globalThis.densityTrace.get(e);
      if (!lanes.length) { tracked.stage='occupancy'; continue; }
      tracked.stage='head';`)
    .replace("      const opposite = lanes.find((l) => l >> 1 !== lane >> 1);",`      const opposite = lanes.find((l) => l >> 1 !== lane >> 1);
      tracked.chord = !p.chord || mode==='relax' ? 'disabled' : !accents.has(e) ? 'accent' :
        opposite === undefined ? 'lane' : note.type==='hold' ? 'hold' :
        t-lastChord<e.period*(difficulty==='expert'?1:2) ? 'cooldown' :
        technical && (selected[j+1]?.timeMs ?? Infinity)-e.timeMs<p.laneGap ? 'lookahead' : 'added';`);
  traceCompose=(await import('data:text/javascript,'+encodeURIComponent(source))).composeV3;
}
const baseline=phase==='after'?JSON.parse(readFileSync(baselinePath,'utf8')):null;
for(const track of manifest.filter(t=>development.has(t.id)===(split==='development'))){
  const file=track.reference?join(referenceDir,track.id+'.ogg'):
    join('audio_file_to_test',readdirSync('audio_file_to_test').find(f=>f.startsWith(track.prefix)));
  const recordingSha=sha(readFileSync(file));
  const bytes=execFileSync('ffmpeg',['-v','error','-i',file,'-ac','1','-ar','22050','-f','f32le','-'],
    {maxBuffer:64*1024*1024});
  const analysis=analyzeV3(new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4),22050);
  const timeline=interpretTimeline(analysis);
  const byTime=new Map(timeline.events.map(e=>[Math.round(e.timeMs),e]));
  for(const difficulty of Object.keys(V3_PROFILES)){
    const seed=1337+Object.keys(V3_PROFILES).indexOf(difficulty)*7919;
    const opts={...settings,difficulty,seed};
    const core=generateV3(timeline,track.id,opts).chart;
    const coreHeads=new Set(core.notes.map(n=>n.timeMs));
    const coreAttacks=timeline.events.filter(e=>e.salience>=.35 && e.confidence>=.25 &&
      coreHeads.has(Math.round(e.timeMs)));
    let previousDetail;
    for(const densityScale of densities){
      const input={...opts,densityScale};
      const {chart,diagnostics}=generateV3(timeline,track.id,input);
      const {valid,warnings}=validateChart(chart);
      assert.ok(valid && diagnostics.report.counts.collisions===0);
      assert.deepEqual(generateV3(timeline,track.id,input).chart,chart);
      const noteHash=sha(JSON.stringify(chart.notes));
      if(phase==='after' && densityScale===1){
        const old=baseline.rows.find(r=>r.song===track.id && r.difficulty===difficulty && r.densityScale===1);
        assert.equal(noteHash,old.noteHash);
        assert.equal(sha(JSON.stringify(chart.generator.tempoMap)),old.tempoHash);
      }
      const heads=new Set(chart.notes.map(n=>n.timeMs));
      const selected=Array.from(heads,t=>byTime.get(t)).filter(Boolean);
      const technical=difficulty==='hard'||difficulty==='expert';
      if(phase==='after' && densityScale>=1 && technical){
        const byId=new Map(chart.notes.map(n=>[n.id,n]));
        for(const note of core.notes)assert.deepEqual(byId.get(note.id),note);
        const placements=new Set(chart.notes.map(n=>`${n.timeMs}:${n.lane}`));
        if(previousDetail)assert.ok([...previousDetail].every(key=>placements.has(key)));
        previousDetail=placements;
      }
      const last=Array(4).fill(-Infinity), tail=Array(4).fill(-Infinity);
      let minFingerGap=null, holdConflicts=0, activeHolds=0;
      for(const n of chart.notes){
        if (Number.isFinite(last[n.lane])) minFingerGap=Math.min(minFingerGap??Infinity,n.timeMs-last[n.lane]);
        if(n.timeMs<tail[n.lane]+45) holdConflicts++;
        if(n.type==='hold')tail[n.lane]=n.endTimeMs;
        activeHolds=Math.max(activeHolds,tail.filter(t=>t>n.timeMs).length);
        last[n.lane]=n.timeMs;
      }
      assert.equal(holdConflicts,0);
      const previous=[...heads];
      let shortRegularWindows=0;
      for(let i=3;i<previous.length;i++){
        const gaps=[previous[i]-previous[i-1],previous[i-1]-previous[i-2],previous[i-2]-previous[i-3]];
        if(Math.max(...gaps)<=220 && Math.max(...gaps)-Math.min(...gaps)<=14)shortRegularWindows++;
      }
      const excerpt = {
        from:track.start,to:track.end,
        heads:previous.filter(t=>t>=track.start*1000&&t<track.end*1000).length
      };
      const row={song:track.id,recordingSha,durationMs:analysis.durationMs,difficulty,densityScale,
        detected:timeline.events.length,noteHash,tempoHash:sha(JSON.stringify(chart.generator.tempoMap)),
        notes:chart.notes.length,heads:heads.size,chords:chart.notes.length-heads.size,
        strongCore:coreAttacks.length,strongCoreRetained:coreAttacks.filter(e=>heads.has(Math.round(e.timeMs))).length,
        lowConfidence:selected.filter(e=>e.confidence<.18).length,shortRegularWindows,
        confidenceBands:[selected.filter(e=>e.confidence<.18).length,
          selected.filter(e=>e.confidence>=.18 && e.confidence<.35).length,
          selected.filter(e=>e.confidence>=.35).length],
        localSubdivisionGaps:previous.slice(1).filter((t,i)=>{
          const event=byTime.get(t);
          return event && [2,3,4,6,8].some(n=>Math.abs(t-previous[i]-event.period/n)<=11);
        }).length,
        holds:diagnostics.report.counts.holds,activeHolds,holdConflicts,minFingerGap, warnings:warnings.length,
        quietHeads:diagnostics.report.counts.quietHeads,nps:diagnostics.report.counts.nps,
        peakNps:diagnostics.report.counts.peakNps,...diagnostics.report.estimates,
        candidates:diagnostics.candidates,generationMs:diagnostics.generationMs,excerpt};
      if(traceCompose){
        const variation=Array.from({length:diagnostics.candidates},(_,i)=>i)
          .find(i=>sha(JSON.stringify(composeV3(timeline,input,i)))===noteHash);
        assert.notEqual(variation,undefined);
        globalThis.densityTrace=new Map();
        assert.deepEqual(traceCompose(timeline,input,variation),chart.notes);
        function counts(events) {
          const stages={},chords={};
          for (const e of events) {
            const {stage,chord}=globalThis.densityTrace.get(e);
            stages[stage]=(stages[stage]??0)+1;
            if(chord)chords[chord]=(chords[chord]??0)+1;
          }
          return {stages,chords};
        }
        Object.assign(row,counts(timeline.events));
        assert.equal(row.stages.head??0,row.heads);
        assert.equal(row.chords.added??0,chart.notes.length-heads.size);
        excerpt.trace=counts(timeline.events.filter(e=>e.timeMs>=track.start*1000&&e.timeMs<track.end*1000));
      }
      rows.push(row);
    }
  }
}
console.log(JSON.stringify({phase,split,peakRssKiB:process.resourceUsage().maxRSS,rows},null,2));
