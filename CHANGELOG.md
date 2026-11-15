# Changelog

All notable changes to Rhythm Forge are documented in this file. The project follows [Semantic Versioning](https://semver.org/).

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

[0.2.0]: https://github.com/TLongzuize/Rhythm-Forge/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TLongzuize/Rhythm-Forge/releases/tag/v0.1.0
