#!/usr/bin/env python3
"""Dependency-free static production build for Rhythm Forge."""
from pathlib import Path
import shutil
ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
if DIST.exists(): shutil.rmtree(DIST)
DIST.mkdir(parents=True)
for item in ['index.html', 'app.js', 'core.js', 'score-v2.js', 'performance-analysis.js', 'smartgen.js', 'tempomap.js', 'beatgrid.js', 'patterns.js', 'difficulty.js', 'compose.js', 'analysis-worker.js', 'cache.js', 'sections.js', 'quality-extra.js', 'autofix.js', 'genclient.js', 'gen-worker.js']:
    shutil.copy2(ROOT / item, DIST / item)
shutil.copytree(ROOT / 'src', DIST / 'src', dirs_exist_ok=True, ignore=shutil.ignore_patterns('*.tsx', '*.ts'))
shutil.copytree(ROOT / 'public', DIST / 'public', dirs_exist_ok=True)
for f in ['favicon.ico','favicon.svg','apple-touch-icon.png']:
    shutil.copy2(ROOT/'public'/f, DIST/f)
# Runtime asset paths are rooted at /public, so the public directory remains the single source of truth.
# Preserve docs/scripts for reproducibility in the source archive; the published site only needs runtime files.
print(f'Built static site to {DIST} ({sum(p.stat().st_size for p in DIST.rglob("*") if p.is_file()):,} bytes).')
