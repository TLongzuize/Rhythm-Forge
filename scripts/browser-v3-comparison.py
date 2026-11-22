import os,sys,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

url=sys.argv[1]
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),args=['--autoplay-policy=no-user-gesture-required','--mute-audio'])
    for track,difficulty,take,mobile in [(t,d,n,d=='hard' and n==2) for t,d in [('galaxy','easy'),('nutcracker','normal'),('unity','hard'),('galaxy','expert'),('galaxy','hard'),('nutcracker','expert')] for n in [1,2]]:
        path=Path(f'benchmarks/v3-event-validation/charts/{track}-{difficulty}-{take}.json')
        chart=json.loads(path.read_text())
        context=browser.new_context(**(pw.devices['Pixel 7'] if mobile else {}))
        page=context.new_page()
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.add_init_script("""const play = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function (...args) {
              if (this.src.startsWith('blob:')) window.acceptanceAudio = this;
              return play.apply(this, args);
            };""")
        page.goto(url,wait_until='domcontentloaded')
        page.locator('#rf-splash-logo').click()
        page.locator('[data-action="navigate"][data-screen="generator"]').first.click()
        page.locator('[data-action="choose-audio"] input').set_input_files(Path(f'audio_file_to_test/rc-playtest/{track}.wav'))
        # Wait for the selected recording before importing the take.
        page.get_by_text('Loaded ' + track + '.wav. Analyze it to generate charts.', exact=True).wait_for(timeout=30000)
        expect(page.locator('.gen-row')).to_have_count(0)
        page.locator('.gen-card [data-field="import-chart"]').set_input_files(path)
        expect(page.locator('#editor-canvas')).to_be_visible(timeout=30000)
        with page.expect_download() as exported:
            page.locator('[data-action="export-chart"]').click()
        assert json.loads(Path(exported.value.path()).read_text())==chart
        page.locator('[data-action="preview-chart"]').click()
        start=page.locator('[data-action="loader-start"]')
        if start.is_visible(): start.click()
        expect(page.locator('#game-canvas')).to_be_visible()
        page.wait_for_function("window.acceptanceAudio && !window.acceptanceAudio.paused && window.acceptanceAudio.currentTime > 0.1", timeout=30000)
        duration=page.evaluate("window.acceptanceAudio.duration")
        assert abs(duration-chart['metadata']['audioDurationMs']/1000)<0.02, (duration,chart['metadata']['audioDurationMs'])
        assert not errors,errors
        print(f'PASS {track} {difficulty} take {take}' + (' (mobile emulation)' if mobile else ''),flush=True)
        context.close()
    browser.close()
