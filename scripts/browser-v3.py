"""V3 UI and worker smoke tests. Use a disposable Playwright browser context."""
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
urls = sys.argv[1:] or [os.getenv("RHYTHM_FORGE_URL", "http://127.0.0.1:4174"),
                        (root / "Rhythm-Forge-Standalone-v14.5.html").as_uri()]
compact = os.getenv("RF_V3_COMPACT") == "1"
backend = os.getenv("RF_V3_BROWSER", "chromium")
with sync_playwright() as pw:
    browser = getattr(pw, backend).launch(
        executable_path=os.getenv("RF_V3_BROWSER_PATH") or (os.getenv("CHROMIUM_PATH") if backend == "chromium" else None),
        args=["--autoplay-policy=no-user-gesture-required"] if backend == "chromium" else [])
    for url in urls:
        page = browser.new_page(**(pw.devices["Pixel 7"] if compact else {}))
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        if compact:
            page.add_init_script("Object.defineProperty(navigator, 'hardwareConcurrency', {value: 4});")
        page.add_init_script("""
          localStorage.setItem('rf-v3-effort','max');
          window.v3TestWorkers=[];
          window.Worker=new Proxy(Worker,{construct(cls,args){
            const worker=new cls(...args);
            const record={url:String(args[0]),terminated:false};
            window.v3TestWorkers.push(record);
            const send=worker.postMessage.bind(worker);
            worker.postMessage=(job,...args)=>{
              record.cached=!!job.analysis;
              record.effortSent=Object.hasOwn(job.opts,'effort');
              return send(job,...args);
            };
            worker.addEventListener('message',event=>{
              if(window.cancelV3OnProgress && event.data.progress>=20){
                window.cancelV3OnProgress=false;
                document.querySelector('[data-action="cancel-analysis"]').click();
              }
            });
            const terminate=worker.terminate.bind(worker);
            worker.terminate=()=>{record.terminated=true;terminate()};
            return worker;
          }});
        """)
        page.goto(url, wait_until="domcontentloaded")
        page.locator("#rf-splash-logo").click()
        page.locator('[data-action="navigate"][data-screen="generator"]').first.click()
        expect(page.locator('[data-engine="v2"]')).to_have_attribute('aria-pressed', 'true')
        page.locator('[data-engine="v3"]').click()
        expect(page.locator('[data-field="v3-effort"]')).to_have_count(0)
        # Click Cancel within the same UI event turn so a fast machine cannot
        # complete the fixture before the cancellation path is exercised.
        page.evaluate("""()=>{
          document.querySelector('[data-action="analyze"]').click();
          document.querySelector('[data-action="cancel-analysis"]').click();
        }""")
        expect(page.locator('.gen-row')).to_have_count(0)
        # Exercise the real file importer and cancel an already created worker.
        page.locator('[data-action="choose-audio"] input').set_input_files(root/'public/audio/forge-demo.wav')
        page.evaluate("""()=>{
          document.querySelector('[data-action="analyze"]').click();
          if (!window.v3TestWorkers.length) throw Error('Worker missing');
          document.querySelector('[data-action="cancel-analysis"]').click();
          if (!window.v3TestWorkers.at(-1).terminated) throw Error('Worker still running');
        }""")
        page.evaluate("""()=>{window.cancelV3OnProgress=true;
          document.querySelector('[data-action="analyze"]').click();}""")
        page.wait_for_function("!window.cancelV3OnProgress && window.v3TestWorkers.at(-1).terminated")
        expect(page.locator('.gen-row')).to_have_count(0)
        page.locator('[data-action="analyze"]').click()
        try:
            expect(page.locator('.gen-row')).to_have_count(4,timeout=30000)
        except AssertionError:
            print(url, page.locator('.gen-card').inner_text(), errors, file=sys.stderr)
            raise
        page.locator('[data-action="analyze"]').click()
        expect(page.locator('.gen-row')).to_have_count(4,timeout=30000)
        assert page.evaluate("window.v3TestWorkers.at(-1).cached"), 'repeat generation decoded audio again'
        page.locator('[data-action="open-project"]').click()
        expect(page.locator('#editor-canvas')).to_be_visible()
        with page.expect_download() as output:
            page.locator('[data-action="export-chart"]').click()
        chart = json.loads(Path(output.value.path()).read_text())
        assert chart['generator']['engine'] == 'rf-v3'
        assert chart['generator']['policyRevision'] == 'automatic-1'
        assert chart['generator']['compositionRevision'] == 'spectral-1'
        if compact:
            assert chart['generator']['resourceClass'] == 'compact'
        assert 'effort' not in chart['generator']
        assert page.evaluate("window.v3TestWorkers.every(job=>!job.effortSent)")
        assert page.evaluate("localStorage.getItem('rf-v3-effort')") == 'max'
        assert chart['notes'] and chart['metadata']['difficulty']=='easy'
        page.locator('[data-action="save-chart"]').click()
        page.get_by_text('Project saved locally', exact=True).wait_for()
        page.reload(wait_until="domcontentloaded")
        page.locator('#rf-splash-logo').click()
        page.locator('[data-action="navigate"][data-screen="library"]').first.click()
        page.locator('.lz-actions [data-action="open-project"]').click()
        expect(page.locator('#editor-canvas')).to_be_visible()
        with page.expect_download() as saved:
            page.locator('[data-action="export-chart"]').click()
        assert json.loads(Path(saved.value.path()).read_text()) == chart
        legacy = {**chart, 'chartId': chart['chartId'] + '-legacy'}
        legacy['generator'] = dict(chart['generator'], effort='high')
        del legacy['generator']['policyRevision'], legacy['generator']['generationOptions'], legacy['generator']['compositionRevision']
        page.locator('[data-field="import-chart"]').set_input_files({
            'name':'legacy.json', 'mimeType':'application/json', 'buffer':json.dumps(legacy).encode()
        })
        page.get_by_text(f'Imported {len(legacy["notes"])} notes.', exact=True).wait_for()
        with page.expect_download() as imported:
            page.locator('[data-action="export-chart"]').click()
        assert json.loads(Path(imported.value.path()).read_text()) == legacy
        page.locator('[data-action="navigate"][data-screen="generator"]').first.click()
        page.locator('[data-action="choose-audio"] input').set_input_files(root/'public/audio/forge-demo.wav')
        expect(page.locator('.gen-row')).to_have_count(0)
        workers = page.evaluate("window.v3TestWorkers.length")
        generator_import = page.locator('.gen-card [data-field="import-chart"]')
        generator_import.set_input_files({
            'name':'invalid.json', 'mimeType':'application/json', 'buffer':b'{}'
        })
        page.get_by_text('Chart import failed:', exact=False).wait_for()
        expect(page.locator('.gen-row')).to_have_count(0)
        generator_import.set_input_files({
            'name':'legacy.json', 'mimeType':'application/json', 'buffer':json.dumps(legacy).encode()
        })
        expect(page.locator('#editor-canvas')).to_be_visible()
        assert page.evaluate("window.v3TestWorkers.length") == workers
        page.locator('[data-action="preview-chart"]').click()
        start = page.locator('[data-action="loader-start"]')
        if start.is_visible():
            start.click()
        expect(page.locator('#game-canvas')).to_be_visible(timeout=20000)
        assert not errors, errors
        print("PASS generate, cancel, cache, save and reload, direct import, export, edit and play", backend, url, flush=True)
        page.context.close()
    browser.close()
