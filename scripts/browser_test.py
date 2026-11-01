#!/usr/bin/env python3
"""Browser-level smoke tests for the studio and isolated play screen."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, os, tempfile
URL = os.environ.get('RHYTHM_FORGE_URL', 'http://127.0.0.1:4173')
CHROMIUM = os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=CHROMIUM, args=['--no-sandbox','--no-proxy-server','--autoplay-policy=no-user-gesture-required'])
    page = browser.new_page(viewport={ 'width': 1440, 'height': 1000 })
    page.add_init_script("""
      window.__rfWorkerCreations = 0; window.__rfIndexedDbOpenAttempts = 0;
      if (window.Worker) window.Worker = new Proxy(window.Worker, { construct(target, args) { window.__rfWorkerCreations++; return Reflect.construct(target, args); } });
      if (window.IDBFactory) { const open = IDBFactory.prototype.open; IDBFactory.prototype.open = function(...args) { window.__rfIndexedDbOpenAttempts++; return open.apply(this, args); }; }
    """)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda msg: errors.append(f'console error: {msg.text}') if msg.type == 'error' else None)
    try:
        response = page.goto(URL, wait_until='networkidle', timeout=20000)
    except Exception as exc:
        browser.close()
        raise SystemExit(f'Browser navigation failed before app assertions. Check RHYTHM_FORGE_URL and browser network policy. Target: {URL}. Cause: {exc}')
    assert response and response.status == 200, 'homepage did not return HTTP 200'
    assert page.get_by_role('heading', name='Make every beat count.').count() == 1, 'dashboard headline not rendered'
    page.locator('[data-action="demo"]').first.click()
    page.locator('#game-canvas').wait_for(state='visible', timeout=5000)
    assert page.locator('.rhythm-fullscreen-shell').count() == 1, 'play session did not render in isolated full-screen shell'
    assert page.locator('.sidebar, .topbar, .app-footer, .game-song, #hud-combo, #judge-counts, [data-action="open-editor"]').count() == 0, 'studio chrome or unrelated HUD item leaked into gameplay'
    assert page.locator('#hud-score').count() == 1 and page.locator('#hud-accuracy').count() == 1 and page.locator('#last-judgement').count() == 1, 'score, accuracy, or live judgement missing'
    assert page.locator('.play-controls [data-action="toggle-mute"]').count() == 1
    assert page.locator('.play-controls [data-action="restart-game"]').count() == 1
    assert page.locator('.play-controls [data-action="pause-game"]').count() == 1
    assert page.locator('.play-controls [data-action="exit-game"]').count() == 1
    # The dedicated session should fill the viewport without changing its orientation.
    box = page.locator('.rhythm-fullscreen-shell').bounding_box()
    assert box and abs(box['width'] - 1440) < 3 and abs(box['height'] - 1000) < 3, f'play shell did not fill the viewport: {box}'
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2 && document.documentElement.scrollHeight <= window.innerHeight + 2"), 'play screen scrolls beyond viewport'
    # Hit the known first demo note (lane 4 at 1 second) to verify real judgement feedback.
    page.wait_for_function("document.getElementById('global-audio') && document.getElementById('global-audio').readyState >= 1", timeout=10000)
    page.evaluate("document.getElementById('global-audio').pause(); document.getElementById('global-audio').currentTime = 1.0")
    page.keyboard.press('k')
    assert page.locator('#last-judgement').inner_text().lower() == 'marvelous', 'input did not trigger expected hit judgement'
    page.locator('[data-action="pause-game"]').click()
    assert page.get_by_role('heading', name='Paused').count() == 1, 'pause overlay failed'
    page.locator('.pause-overlay [data-action="resume-game"]').click()
    page.wait_for_timeout(100)
    page.locator('.play-controls [data-action="exit-game"]').click()
    assert page.locator('.sidebar').count() == 1, 'Exit did not return from the isolated play screen'
    # Editor remains a studio route; there is no editor link inside the play screen.
    page.locator('[data-action="navigate"][data-screen="editor"]').first.click()
    page.locator('#editor-canvas').wait_for(state='visible', timeout=5000)
    assert page.get_by_text('CHART EDITOR / NORMAL').count() == 1
    page.locator('#editor-canvas').click(position={'x': 70, 'y': 90})
    assert page.locator('.selected-note-panel').count() == 1, 'editor click did not select or add a note'
    page.locator('[data-action="undo"]').click()
    page.locator('[data-action="redo"]').click()
    with page.expect_download(timeout=5000) as download_info:
        page.locator('[data-action="export-chart"]').click()
    download = download_info.value
    assert download.suggested_filename.endswith('.json'), 'chart export did not create a JSON file'
    with tempfile.TemporaryDirectory() as temp_dir:
        exported_path = str(Path(temp_dir) / download.suggested_filename)
        download.save_as(exported_path)
        page.locator('[data-field="import-chart"]').set_input_files(exported_path)
        page.get_by_text('CHART EDITOR / NORMAL').wait_for(timeout=5000)
    # Generator is a real route; analysis and generation use the bundled original WAV.
    page.locator('[data-action="navigate"][data-screen="generator"]').click()
    page.locator('[data-action="analyze"]').click()
    page.locator('.diagnostic-panel').wait_for(state='visible', timeout=25000)
    assert page.locator('.diagnostic-stat').count() == 4, 'generation diagnostics did not render'
    assert page.locator('.preview-actions').count() == 1, 'generated chart preview is missing'
    engine_runtime = page.evaluate("({ workers: window.__rfWorkerCreations, indexedDbOpenAttempts: window.__rfIndexedDbOpenAttempts })")
    assert engine_runtime['workers'] >= 2, f"expected analysis + generation Web Workers, got {engine_runtime}"
    assert engine_runtime['indexedDbOpenAttempts'] >= 1, f"IndexedDB was not exercised: {engine_runtime}"
    persisted_cache = page.evaluate("async () => { const dbs = await indexedDB.databases(); return dbs.map(x => x.name); }")
    assert 'rhythm-forge-analysis' in persisted_cache, f"analysis cache database missing: {persisted_cache}"
    assert 'rhythm-forge-feature-cache' in persisted_cache, f"feature chunk cache database missing: {persisted_cache}"
    cache_probe = page.evaluate("async () => { const mod = await import('/core.js'); const res = await fetch('/public/audio/forge-demo.wav'); const blob = await res.blob(); const file = new File([blob], 'forge-demo.wav', {type:'audio/wav'}); const before = window.__rfWorkerCreations; const a = await mod.analyzeAudioFile(file); return { bpm:a.bpm, before, after:window.__rfWorkerCreations, durationMs:a.durationMs }; }")
    assert cache_probe['after'] == cache_probe['before'], f"repeat analysis did not hit IndexedDB cache: {cache_probe}"
    assert cache_probe['durationMs'] > 1000, f"cached analysis invalid: {cache_probe}"
    # Scroll speed is a visible, persistent slider with a unit-correct value readout.
    page.locator('[data-action="navigate"][data-screen="settings"]').click()
    speed = page.locator('[data-setting="speed"]')
    speed.fill('2.4')
    assert page.locator('#setting-speed-value').inner_text() == '2.4×', 'scroll speed readout did not update'
    page.locator('[data-setting="offset"]').fill('15')
    page.locator('[data-action="navigate"][data-screen="home"]').click()
    page.locator('[data-action="navigate"][data-screen="settings"]').click()
    assert page.locator('[data-setting="offset"]').input_value() == '15', 'timing offset did not persist'
    assert page.locator('[data-setting="speed"]').input_value() == '2.4', 'scroll speed did not persist'
    # Test portrait and landscape viewports while in play: neither should rotate or overflow.
    page.set_viewport_size({'width':390,'height':844})
    page.locator('[data-action="navigate"][data-screen="home"]').click()
    page.locator('[data-action="demo"]').first.click()
    page.locator('#game-canvas').wait_for(state='visible', timeout=5000)
    assert page.evaluate("window.innerWidth < window.innerHeight"), 'test viewport should remain portrait'
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2 && document.documentElement.scrollHeight <= window.innerHeight + 2"), 'portrait play screen overflowed the viewport'
    assert page.locator('.game-song, #hud-combo, #judge-counts').count() == 0
    page.locator('[data-action="exit-game"]').click()
    page.set_viewport_size({'width':844,'height':390})
    page.locator('[data-action="demo"]').first.click()
    page.locator('#game-canvas').wait_for(state='visible', timeout=5000)
    assert page.evaluate("window.innerWidth > window.innerHeight"), 'test viewport should remain landscape'
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2 && document.documentElement.scrollHeight <= window.innerHeight + 2"), 'landscape play screen overflowed the viewport'
    page.locator('[data-action="exit-game"]').click()
    # End a separate run and verify that results still work.
    page.locator('[data-action="demo"]').first.click()
    page.wait_for_function("document.getElementById('global-audio') && document.getElementById('global-audio').readyState >= 1", timeout=10000)
    page.evaluate("const a=document.getElementById('global-audio'); a.currentTime=Math.max(0,a.duration-0.06); a.play()")
    page.locator('.results-page .eyebrow').filter(has_text='RUN COMPLETE').wait_for(timeout=5000)
    assert page.locator('.results-page').count() == 1, 'results screen did not render'
    if errors:
        raise AssertionError('Browser logged errors: ' + json.dumps(errors[:10], ensure_ascii=False))
    browser.close()
print('BROWSER TESTS PASSED: isolated gameplay HUD, no landscape lock, gameplay controls, live judgement, pause/resume/exit, editor, export/import, real analysis + generation Web Workers, IndexedDB analysis/feature caches and repeat-analysis cache hit, persistent speed slider, portrait and landscape viewports, results screen.')
