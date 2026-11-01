# Rhythm Forge v14 — Changelog

- Reworked scoring to a documented RF 4K adaptation of osu!lazer mania ScoreV2: 1,000,000 standardised cap, 150k combo / 850k accuracy, ordered combo sequence and independent hold tail judgement.
- Added SS at 99.00% accuracy.
- Removed ranked-mode badges and changed score listing to browser-local Local Rank. Older locally stored best results are retained in the local list.
- Added seven selectable game skins in Settings.
- Removed the Home tip card and keyboard/library/demo footer strip shown in the supplied reference image.
- Added local background music playlist management: multi-file import, shuffled playback without immediate repeats, automatic next track, and pause during gameplay/song preview.
- Song selection clicks now preview the selected track; audio-reactive pulse effects use Web Audio analyser data rather than a fixed animation.
- Repaired search filtering and no-results feedback; artist fields no longer display an “Unknown Artist” placeholder.
- Added a branded Rhythm Forge mark and refreshed song selection/application icon treatment.
- Added hold-note placement, tap-to-hold conversion, duration editing and deletion in Chart Editor.
- Added responsive layout rules for narrow phones, portrait/landscape play screens and tablet widths; the game does not lock orientation.
- Debounced the Home logo interaction and made repeated navigation to the current route a no-op.
- Added versioned Advanced Performance Analysis, timing histograms, lane/skill analysis, progression/recovery indicators, provisional RF Performance Rating, local skill profile, recommendations and legacy-safe migration helpers.
- Translated remaining user-facing Smart Chart Generator quality/error messages to English.

## v14.1 — startup and standalone compatibility hotfix

- Render the first application shell immediately instead of waiting for IndexedDB; persisted data hydrates and re-renders after loading.
- Add a 4.5-second timeout and fallback for blocked/stalled IndexedDB requests.
- Make settings persistence tolerate browsers that deny `localStorage` in local-file or privacy-restricted contexts.
- Build the standalone artifact as a flattened classic inline script (no external ES-module imports), improving direct `file://` compatibility.
- Add a visible pre-boot fallback so a disabled script no longer presents as a completely empty black page.
- Keep the Home action strip expanded at first launch so Play, Edit, Generate and Import are immediately discoverable.
- Fix production build output: include `score-v2.js` and `performance-analysis.js`, which were imported by `app.js` but omitted from `dist/` in v14.
