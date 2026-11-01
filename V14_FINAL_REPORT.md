# Rhythm Forge v14 — Final Report

## Product changes

- Removed ranked-mode badges from song cards and exposed **Local Rank** based on scores saved in this browser. Older local best-result records are included where available; there is no online account or server leaderboard.
- Added the requested **SS** grade at 99.00% accuracy.
- Implemented a documented RF 4K adaptation of osu!lazer mania ScoreV2: 1,000,000 standardised cap, 150,000 combo portion and 850,000 accuracy portion, with hold heads and tails counted as separately judged objects. This is not byte-identical osu!mania scoring; Rhythm Forge retains its own judgement windows and seven judgement tiers. See `RF_SCORE_V2_COMPATIBILITY.md`.
- Added seven selectable skins in Settings.
- Removed the Home tip panel and the keyboard/library/quick-demo footer strip visible in the supplied screenshot.
- Removed the “Unknown Artist” placeholder throughout song metadata; missing artist values are now omitted rather than fabricated.
- Added local multi-file background music management, shuffled playback without immediate repeats, automatic next-track playback, and pause/restore behavior around gameplay and song preview.
- Clicking a song in Song Select previews its audio. Menu audio-reactive icon motion is driven by Web Audio analyser values, not a fixed idle pulse.
- Repaired live song search and its empty-results state.
- Added the Rhythm Forge brand mark and refreshed application/song-selection icon styling.
- Added Tap/Hold editor tools, Tap-to-Hold conversion, hold-duration adjustment, deletion, undo and redo.
- Added phone/tablet/desktop responsive rules and portrait/landscape layouts without locking orientation.
- Debounced repeated Home navigation and avoided re-entering an already-active route.
- Translated remaining user-facing generator/cache validation messages touched by this update to English.
- Added Advanced Performance Analysis 2.0 and its documentation/reports.

## Build and test results

- Full automated suite: **102/102 passed**.
- `npm run typecheck`: passed.
- `npm run build`: passed; `dist` output 4,615,122 bytes.
- Standalone bundler regression: passed; single-file HTML generated with embedded CSS, JavaScript and demo audio.
- Standalone inline JavaScript syntax check: passed.
- ZIP archive integrity is checked during packaging.

## Runtime validation limits

Browser end-to-end was attempted, but Chromium could not navigate to the local app because the environment returned `ERR_BLOCKED_BY_ADMINISTRATOR` before app assertions. Consequently, actual UI interaction, mobile/tablet device behavior, touch input, browser audio policy, Worker and IndexedDB end-to-end have not been certified in a real browser in this environment. The supplied browser test script remains available for running locally.

## Local-only behavior and known limits

- Local Rank, background music uploads, skins and performance history are stored in the current browser profile; they do not sync between devices.
- Background music and imported songs are local files. Browsers may require a user gesture before audio playback.
- ScoreV2 is a clearly documented Rhythm Forge adaptation, not an official osu!mania ruleset implementation.
- The performance rating is provisional and has no population percentile calibration.
- Legacy plays without recorded per-note input timing cannot be retroactively given timing analysis.


## v14.1 startup hotfix

The follow-up hotfix addresses a missing production-build dependency pair (`score-v2.js` and `performance-analysis.js`), delayed first render while waiting for IndexedDB, and unguarded settings persistence when `localStorage` is unavailable. Standalone packaging now uses a flattened classic inline script, includes a pre-boot fallback, and displays Home actions immediately. See `STARTUP_HOTFIX_v14.1.md` for exact changes and test limitations.


## v14.1 verification results

- 102/102 automated tests passed.
- Typecheck/syntax checks passed for all 17 runtime modules.
- Production build passed and includes `dist/score-v2.js` plus `dist/performance-analysis.js`.
- Standalone inline script passed Node syntax validation and Chromium content smoke tests.
- Desktop navigation to Song Select, Generator and Settings passed.
- Mobile viewport smoke test at 390px showed no horizontal overflow and navigation to Song Select/Generator passed.
- Deliberately stalled IndexedDB did not prevent the first render; startup recovered after the timeout without page errors.
- The browser policy blocked direct `file://` navigation in the test environment; literal local-file launch remains unverified.
