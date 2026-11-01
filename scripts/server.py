#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
ROOT = Path(__file__).resolve().parents[1]
PORT = int(os.environ.get('PORT', '4173'))
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(ROOT), **kwargs)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
print(f'Rhythm Forge dev server: http://127.0.0.1:{PORT}', flush=True)
ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
