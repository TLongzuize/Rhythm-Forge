#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
ROOT = Path(__file__).resolve().parents[1] / 'dist'
if not ROOT.exists(): raise SystemExit('dist/ does not exist. Run: npm run build')
PORT = int(os.environ.get('PORT', '4174'))
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(ROOT), **kwargs)
print(f'Rhythm Forge production preview: http://127.0.0.1:{PORT}', flush=True)
ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
