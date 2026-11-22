"""Exercise the built app in native macOS Safari via an ephemeral loopback origin."""
import base64
import json
import queue
import subprocess
import tempfile
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

root = Path(__file__).resolve().parents[1]
results = queue.Queue()
js = """
(async()=>{
const result={ua:navigator.userAgent};
try{
 const w=window.frames[0]||window, d=w.document;
 const wait=async fn=>{for(let i=0;i<240;i++){let v=fn();if(v)return v;await new Promise(r=>setTimeout(r,100));}throw Error('timed out');};
 const q=s=>d.querySelector(s), act=name=>q('[data-action="'+name+'"]');
 (await wait(()=>q('#rf-splash-logo'))).click();
 (await wait(()=>q('[data-action="navigate"][data-screen="generator"]'))).click();
 await wait(()=>q('[data-engine="v2"]'));result.defaultV2=q('[data-engine="v2"]').getAttribute('aria-pressed')==='true';
 q('[data-engine="v3"]').click();
 const workers=[];w.Worker=new Proxy(w.Worker,{construct(C,args){const worker=new C(...args);const info={};workers.push(info);
 const send=worker.postMessage.bind(worker);worker.postMessage=(job,...rest)=>{info.cached=!!job.analysis;return send(job,...rest);};
 const stop=worker.terminate.bind(worker);worker.terminate=()=>{info.terminated=true;stop()};return worker;}});
 const file=new w.File([Uint8Array.from(atob('WAV_DATA'),c=>c.charCodeAt(0))],'smoke.wav',{type:'audio/wav'});
 const transfer=new w.DataTransfer();transfer.items.add(file);const input=await wait(()=>q('[data-action="choose-audio"] input'));input.files=transfer.files;
 input.dispatchEvent(new w.Event('change',{bubbles:true}));await wait(()=>act('analyze')&&!act('analyze').disabled);
 act('analyze').click();(await wait(()=>act('cancel-analysis'))).click();result.cancelled=workers.at(-1)?.terminated===true;
 await wait(()=>act('analyze')&&!act('analyze').disabled);act('analyze').click();await wait(()=>d.querySelectorAll('.gen-row').length===4);result.generated=4;
 act('analyze').click();await wait(()=>workers.at(-1)?.cached&&d.querySelectorAll('.gen-row').length===4);result.cache=true;
 act('open-project').click();await wait(()=>q('#editor-canvas'));result.editor=true;
 if(!result.defaultV2||!result.cancelled)throw Error('default or cancellation failed');
}catch(e){result.error=String(e)}
 await fetch('CALLBACK',{method:'POST',body:JSON.stringify(result)});})();
"""
js = js.replace('WAV_DATA',base64.b64encode((root/'public/audio/forge-demo.wav').read_bytes()).decode())


class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        if self.path=='/smoke':
            content=('<iframe src="/index.html"></iframe><script>window.onload=()=>{'+
                     js.replace('CALLBACK','/result')+'};</script>').encode()
            self.send_response(200); self.send_header('Content-Type','text/html'); self.end_headers()
            self.wfile.write(content)
        else: super().do_GET()
    def do_POST(self):
        result=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.send_response(200); self.send_header('Access-Control-Allow-Origin','*'); self.end_headers()
        results.put(result)


with ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=root/'dist')) as server:
    Thread(target=server.serve_forever,daemon=True).start()
    url='http://127.0.0.1:'+str(server.server_port)
    with tempfile.TemporaryDirectory() as temp:
        document=Path(temp)/'standalone-smoke.html'
        # Safari can share file-origin preferences with other standalone
        # sessions. Give this temporary test document fresh settings.
        isolate = b"""<script>Object.defineProperty(window,'localStorage',{value:(()=>{
          const data=new Map();return {get length(){return data.size},key:i=>[...data.keys()][i]??null,
          getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
        })()});</script>"""
        bundle=(root/'Rhythm-Forge-Standalone-v14.5.html').read_bytes()
        assert b'<head>' in bundle
        document.write_bytes(bundle.replace(b'<head>',b'<head>'+isolate,1)+
                             ('<script>window.onload=()=>{'+js.replace('CALLBACK',url+'/result')+'};</script>').encode())
        for mode, location in [('static',url+'/smoke'),('instrumented-file',document.as_uri())]:
            # The generator and editor use animation frames, which Safari may
            # suspend in a background tab. Exercise the visible application.
            subprocess.run(['open','-a','Safari',location],check=True,timeout=10)
            result=results.get(timeout=45)
            print(json.dumps(dict(surface=mode,**result)),flush=True)
            if 'error' in result: raise RuntimeError(result)
