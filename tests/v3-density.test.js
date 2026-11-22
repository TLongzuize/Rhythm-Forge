import assert from 'node:assert/strict';
import test from 'node:test';
import { addV3DensityDetail } from '../v3/composer.js';
import { generateV3Set } from '../v3/engine.js';
import { analyzeV3 } from '../v3/timeline.js';
import { validateChart } from '../core.js';
import { synthClicks } from './helpers.js';

const attack = (timeMs, props={})=>({
  timeMs, confidence:0.3, salience:0.28, period:500, bandSpread:0, sustainEndMs:timeMs+10, ...props
});
const tap = (timeMs,lane,id)=>({timeMs,lane,id,type:'tap'});
const detail = (events, core, densityScale=1.45, quietRanges=[]) =>
  addV3DensityDetail({events,durationMs:4000,quietRanges},core,{difficulty:'expert',densityScale},events.map(()=>0));

test('upper density adds anchored rhythmic taps in evidence order with stable core placements',()=>{
  const notes=[tap(100,0,'a'),tap(500,2,'b'),tap(900,0,'c')];
  const events=[attack(100),attack(300,{salience:0.4}),attack(500),attack(700,{salience:0.22}),attack(900)];
  const mid=detail(events,notes,1.2);
  const high=detail(events,notes);
  assert.deepEqual(mid.map(n=>n.timeMs),[100,300,500,900]);
  assert.deepEqual(high.map(n=>n.timeMs),[100,300,500,700,900]);
  for (const n of mid) assert.ok(high.some(x=>x.id===n.id&&x.timeMs===n.timeMs&&x.lane===n.lane));
});

test('weak or silent attacks and isolated long sounds do not fill the slider budget',()=>{
  const notes=[tap(100,0,'a'),tap(500,2,'b')];
  const events=[attack(100),attack(300,{confidence:0.12}),attack(500),attack(2400,{bandSpread:0.9})];
  assert.deepEqual(detail(events,notes),notes);
  assert.deepEqual(detail([attack(100),attack(300),attack(500)],notes,1.45,[{startMs:275,endMs:400}]),notes);
  const single=[tap(100,0,'a')];
  assert.deepEqual(detail([attack(100,{bandSpread:0.9,salience:0.7})],single),single);
});

test('broad accents add at most one free opposite-hand key and respect held lanes and release guards',()=>{
  const held={...tap(100,2,'hold'),type:'hold',endTimeMs:680};
  const second={...tap(120,3,'other'),type:'hold',endTimeMs:475};
  const notes=[held,second,tap(500,0,'blocked'),tap(900,0,'accent'),tap(1300,0,'exit')];
  const events=notes.map(n=>attack(n.timeMs,{salience:n.type==='tap'?0.5:0.28,
    bandSpread:['blocked','accent'].includes(n.id)?0.8:0}));
  const result=detail(events,notes);
  assert.equal(result.filter(n=>n.timeMs===500).length,1);
  const accent=result.filter(n=>n.timeMs===900);
  assert.equal(accent.length,2);
  assert.ok(accent.some(n=>n.lane>=2));
  for(const hold of [held,second])assert.deepEqual(result.find(n=>n.id===hold.id),hold);
});

test('automatic generation clamps density, preserves historical replay and keeps Easy single-note only',()=>{
  const {samples,sr}=synthClicks({segments:[{bpm:160,ms:10000}],sr:16000,eighths:true,accentEvery:4});
  const analysis=analyzeV3(samples,sr);
  const run=(densityScale,opts)=>generateV3Set(analysis,'Density',{seed:21,densityScale,...opts}).map(g=>g.chart);
  assert.deepEqual(run(9),run(1.45));
  assert.deepEqual(run(0),run(0.55));
  assert.deepEqual(run(1,{compositionRevision:'event-1'}).map(c=>c.notes),run(1,{effort:'medium'}).map(c=>c.notes));
  const [easy,,hard,expert]=run(1.45);
  assert.equal(new Set(easy.notes.map(n=>n.timeMs)).size,easy.notes.length);
  assert.ok(hard.generator.densityRevision && expert.generator.policyRevision==='automatic-1');
  for(const c of run(1.45))assert.ok(validateChart(c).valid);
});

test('density details use free IDs after a chord key was replaced by a hold', () => {
  const notes = [tap(100, 0, 'v3-0'), tap(500, 2, 'v3-2')];
  const events = [attack(100), attack(300, { salience: 0.4 }), attack(500)];
  const result = detail(events, notes);
  assert.equal(result.length, 3);
  assert.equal(new Set(result.map(n => n.id)).size, 3);
});
