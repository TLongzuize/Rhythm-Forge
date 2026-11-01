#!/usr/bin/env python3
"""Bundle the project into ONE self-contained HTML file (for claude.ai artifacts). Usage: python3 scripts/build-artifact.py [out.html]"""
import re,base64,sys,os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..'))
core=re.sub(r"^import [^\n]*\n",'',open('core.js').read(),count=1,flags=re.M); app=open('app.js').read(); css=open('src/styles.css').read()+open('src/osu.css').read()+open('src/rf-fix.css').read(); html=open('index.html').read()
names=re.findall(r'^export (?:async )?(?:function|const|let|class) ([A-Za-z0-9_$]+)',core,re.M)
core=re.sub(r'^export (?=(?:async )?(?:function|const|let|class))','',core,flags=re.M)
core, disabled_workers = re.subn(r"worker\s*=\s*new Worker\(new URL\('./analysis-worker\.js',\s*import\.meta\.url\),\s*\{\s*type:\s*'module'\s*\}\);", "throw Error('worker disabled');", core)
assert disabled_workers == 1, 'Could not disable the analysis Worker for the standalone artifact.'
# Flattened module imports must be rebound from the core namespace. In particular,
# tempomap.js imports inferTempo even though app.js does not; omitting that binding
# produces a runtime ReferenceError only in the single-file build.
core_imports = []
for module_path in ['app.js','tempomap.js','compose.js','smartgen.js']:
    module_source = open(module_path).read()
    for match in re.finditer(r"import \{([^}]*)\} from './core\.js';", module_source):
        for item in match.group(1).split(','):
            item = item.strip()
            if not item: continue
            local_name = item.split(' as ')[-1].strip()
            if local_name not in core_imports: core_imports.append(local_name)
imp = ','.join(core_imports)
missing_core_exports = [name for name in core_imports if name not in names]
assert not missing_core_exports, f'Missing core exports in standalone bundle: {missing_core_exports}'
mods=''.join(re.sub(r"^export (?=(?:async )?(?:function|const|let|class))",'',re.sub(r"^import [^\n]*\n",'',open(f).read(),flags=re.M),flags=re.M)+'\n' for f in ['tempomap.js','beatgrid.js','patterns.js','difficulty.js','compose.js','sections.js','quality-extra.js','autofix.js','genclient.js']); tm=''
tm0=open('tempomap.js').read(); tm=re.sub(r"^import [^\n]*\n","",tm,flags=re.M); tm=re.sub(r'^export (?=(?:async )?(?:function|const|let|class))','',tm,flags=re.M)
sg=open('smartgen.js').read(); sg=re.sub(r"^import [^\n]*\n","",sg,flags=re.M); sg=re.sub(r'^export (?=(?:async )?(?:function|const|let|class))','',sg,flags=re.M)
score_source=open('score-v2.js').read(); score_exports=re.findall(r'^export (?:async )?(?:function|const|let|class) ([A-Za-z0-9_$]+)',score_source,re.M)
score=re.sub(r'^export (?=(?:async )?(?:function|const|let|class))','',score_source,flags=re.M)
performance_source=open('performance-analysis.js').read(); performance_exports=re.findall(r'^export (?:async )?(?:function|const|let|class) ([A-Za-z0-9_$]+)',performance_source,re.M)
performance=re.sub(r"^import \{[^}]*\} from './score-v2\.js';\n","",performance_source,count=1,flags=re.M)
performance=re.sub(r'^export (?=(?:async )?(?:function|const|let|class))','',performance,flags=re.M)
app=app.replace("import { MODES } from './smartgen.js';","").replace("import { generateAllSmartAsync } from './genclient.js';","")
app=re.sub(r"^import \{[^}]*\} from './core\.js';\n","",app,count=1,flags=re.M|re.S)
app=re.sub(r"^import \{[^}]*\} from './score-v2\.js';\n","",app,count=1,flags=re.M|re.S)
app=re.sub(r"^import \{[^}]*\} from './performance-analysis\.js';\n","",app,count=1,flags=re.M|re.S)
app=app.replace("const AUDIO_DEMO = './public/audio/forge-demo.wav';","const DEMO_BLOB=(()=>{const b=atob(DEMO_B64),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return new Blob([u],{type:'audio/wav'});})();const AUDIO_DEMO=URL.createObjectURL(DEMO_BLOB);")
assert 'DEMO_BLOB' in app
app=app.replace("await fetch(AUDIO_DEMO)","({ok:true,status:200,blob:async()=>DEMO_BLOB})")
b64=base64.b64encode(open('public/audio/forge-demo.wav','rb').read()).decode()
cache=re.sub(r"^export (?=(?:async )?(?:function|const|let|class))",'',open('cache.js').read(),flags=re.M)
mods=mods.replace("new Worker(new URL('./gen-worker.js', import.meta.url), { type: 'module' })","(()=>{throw Error('worker disabled')})()")
assert 'import.meta' not in mods
script=f"const DEMO_B64='{b64}';\n{cache}\nconst RF=(()=>{{\n{core}\nreturn {{{','.join(names)}}};\n}})();\nconst {{{imp}}}=RF;\n{mods}\n{sg}\nconst RFScore=(()=>{{\n{score}\nreturn {{{','.join(score_exports)}}};\n}})();\nconst {{{','.join(score_exports)}}}=RFScore;\nconst RFPerformance=(()=>{{\nconst {{SCORE_V2_JUDGEMENT_VALUES}}=RFScore;\n{performance}\nreturn {{{','.join(performance_exports)}}};\n}})();\nconst {{{','.join(performance_exports)}}}=RFPerformance;\n{app}"
html=html.replace('<link rel="stylesheet" href="/src/styles.css" />',f'<style>{css}</style>')
html=html.replace('<link rel="stylesheet" href="/src/osu.css" />','').replace('<link rel="stylesheet" href="/src/rf-fix.css" />','')
html=re.sub(r'<link rel="preconnect"[^>]*>','',html)
html=re.sub(r'<link href="https://fonts\.googleapis\.com/[^>]*>','',html)
html=re.sub(r'<link rel="preconnect"[^>]*>','',html)
# All module imports/exports are flattened above, so a classic inline script is
# more compatible with direct file:// opening on desktop and mobile browsers.
assert not re.search(r'^\s*import\s+\{?.*?from\s+["\']', script, re.M), 'Unresolved module import in standalone script.'
assert not re.search(r'^\s*export\s+', script, re.M), 'Unresolved module export in standalone script.'
boot = '<div id=\"root\"><div class=\"rf-boot-fallback\"><b>Rhythm Forge</b><span>Starting your rhythm workspace…</span></div></div>'
html=html.replace('<div id=\"root\"></div>',boot)
html=html.replace('</head>','<style>.rf-boot-fallback{min-height:100vh;display:grid;align-content:center;justify-items:center;gap:12px;background:radial-gradient(ellipse at 50% 35%,#24163a,#090b11 70%);color:#f5f2ff;font:600 16px system-ui}.rf-boot-fallback b{font-size:clamp(28px,6vw,54px);letter-spacing:-.04em}.rf-boot-fallback span{font-size:13px;color:#a9a1bc}</style>\n</head>')
html=html.replace('<script type=\"module\" src=\"/app.js\"></script>','<script>\n'+script.replace('</script','<\\/script')+'\n</script>')
open(sys.argv[1] if len(sys.argv)>1 else 'rhythm-forge.html','w').write(html)
