# Rhythm Forge v14.1 — Startup Hotfix

## Root causes addressed

1. The v14 production build copied `app.js` but omitted its new imports `score-v2.js` and `performance-analysis.js`. A deployment opened from `dist/index.html` therefore failed to resolve the app module and remained blank.
2. The app awaited all IndexedDB reads before its first render. A browser that blocks or stalls IndexedDB while opening a local HTML file could leave `#root` empty indefinitely.
3. `saveSettings()` did not catch `localStorage` access errors, which occur in some local-file and privacy-restricted contexts.
4. The standalone HTML used an inline ES module even though all module imports had already been flattened.
5. Home action buttons were initially hidden behind the animated logo's collapsed strip.

## Fixes

- `scripts/build.py` now copies `score-v2.js` and `performance-analysis.js` to `dist/`.
- `init()` renders immediately, loads persisted data asynchronously, then hydrates and re-renders.
- IndexedDB calls have a 4.5-second timeout and fall back through existing safe storage paths.
- Settings writes tolerate unavailable `localStorage`.
- Standalone output uses one classic inline script and contains no external module imports.
- Standalone HTML includes a visible pre-boot fallback.
- Home launches with Play/Edit/Generate/Import actions visible.

## Verification

- Automated suite: **102/102 PASS** (`npm test`).
- JavaScript syntax: **PASS** for all runtime modules, including ScoreV2 and Performance Analysis (`npm run typecheck`).
- Production build: **PASS** (`npm run build`); verified `dist/score-v2.js` and `dist/performance-analysis.js` are present.
- Standalone inline script: **PASS** (`node --check`); one classic script, no unresolved `import`, `export`, or `import.meta`.
- Chromium smoke test: **PASS** when loading the exact standalone HTML content into a browser page. Desktop navigated through Home, Song Select, Generator and Settings. Mobile at 390px navigated through Home, Song Select and Generator with no horizontal overflow.
- Startup resilience: **PASS** with IndexedDB deliberately stalled; the app rendered immediately, recovered after its 4.5-second timeout and produced no page errors. JavaScript-disabled fallback was also verified visible.
- ZIP integrity: **PASS** (`unzip -t`).
- Limitation: direct navigation to `file://` is blocked by the execution environment's browser policy, so this is not claimed as a literal local-file launch test. The single-file bundle was instead exercised as the exact HTML content in Chromium.
