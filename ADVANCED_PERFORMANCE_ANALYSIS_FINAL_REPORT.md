# Advanced Performance Analysis — Final Report

## Implemented

- Versioned gameplay-event model with chart-relative millisecond timestamps and signed hit error (`actual - expected`).
- Accuracy and judgement distributions using Rhythm Forge's ScoreV2 judgement mapping.
- Timing mean/median/variance, absolute error, early/late bias, percentiles, histogram and rolling progression.
- Four-lane analysis with sample-size guards and weak/strong-lane detection only when a meaningful spread exists.
- Evidence-aware stream, jack, chord, burst, jumpstream, hold and reading indicators.
- Section and pattern attribution using chart metadata when actually available.
- Progression, timing deterioration, miss clustering and recorded-hit recovery indicators.
- Provisional RF Performance Rating with score components, confidence and sample-size metadata.
- Local player skill profile, history helper, safe legacy-summary migration and evidence-based practice recommendations.
- IndexedDB persistence for recent play summaries/events and player profile; old result summaries are retained without synthetic timing events.

## Compatibility and boundaries

The analyzer consumes existing gameplay judgement results and recorded hit events. It does not replace the hit-window or judgement system. Older records without timing data keep their score/count/grade data but cannot produce timing or skill diagnoses that require missing inputs. Rating calibration has no population dataset and is explicitly provisional.

## Validation

- Full automated suite: 102/102 passed.
- Syntax/typecheck: passed.
- Production build: passed.
- Benchmarks: see `ADVANCED_PERFORMANCE_ANALYSIS_BENCHMARK.json` and `ADVANCED_PERFORMANCE_ANALYSIS_TEST_REPORT.md`.
- Browser end-to-end: blocked before navigation by the environment (`ERR_BLOCKED_BY_ADMINISTRATOR`); no browser pass is claimed.

See `ADVANCED_PERFORMANCE_ANALYSIS_DOCUMENTATION.md` for data contracts, calculations, thresholds, APIs and known limits.
