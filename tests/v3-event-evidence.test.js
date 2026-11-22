import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeV3, interpretTimeline } from '../v3/timeline.js';
import { generateV3 } from '../v3/engine.js';
import { recurringEnvelopes } from '../v3/attack-spectrum.js';
import { validateChart } from '../core.js';
import { matchAttacks, compareAttacks } from '../scripts/onset-matching.mjs';
import { runV3 } from '../v3/client.js';

test('a pitch-only stationary recording has no recurring percussive sequence', () => {
  const rate = 16000, pcm = Float32Array.from({length:rate*3}, (_,i) =>
    .4*Math.sin(2*Math.PI*370*i/rate + 1.7*Math.sin(2*Math.PI*5*i/rate)));
  const result = analyzeV3(pcm, rate);
  const chart = generateV3(interpretTimeline(result),'vibrato',{difficulty:'expert'}).chart;
  assert.ok(chart.notes.filter(n=>n.timeMs > 90 && n.timeMs < 2870).length <= 1);
});

test('rhythmic corroboration can recover an observed timbre change, and creates no missing timestamp', () => {
  const peaks = Array.from({length:23},(_,i)=>({timeMs:100+i*183,relative:2,band:2,
    shape:[25,30,25,20],signature:[10,34,16,16,12,8,4]}));
  Object.assign(peaks[10],{relative:1.12,shape:[15,5,10,70],signature:[6,4,9,14,12,18,37]});
  peaks.splice(9,1);
  const times = peaks.map(p=>p.timeMs);
  recurringEnvelopes(peaks);
  assert.deepEqual(peaks.map(p=>p.timeMs),times);
  assert.ok(peaks[9].phrasePeriodMs > 0);
  assert.equal(peaks[9].recurrence,undefined);
});

test('event tracing exposes rejected evidence and reproduces the winning chart exactly', () => {
  const rate = 16000, pcm = new Float32Array(4*rate);
  for (let i = 0; i < pcm.length; i++) {
    const t = i/rate, elapsed = (t+.042)% .173;
    pcm[i] = elapsed < .033 ? Math.sin(2*Math.PI*430*elapsed)*.45*Math.exp(-80*elapsed) : 0;
  }
  const raw = [];
  const timeline = interpretTimeline(analyzeV3(pcm,rate,undefined,raw));
  const opts = { difficulty:'expert', seed:331, minConfidence:.35 };
  const plain = generateV3(timeline,'uneven',opts);
  const traced = generateV3(timeline,'uneven',{...opts,traceEvents:true});
  assert.deepEqual(traced.chart,plain.chart);
  assert.equal(plain.diagnostics.lineage,undefined);
  const rows = traced.diagnostics.lineage;
  assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
  assert.ok(raw.some(r=>r.decision === 'merged'));
  assert.ok(rows.every(r=>r.decision && Number.isFinite(r.confidence)));
  assert.deepEqual(rows.flatMap(r=>r.final),traced.chart.notes);
  assert.ok(validateChart(traced.chart).valid);
});

test('annotated attack matching is one-to-one and minimizes error at equal cardinality', () => {
  assert.deepEqual(matchAttacks([101,110],[100,121],15),[[0,0],[1,1]]);
  assert.deepEqual(matchAttacks([90,101],[100],15),[[1,0]]);
  assert.deepEqual(matchAttacks([99],[98,99],5),[[0,1]]);
  assert.equal(compareAttacks([],[],25).medianErrorMs,null);
});

test('a stereo pair with inverted polarity retains its audible attacks in the Worker PCM', async t => {
  const originals = [globalThis.Worker,globalThis.OfflineAudioContext];
  t.after(()=>{[globalThis.Worker,globalThis.OfflineAudioContext]=originals;});
  const left = Float32Array.from({length:512},(_,i)=>Math.sin(i*.67)*.25);
  const channels = [left,left.map(v=>-v)];
  let received;
  globalThis.OfflineAudioContext = class {
    decodeAudioData() { return {duration:1,length:512,numberOfChannels:2,sampleRate:22050,getChannelData:i=>channels[i]}; }
    createBufferSource() { return {connect(){},start(){}}; }
    startRendering() { return {getChannelData:()=>new Float32Array(512)}; }
  };
  globalThis.Worker = class {
    terminate() {}
    postMessage(job) { received=new Float32Array(job.samples); this.onmessage({data:{results:[]}}); }
  };
  await runV3(new Blob(['anti-phase']),'audible',{},new AbortController().signal);
  assert.deepEqual(received,left);
});

test('physical rating distinguishes finger repeats and concentrated passages at equal whole-song NPS', async () => {
  const {rateV3Difficulty} = await import('../v3/quality.js');
  const chart = (interval,lane) => Array.from({length:64},(_,i)=>({timeMs:100+i*interval,lane:lane(i),type:'tap'}));
  const alternating = chart(140,i=>i%4);
  assert.ok(rateV3Difficulty(chart(140,()=>0),12000) > rateV3Difficulty(alternating,12000));
  assert.ok(rateV3Difficulty(chart(80,i=>i%4),12000) > rateV3Difficulty(alternating,12000));
  assert.equal(rateV3Difficulty([],120000),.5);
});

test('a measured dyad may retain a second key at a reliable hold start', async () => {
  const {composeV3} = await import('../v3/composer.js');
  const times = [100,300,500,700,1000,1250,1450];
  const events = times.map((timeMs,i) => ({
    timeMs,period:450,phraseId:0,slot:i,pulse:.2,band:1,salience:.35,
    confidence:.65,strength:.5,bandSpread:.05,sustainEndMs:timeMs,
    ...(i===3 ? {voice:{hz:261,dyad:[261,329]},salience:.7,
      trackedSustain:{state:'release',endTimeMs:1130,continuity:1}} : {})
  }));
  const timeline = {events,envelopes:[],durationMs:1900,phrases:[{id:0,motif:0,sectionId:0,startMs:0}],
    sections:[{texture:'steady'}],quietRanges:[]};
  const notes = composeV3(timeline,{compositionRevision:'spectral-1',difficulty:'expert'});
  const chord = notes.filter(n=>n.timeMs===700);
  assert.equal(chord.length,2);
  assert.equal(chord.find(n=>n.type==='hold').endTimeMs,1130);
  assert.equal(new Set(chord.map(n=>n.lane)).size,2);
});
