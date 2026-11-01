<div align="center">
  <img src="public/favicon.svg" width="88" alt="Rhythm Forge logo" />

  # Rhythm Forge

  **A four-lane rhythm game that turns your music into playable charts — right in your browser.**

  ![Version 0.1.0](https://img.shields.io/badge/version-v0.1.0-ff66aa)
  ![Status Alpha](https://img.shields.io/badge/status-alpha-orange)
  ![Runtime dependencies: zero](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)
  ![MIT license](https://img.shields.io/badge/license-MIT-blue)

  [![Play Rhythm Forge](https://img.shields.io/badge/PLAY%20ONLINE-Rhythm%20Forge-7a5cff?style=for-the-badge)](https://tlongzuize.github.io/Rhythm-Forge/)

  [Download current pre-release](https://github.com/TLongzuize/Rhythm-Forge/releases/tag/v0.1.0-pre.1)

  [Report a bug](https://github.com/TLongzuize/Rhythm-Forge/issues/new) ·
  [Source code](https://github.com/TLongzuize/Rhythm-Forge) ·
  [Contributing](#contributing)
</div>

---

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Play online](#play-online)
- [Getting started](#getting-started)
- [How to play](#how-to-play)
- [Chart generator](#chart-generator)
- [Chart editor](#chart-editor)
- [Scoring and performance analysis](#scoring-and-performance-analysis)
- [Settings](#settings)
- [Data and privacy](#data-and-privacy)
- [Run and test locally](#run-and-test-locally)
- [Deployment](#deployment)
- [Project structure](#project-structure)
- [Browser support](#browser-support)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Credits](#credits)
- [License](#license)

## Overview

Rhythm Forge is a local-first, four-key browser rhythm game, chart generator, and editor. Import a song, analyze its rhythm, generate charts across four difficulties, and play or refine them without uploading your audio to a server.

The project is built with plain HTML, CSS, and JavaScript. It has **no runtime package dependencies** and needs no application server or account. Your imported songs, charts, settings, and results stay in your browser.

> **Version 0.1.0 — Alpha.** The project is actively evolving. Features, saved data formats, and balance may change; keep exports of charts you want to preserve.

## Features

### Play

- Four-lane gameplay with keyboard and touch input.
- Tap notes and hold notes, including separate hold-head and hold-tail judgements.
- Four chart difficulties: Easy, Normal, Hard, and Expert.
- Pause, resume, retry, quit, and results screens.
- Searchable song library, difficulty selection, and a built-in demo track.
- Timing offset controls, hit-error feedback, combo, accuracy, and gameplay HUD settings.
- Responsive layouts for phones, tablets, portrait, and landscape screens; orientation is not locked.

### Generate and edit charts

- Import audio and analyze its energy, onsets, tempo, and beat grid in the browser.
- Generate seeded, repeatable charts with difficulty-specific note density and patterns.
- Review or adjust BPM, beat offset, and generation settings when automatic detection needs help.
- Edit charts on a timeline: add, move, remove, and inspect notes; place holds, convert taps to holds, and adjust hold duration.
- Undo and redo edits, validate charts, and import or export chart JSON.
- Use analysis workers where available; the generator has a main-thread fallback.

### Make it yours

- Rebind keys and adjust scroll speed, note size, receptor size, lane spacing, hit position, and HUD scale.
- Choose from seven skins and customize accent colors and visual effects.
- Configure audio levels and menu music playback.
- Review local results and post-play timing, lane, and skill analysis.

## Play online

After enabling GitHub Pages and completing the first deployment, play at **[tlongzuize.github.io/Rhythm-Forge](https://tlongzuize.github.io/Rhythm-Forge/)**. The workflow deploys on pushes to `main` and builds a self-contained HTML page so the game works from the repository's Pages subpath.

To embed the game on another website, use:

```html
<iframe
  src="https://tlongzuize.github.io/Rhythm-Forge/"
  title="Play Rhythm Forge"
  width="100%"
  height="720"
  loading="lazy"
  allow="autoplay; fullscreen"
  allowfullscreen
></iframe>
```

GitHub sanitizes iframe markup in repository READMEs, so use the **Play online** link above to open the game from GitHub. The iframe snippet is for pages you control.

## Getting started

1. Open the [online game](https://tlongzuize.github.io/Rhythm-Forge/).
2. Click the logo or start screen once to allow the browser to play audio.
3. Choose **Play** and select the built-in **NEON CIRCUIT** demo, or use **Import** to add an audio file from your device.
4. Open **Generate**, analyze the song, and create its charts.
5. Return to **Play**, choose a difficulty, and start playing.

Audio format support depends on your browser and operating system. The game does not upload imported audio.

## How to play

| Lane | Default key |
|:----:|:-----------:|
| 1 | `D` |
| 2 | `F` |
| 3 | `J` |
| 4 | `K` |

Keys can be changed in Settings. On touch devices, tap or hold the matching lane.

- **Tap note:** press when the note reaches the receptor.
- **Hold note:** press on the head, keep the input held, and release at the tail.
- **Pause:** use the in-game pause control; continue, retry, or quit from the pause screen.
- **Timing feels off?** Adjust the global timing offset in Settings or the offset for the selected song.
- **No sound after opening the page?** Click once in the game. Browsers require a user gesture before starting audio.

## Chart generator

The generator analyzes a selected song and composes charts from its rhythm:

1. **Decode audio** in the browser using the Web Audio API.
2. **Analyze signal features**, including energy and onset-like changes.
3. **Estimate tempo and beat grid** and expose timing settings for manual correction.
4. **Compose patterns** and difficulty-specific note density, including taps and holds.
5. **Validate and review** the generated charts before playing or editing them.

Generation is seeded, so repeating the same analysis with the same settings can reproduce a chart. Results depend on the audio and browser decoder; automatic beat detection is an estimate, not a guarantee.

When a chart feels out of sync, adjust its BPM or beat offset and generate it again. Use the editor to make final timing and lane changes.

## Chart editor

Open a chart from the library or generator to edit it. The editor supports:

- Adding and selecting tap or hold notes.
- Moving notes in time and between lanes; deleting selected notes.
- Converting a tap into a hold and adjusting hold duration.
- Undo and redo, beat-grid snapping, and chart validation.
- Previewing a chart and saving it to the local library.
- Importing and exporting charts as JSON.

Chart JSON can be backed up or shared independently of the song audio. Imported chart metadata does not include a copy of the original audio.

## Scoring and performance analysis

Rhythm Forge uses a documented adaptation of osu!lazer mania ScoreV2:

- A standardized maximum score of **1,000,000**.
- Separate accuracy and combo contributions (850,000 and 150,000 points respectively).
- Timing judgements, accuracy, combo, and a local best-result list.
- Hold notes are judged at the head and tail.
- A post-play analysis of timing distribution, early/late bias, consistency, and per-lane accuracy.
- Skill indicators and practice suggestions when enough play data is available.

The analysis and skill profile are local and provisional. They are intended as practice feedback, not as a ranked score or a universal measure of ability. See [RF_SCORE_V2_COMPATIBILITY.md](RF_SCORE_V2_COMPATIBILITY.md) and [ADVANCED_PERFORMANCE_ANALYSIS_DOCUMENTATION.md](ADVANCED_PERFORMANCE_ANALYSIS_DOCUMENTATION.md) for implementation details.

## Settings

| Area | Examples |
|---|---|
| Input and timing | Key bindings, global timing offset, scroll speed, hit position, upscroll |
| Layout and skin | Note and receptor size, lane spacing, opacity, HUD scale, seven game skins, accent color |
| HUD | Score, accuracy, combo, judgement, BPM, clicks per second, progress, hit-error display |
| Audio and effects | Music and hit-sound volume, visual effects, reduced motion |
| Background and menu music | Background appearance, menu music tracks, playback and volume |
| Data | Reset local results and history, or delete stored songs |

Settings are saved automatically in browser storage.

## Data and privacy

- No account, application backend, or analytics service is required to play.
- Imported songs are analyzed locally and are not uploaded.
- Songs, charts, results, and play history are stored in IndexedDB when available. Settings and small fallback values use localStorage.
- Data belongs to the browser and site origin. Clearing browser/site data removes it; export important charts as JSON.
- Browser storage limits and private-browsing policies vary. Keep local copies of audio and chart exports you care about.
- The included **NEON CIRCUIT** demo is a locally generated original audio sample.

## Run and test locally

### Requirements

- Python 3 for the development server and build scripts.
- Node.js 18 or newer for the automated test suite.
- A modern browser with JavaScript modules, Canvas 2D, IndexedDB, and Web Audio API.

There are no npm packages to install for normal development.

```sh
git clone https://github.com/TLongzuize/Rhythm-Forge.git
cd Rhythm-Forge
npm run dev
```

Open <http://127.0.0.1:4173>. Do not open the source `index.html` directly with `file://`; the source app uses JavaScript modules and root-relative assets. For direct file opening, generate a standalone bundle:

```sh
python3 scripts/build-artifact.py rhythm-forge.html
```

### Useful commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the local development server at port 4173 |
| `npm run build` | Build the static source site into `dist/` |
| `npm run preview` | Preview `dist/` at port 4174 |
| `npm test` | Run the Node.js automated test suite |
| `npm run typecheck` | Syntax-check browser JavaScript modules |
| `npm run browser:test` | Run browser smoke tests (requires Playwright and Chromium) |
| `npm run benchmark` | Run chart-generator benchmarks |
| `python3 scripts/build-artifact.py <output.html>` | Create a self-contained standalone HTML game |

For browser smoke tests, install Playwright and Chromium in your development environment, start `npm run dev`, then run `npm run browser:test`.

## Deployment

Before the first deployment, open the repository's [Pages settings](https://github.com/TLongzuize/Rhythm-Forge/settings/pages) and set **Build and deployment → Source** to **GitHub Actions**. The workflow in [`.github/workflows/pages.yml`](.github/workflows/pages.yml) then deploys automatically from pushes to `main`. It bundles the game and built-in demo into one `index.html`, then publishes it to:

<https://tlongzuize.github.io/Rhythm-Forge/>

To host elsewhere, run the standalone build command and publish the resulting HTML file as the host's `index.html`. The regular source build uses root-relative asset paths and may need path changes when hosted below a domain subpath.

Stable releases are created from tags such as `v0.1.0`; tags containing `-pre` create pre-releases. The [release workflow](.github/workflows/release.yml) and [pre-release workflow](.github/workflows/prerelease.yml) attach a standalone HTML game and a ZIP package containing the game, README, and MIT license to each GitHub Release.

## Project structure

```text
.
├── index.html                 # Application shell
├── app.js                     # UI, gameplay, editor, and local storage
├── core.js                    # Audio analysis, settings, chart validation
├── smartgen.js                # Chart generation orchestration
├── tempomap.js, beatgrid.js   # Tempo and beat-grid analysis
├── sections.js, patterns.js   # Song sections and note patterns
├── difficulty.js, compose.js  # Difficulty profiles and chart composition
├── autofix.js                 # Chart validation and repair
├── score-v2.js                # ScoreV2-compatible scoring
├── performance-analysis.js    # Post-play analysis
├── analysis-worker.js         # Audio-analysis worker
├── gen-worker.js, genclient.js # Chart-generation worker and client
├── src/                       # Application styles
├── public/                    # Icons and bundled demo audio
├── scripts/                   # Build, server, test, and benchmark scripts
└── tests/                     # Automated tests
```

## Browser support

Use a current version of a browser that supports JavaScript modules, Canvas 2D, IndexedDB, and Web Audio API. Audio codecs, touch behavior, storage quotas, and output latency vary by browser, operating system, and device. The project is not tested on every browser/device combination.

## Troubleshooting

| Problem | What to try |
|---|---|
| No sound after reload | Click the game once to satisfy the browser's audio-activation requirement. |
| Hits feel early or late | Adjust the global or per-song timing offset. Bluetooth devices may add latency. |
| The chart does not match the beat | Check the detected BPM and beat offset, adjust them, and regenerate. |
| A song is missing after returning | Browser storage may have been cleared, or you may be using a different browser or site origin. |
| A song cannot be imported | Try a browser-supported audio format and check available browser storage. |
| The source page is blank when opened from disk | Run `npm run dev`, or create and open a standalone HTML build. |
| The online game link is unavailable | Check the latest **Deploy to GitHub Pages** workflow run in the repository's Actions tab. |

## Known limitations

- This is Alpha software; expect rough edges and breaking changes.
- Tempo and onset detection are heuristic. Some tracks need manual BPM/offset adjustments.
- Audio decoding and output latency depend on the browser and device.
- Browser storage is local to the current browser and site; there is no cloud sync.
- Automatic chart generation is not transcription and may need editing for unusual rhythms or tempo changes.
- Browser smoke tests cover selected flows, not every codec, device, timing, or accessibility scenario.

## Roadmap

Development priorities may change. Check the [open issues](https://github.com/TLongzuize/Rhythm-Forge/issues) for current requests and planned work, or open an issue to suggest a feature.

## Contributing

Bug reports, feature ideas, and pull requests are welcome.

1. Open an issue before making a large or behavior-changing contribution.
2. Fork the repository and create a focused branch.
3. Run `npm test` and `npm run typecheck`.
4. Describe the change, how it was tested, and any user-visible behavior changes in your pull request.

For bug reports, include the browser and version, device/operating system, reproduction steps, and relevant console errors. Do not attach music unless you have the right to share it.

## Credits

- Inspired by the gameplay and interface conventions of **osu!mania** and **osu!lazer**. Rhythm Forge is an independent project and is not affiliated with or endorsed by osu! or ppy Pty Ltd.
- The bundled **NEON CIRCUIT** demo is an original synthesized sample created for this project; it is not an NCS recording.
- Typography uses Orbitron and Nunito when the Google Fonts service is available. Local fallback fonts are used otherwise.

## License

Rhythm Forge is released under the [MIT License](LICENSE).
