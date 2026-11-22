const { firefox, webkit } = require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wav':'audio/wav','.mp4':'video/mp4','.svg':'image/svg+xml'};
const root=process.cwd();
const server=http.createServer(async(req,res)=>{
  try {
    const parsed=new URL(req.url,'http://localhost');
    const localPath=path.resolve(root,'dist','.'+(parsed.pathname==='/'?'/index.html':parsed.pathname));
    if(!localPath.startsWith(path.join(root,'dist')+path.sep)) return res.writeHead(400).end();
    const bytes=await fs.readFile(localPath);
    res.writeHead(200,{'Content-Type':mime[path.extname(localPath)]??'application/octet-stream','Content-Length':bytes.length}).end(bytes);
  } catch {res.writeHead(404).end();}
});
const selector=action=>'[data-action="'+action+'"]';
(async()=>{
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
for(const backend of process.argv.slice(2)){
 const browser=await ({firefox,webkit})[backend].launch();
 try{
  for(const url of ['http://127.0.0.1:'+server.address().port,pathToFileURL(path.join(root,'Rhythm-Forge-Standalone-v14.5.html')).href]){
   const page=await browser.newPage();
   const errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(url,{waitUntil:'domcontentloaded'});
   await page.locator('#rf-splash-logo').click();
   await page.locator('[data-action="navigate"][data-screen="generator"]').first().click();
   const defaults=await page.locator('[data-engine="v2"]').getAttribute('aria-pressed');
   assert.equal(defaults,'true');
   await page.locator('[data-engine="v3"]').click();
   await page.locator(selector('choose-audio')+' input').setInputFiles(path.join(root,'public/audio/forge-demo.wav'));
   await page.locator(selector('analyze')).click();
   await page.locator('.gen-row').nth(3).waitFor({timeout:30000});
   await page.locator(selector('open-project')).click();
   await page.locator('#editor-canvas').waitFor();
   const download=page.waitForEvent('download');
   await page.locator(selector('export-chart')).click();
   const chart=JSON.parse(await fs.readFile(await (await download).path(),'utf8'));
   assert.equal(chart.generator.compositionRevision,'spectral-1');
   assert.ok(chart.notes.length>0);
   await page.locator(selector('preview-chart')).click();
   const start=page.locator(selector('loader-start'));
   if(await start.isVisible()) await start.click();
   await page.locator('#game-canvas').waitFor();
   assert.deepEqual(errors,[]);
   console.log('PASS',backend,url);
   await page.close();
  }
 } finally {await browser.close();}
}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
