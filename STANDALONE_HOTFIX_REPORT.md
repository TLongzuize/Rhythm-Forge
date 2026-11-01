# Rhythm Forge — Standalone Hotfix

## Changes

- Fixed the single-file HTML bundler dependency scope. It now gathers every named import from `core.js` used by `app.js`, `tempomap.js`, `compose.js`, and `smartgen.js`, then binds those exports from the shared core namespace. This restores `inferTempo` for the flattened `tempomap.js` module.
- Added a build-time assertion that fails if a flattened module imports a core export that does not exist.
- Replaced the Generator mode dropdown with five osu!-inspired selectable mode cards: Balanced, Beat Focus, Melodic, Technical, and Relax. Cards have mode-specific accents, descriptions, selected state, keyboard focus indication, and responsive layouts.
- Connected card clicks to the existing generation mode state, so the selected mode is used by the existing chart-generation pipeline.
- Added `tests/standalone-bundle.test.js` to build the single-file artifact and execute a tempo-map smoke test from the flattened module preamble.

## Validation

- Automated suite: 65/65 tests pass when run with `node --test --test-concurrency=2 tests/*.test.js`.
- JavaScript syntax check: passed.
- Production static build: passed.
- Standalone inline module syntax check: passed.
- Standalone bundle smoke test: passed; generated tempo map reports 120 BPM on a synthetic 120 BPM pulse.
- Browser UI validation: not completed. Chromium navigation to the generated local HTML is blocked by the execution environment with `ERR_BLOCKED_BY_ADMINISTRATOR`; no claim of end-to-end browser validation is made.

## Standalone runtime note

The standalone artifact intentionally falls back to main-thread analysis/generation instead of module Workers. IndexedDB is used when the browser permits it, with the existing memory-cache fallback otherwise.
