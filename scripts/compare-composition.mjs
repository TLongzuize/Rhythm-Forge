// Capture one engine revision per invocation. Existing captures are protected.
import {readFileSync, readdirSync, mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {analyzeSamples, validateChart} from '../core.js';
import {generateRfV2} from '../rfgen-v2.js';
import {analyzeV3, interpretTimeline} from '../v3/timeline.js';
import {generateV3} from '../v3/engine.js';
import {assessV3} from '../v3/quality.js';
import {V3_PROFILES} from '../v3/composer.js';
import {synthClicks} from '../tests/helpers.js';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const [revision,output]=process.argv.slice(2);
if(!['before','after'].includes(revision)||!output) throw Error('Supply before|after and an empty output directory.');
mkdirSync(output,{recursive:true});
if(readdirSync(output).length) throw Error('Capture directory must be empty.');
const scratch=mkdtempSync(join(tmpdir(),'rf-chart-comparison-'));
const rows=[];
const sr=22050;
for(const prefix of ['OnlyMP3_to_-__-_Galaxy','𝙕𝙈𝘼𝙅𝙊𝙍','fixture']){
  let pcm,title,hash;
  if(prefix==='fixture'){
    title='Accented 180 BPM eighths';
    pcm=synthClicks({segments:[{ms:24000,bpm:180}],sr,eighths:true,accentEvery:4}).samples;
    hash=createHash('sha256').update(Buffer.from(pcm.buffer)).digest('hex');
  }else{
    title=readdirSync('audio_file_to_test').find(f=>f.startsWith(prefix));
    const file='audio_file_to_test/'+title;
    hash=createHash('sha256').update(readFileSync(file)).digest('hex');
    const bytes=execFileSync('ffmpeg',['-v','error','-i',file,'-ac','1','-ar',String(sr),'-f','f32le','-'],{maxBuffer:128*1024*1024});
    pcm=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
  }
  const timeline=interpretTimeline(analyzeV3(pcm,sr));
  const legacy=revision==='before'?analyzeSamples(pcm,sr):null;
  for(const [i,difficulty] of Object.keys(V3_PROFILES).entries()){
    const opts={difficulty,mode:'balanced',effort:'medium',seed:1337+7919*i};
    for(const engine of legacy?['v2','v3']:['v3']){
      const start=performance.now();
      const {chart}=engine==='v2'?generateRfV2(legacy,title,opts):generateV3(timeline,title,opts);
      const ms=performance.now()-start;
      const metrics=assessV3(chart.notes,timeline,V3_PROFILES[difficulty]);
      const valid=validateChart(chart).valid;
      if(!valid||metrics.counts.collisions) throw Error('Invalid chart');
      const name=[prefix==='fixture'?'fixture':prefix.startsWith('Only')?'galaxy':'mutilator',difficulty,engine,revision].join('-');
      writeFileSync(join(scratch,name+'.json'),JSON.stringify(chart));
      rows.push({name,title,hash,...opts,events:timeline.events.length,ms,valid,...metrics});
    }
  }
}
execFileSync('zip',['-q',resolve(output,'charts.zip'),...readdirSync(scratch)],{cwd:scratch});
rmSync(scratch,{recursive:true});
writeFileSync(join(output,'metrics.json'),JSON.stringify(rows,null,2)+'\n');
