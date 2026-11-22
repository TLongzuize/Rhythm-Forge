# Changelog

All notable changes to Rhythm Forge are documented in this file. The project follows [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-11-22

### Added

- RF Generator V3 is available as Experimental. It uses spectral attack evidence, phrase-based selection, and automatic layout optimization. V3 runs in a cancellable Worker in the web and standalone builds. [Development report](RF_GENERATOR_V3.md)
- Added Autoplay and Autoplay like human to Song select. Human autoplay has an adjustable 0–100% accuracy target. Both modes are unranked and support seeking and a five-second rewind.
- Added replay from the results screen. Click a score in Local rank to reopen the result and watch the recording when one is available.

### Changed

- RF Generator V2 is labeled Our Advanced Generator and Default. RF Generator V3 is labeled Next-Generation Chart Generator and Experimental. Engine preferences are retained.
- Removed the V2 introduction and V3 teaser from the welcome screen and standalone package.

### Fixed

- Loaded audio earlier and removed redundant seeks at song start.
- Bundled Orbitron so the gameplay HUD renders consistently in the offline build.
- Positioned autoplay and replay controls below the Hit Error display.

## [0.2.2] - 2026-11-18 — Small Bug Fixes

- Redrew Orb holds as a continuous capsule with matching round ends. Removed the extra tail note from the other five skins.
- Adjusted the skin preview and softened transitions across the welcome screen, song list, and video player, with support for Reduced Motion.
- Rebuilt the RF Generator V2 introduction and V3 concept teaser for the welcome screen and standalone release.

## [0.2.1] - 2026-11-16

### Added

- A 66-second RF Generator V2 introduction covering timing, hold planning, patterns, difficulty modes, reproducibility, and documented V1/V2 measurements.
- A 36-second RF Generator V3 teaser, “Our Flagship Generator — Coming soon...”.
- Welcome-screen video buttons with playback controls, Escape dismissal, and embedded offline video in the standalone release.
- Red screen-edge low-health feedback below 25% HP, with static feedback under Reduced Motion.
- Independent color pickers for all four note lanes and a separate skin accent color.
- Friday Night Funkin-inspired Arrow note and receptor skins mapped by lane as Left, Down, Up, Right.
- Skin-specific long notes: hold bodies, heads, and tails now match Orb, Mania, Diamond, Neon, Minimal, and Arrow styles, including the live preview.
- Independent `0.50×`–`2.00×` scale controls for notes and receptor buttons, with live preview.

### Changed

- Score, accuracy, combo, live BPM, CPS, peak CPS, RP, health, and song progress now transition smoothly instead of jumping between values.
- The desktop health bar is substantially wider and taller, with clearer percentage feedback and accent-aware glow.
- Moved health to the upper playfield to clear the combo display.
- Accuracy now has a dedicated label and vertical row so it no longer collides with ScoreV2 cells.
- The selected skin accent now drives HUD labels, lane guides, health, and progress colors.

### Fixed

- Prevented the live skin preview from clipping receptors at the maximum scale.
- Preserved custom lane colors and scale settings safely across reloads and older saved preferences.

## [0.2.0] - 2026-11-15

### Added

- RF Generator V2 with fractional-BPM refinement, tempo-alias stabilization, continuous segment-local tempo maps, and explicit onset-latency compensation.
- Evidence-ranked long-note planner with sustained-audio checks, same-lane clearance, grid-safe tails, active-hold limits, and bounded hold ratios.
- Live and post-play Rhythm Points (RP) using the existing confidence-aware performance-rating model.
- Gameplay Lab with `0.50×`–`1.50×` playback rates and looped Practice Mode section controls.
- Twelve-beat timing calibration wizard with a median-error offset recommendation.
- Digital, Classic, and Soft synthesized hit-sound skins.
- Previous-play ghost pulses based on locally recorded input events.
- Live note and receptor skin preview.
- Runtime tempo-map fallback for legacy charts that only contain BPM metadata.
- Real-audio and synthetic validation scripts, RF Generator V2 tests, and reproducible benchmark reports.

### Changed

- ScoreV2 HUD now uses stable seven-cell score rendering and fixed-position accuracy characters to prevent end-of-map expansion and jitter.
- Accuracy is calculated from judged objects while map completion remains a separate metric.
- BPM display uses the tempo-map segment at the current song position and respects playback rate.
- CPS reports raw presses in the last second and preserves the session peak.
- Health now supports complete fail/no-fail behavior; failed plays remain analyzable but cannot become personal bests or update the skill profile.
- Practice plays do not submit scores, RP, or skill-profile updates.
- Long-note generation is substantially more conservative and avoids multi-lane hold walls.
- UI/UX received a visual polish pass while preserving the original navigation, controls, and gameplay structure.
- Expanded customization to nine playfield themes, five note skins, and four receptor skins.
- Updated the self-contained standalone build and production source manifest for Generator V2.

### Fixed

- Removed score/accuracy HUD shaking caused by proportional-width updates and eased score interpolation.
- Fixed score growth caused by using map progress as live accuracy.
- Fixed incorrect BPM and clicks-per-second readouts.
- Fixed hold heads and tails being counted inconsistently in ScoreV2.
- Fixed long notes being generated from isolated percussion or reverb tails.
- Fixed integer-only BPM drift and common half-time/double-time aliases.
- Fixed the rate selector initially displaying `0.50×` when the saved value was `1.00×`.
- Migrated the legacy `showPP` preference to `showRP`; PP and RP now refer to the same Rhythm Points system in the web app.

### Validation

- The complete automated suite passes across tempo maps, ScoreV2, performance analysis, RF Generator V1/V2 compatibility, hold constraints, silence handling, triplets, and standalone bundling.
- Production and standalone builds pass syntax and headless Chromium startup checks.

## [0.1.0] - 2026-10-31

### Added

- Initial alpha release with four-lane keyboard/touch gameplay, local song library, browser-based audio analysis, chart generation and editing, ScoreV2, local results, skins, and a standalone HTML build.

[0.2.1]: https://github.com/TLongzuize/Rhythm-Forge/compare/v0.2.0...v0.2.1
[0.2.2]: https://github.com/TLongzuize/Rhythm-Forge/compare/v0.2.1...v0.2.2
[0.2.0]: https://github.com/TLongzuize/Rhythm-Forge/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TLongzuize/Rhythm-Forge/releases/tag/v0.1.0

[0.3.0]: https://github.com/TLongzuize/Rhythm-Forge/compare/v0.2.2...v0.3.0
