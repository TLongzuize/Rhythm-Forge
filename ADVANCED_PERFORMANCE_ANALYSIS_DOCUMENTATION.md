# Advanced Performance Analysis 2.0

## Scope and data contract

The analysis runs after a play and consumes the same judgement events used by gameplay. It does not recalculate hit judgements or fabricate replay data. Event times are chart-relative milliseconds; `hitErrorMs = actualTimeMs - expectedTimeMs`, so negative values are early and positive values are late. `eventTimestampMs` is also chart-relative (the actual input time when present, otherwise the chart clock when a miss is recorded).

A normalized event includes a schema version, stable event/note identifiers, expected and actual times, signed timing error, lane (0–3), note type, judgement, combo, section, beat position, pattern ID, difficulty, local note density, and source provenance. Invalid timestamps are skipped. Missing event arrays remain valid legacy results with analysis unavailable.

## Accuracy and judgements

The analyzer uses the project's actual ScoreV2 judgement mapping. It reports counts, percentages, weighted accuracy, and sample size. Percentages use all normalized judgement events as their denominator. Lane and note-type splits are computed from the same events. Hold heads and tails are independent objects in gameplay and are analyzed separately.

## Timing analysis

For timed events, the module calculates mean, median, standard deviation, mean/median absolute error, early/late share, bias, percentiles, and a 41-bin histogram spanning -200 ms to +200 ms at 10 ms intervals. The histogram clamps extreme errors into edge bins but preserves the sample count. Rolling windows of 24 events describe timing and accuracy drift; windows shorter than eight events are not reported. Timing diagnoses are withheld when fewer than five actual timing samples exist.

## Lane analysis

Four lanes are summarized independently for weighted accuracy, judgement distribution, timing, hold-event count, density, and sample adequacy. A lane needs at least 12 events before it can be compared. A weak/strong lane is reported only when the measured lane spread is at least two percentage points, so tied lanes are not arbitrarily labelled.

## Skill indicators

- **Stream:** continuous sequences with inter-note gaps no greater than 180 ms.
- **Jack:** repeated same-lane sequences with gaps no greater than 260 ms.
- **Chord:** groups whose expected timestamps are within 18 ms; merely close independent notes are not treated as chords.
- **Burst:** short sequences with gaps no greater than 95 ms.
- **Jumpstream:** chord and alternating-stream evidence.
- **Hold:** requires independently recorded hold-head and hold-tail judgements.
- **Reading:** a cautious indicator based on observed note density and lane changes; it is not a visual reaction-time measurement.

Every skill includes a sample size, confidence and `measured` / `insufficient-data` status. Skills without reliable chart pattern metadata remain un-attributed.

## Sections, patterns, progression and recovery

Sections are matched by expected note time against supplied chart section bounds. Pattern summaries are produced only for events with a recorded `patternId`. Progression compares the first and second half of a play. Miss recovery is measured by looking for a later recorded non-miss hit within 30 ms of its expected time in the next ten events. This is a behavioral indicator, not a claim about physical fatigue.

## RF Performance Rating

`RF Performance Rating` is a provisional local metric, not a calibrated population percentile. It combines chart difficulty, weighted accuracy, observed timing precision, combo ratio, and measured skill evidence. It requires at least five judgement events. It is versioned (`rf-performance-2.0.0`) and returns its components and confidence. There is no online population calibration or remote account service in this local-only project.

## Player profile and recommendations

The local player profile aggregates measured skills weighted by sample size. Unsupported skills are omitted. Recommendations require evidence thresholds (for example, at least 20 timing samples for an early/late timing recommendation). They include the supporting metric, a target and a suggested practice action; they do not promise improvement.

## History and migration

New plays are stored in the browser's IndexedDB `plays` store, capped at 100 records and 10,000 events per record. Player profile data is stored in `playerProfiles`. `getPerformanceHistory()` is a read-only filter/sort helper. `migrateLegacyPerformanceRecord()` wraps old summaries in the current versioned schema while preserving their score/count/grade data. It deliberately leaves event arrays empty when old plays did not record input timing, so no timing analysis is claimed.

## Public API

- `normalizePerformanceEvents(rawEvents)`
- `analyzeTiming(events)`
- `analyzeLanes(events)`
- `analyzeSkills(events, chartMetadata)`
- `analyzeSections(events, sections)`
- `analyzePatterns(events)`
- `analyzePlay(playData)`
- `calculateRFPerformanceRating(analysisInputs)`
- `updatePlayerSkillProfile(previousProfile, analysis)`
- `comparePerformances(playA, playB)`
- `generatePracticeRecommendations(analysis)`
- `getPerformanceHistory(records, options)`
- `migrateLegacyPerformanceRecord(record)`

## Limits

The project has no server, account system, or consent-based population dataset; scores and skill profiles are local to the browser. The performance analyzer can only report facts represented in recorded events and chart metadata. It cannot recover replay/input events from legacy aggregate scores. The browser end-to-end suite is supplied but could not be executed in this environment because Chromium navigation to localhost is blocked by `ERR_BLOCKED_BY_ADMINISTRATOR`.
