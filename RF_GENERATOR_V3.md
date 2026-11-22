# RF Generator V3 development report

**Status — NOT RELEASE READY.** The current experimental composition revision is `spectral-1`. V2 remains the default. The spectral envelope path measures frequency-specific arrivals, recurring intervals and simultaneous pitch evidence. The search can retain a supported chord on another finger at a measured hold start. Legacy revision options replay earlier charts. [Current evidence and reproduction commands](benchmarks/v3-event-validation/REPORT.md) · [Playable comparisons](benchmarks/v3-event-validation/README.md) · [Preserved phrase-1 report](benchmarks/v3-phrase-validation/REPORT.md)

## E.0 · Automatic generation policy

RF Generator V3 uses one automatic application policy, recorded as `generator.policyRevision: "automatic-1"` on new charts. The first revision retains Medium’s two timing hypotheses, four-layout ceiling, and stop after two consecutive unsuccessful candidates. Search scales down with event count and device class. The extra-candidate budget is 8,000 event visits per difficulty on standard devices and 3,200 on compact devices, plus the initial candidate. Workers continue to reuse the existing single-source audio analysis cache and enforce the existing decode limits.

The former browser Effort preference is ignored and left in local storage. The Worker accepts older jobs carrying an Effort option and applies automatic optimization. Chart import/export still preserves existing generator metadata, including historical Effort. Direct generator calls with an explicit legacy Effort remain available for replaying research artifacts and comparing policies. New automatic charts record the policy revision, resource class, seed, mode and generation options. V2 remains the default engine.

The paired benchmark covers the bundled demo, fractional clicks, a tempo ramp and three minutes of accented eighths. It captures Medium and Max on the pre-migration code and verifies automatic results on the updated code, using both resource classes and all four difficulties. Across **32 charts**, the tempo maps, complete notes (including lanes and hold tails), head counts, chart IDs, utility and evaluated candidate counts match the captured Medium output. A compared chart digest excludes only the policy and generation-option metadata fields that this milestone adds or removes.

| Standard class | Candidates Medium / Max / Automatic | Median ms, paired Medium / Automatic |
|---|---:|---:|
| Bundled demo | 14 / 69 / 14 | 3.78 / 3.54 |
| Fractional pulse | 15 / 62 / 15 | 2.03 / 2.02 |
| Tempo ramp | 14 / 60 / 14 | 1.54 / 1.51 |
| Long accented eighths | 15 / 71 / 15 | 28.09 / 26.28 |

Times cover generating four charts from existing analysis, including timeline interpretation. They exclude audio decoding. Across both classes, paired medians varied by up to about 7% in either direction, with no consistent slowdown. On the long fixture, pre-migration Max took 100–104 ms versus 23–32 ms for pre-migration Medium. Max changed the detailed layout on 12 of the 32 charts and increased the internal utility in those cases. There was no change to distinct head schedules or timing maps on these fixtures. Higher utility supplies no evidence of better gameplay. Users who previously regenerated with a non-Medium level may get different regenerated charts under automatic optimization.

Peak RSS in the saved report covers the entire respective Node process with all fixtures, cached analysis and both tested policies. It does not isolate per-policy memory. No new cache or ongoing service was added. [Raw measurements](benchmarks/v3-automatic-e0.json)

Verification passed with 26 focused tests and JavaScript syntax checks. The static build and regenerated single-file HTML passed Chrome smoke tests for the V2 default, absence of the selector, ignoring a saved Max preference, cancellation before and during worker work, cache reuse, automatic metadata, legacy-chart import/export, editing and gameplay entry. Firefox, Safari and mobile performance were not tested in E.0. The old chart in that smoke test is a schema-compatible fixture with legacy Effort metadata.

Reproduce against the captured baseline with:

```sh
node scripts/benchmark-v3-automatic.mjs after benchmarks/v3-automatic-e0.json
node --test tests/v3-*.test.js tests/standalone-bundle.test.js
```

E.0 changed `app.js`, `src/osu.css`, `v3/effort.js`, `v3/engine.js`, `v3/timeline.js`, `v3/worker.js`, `tests/v3-effort.test.js`, `tests/v3-worker.test.js`, `scripts/browser-v3.py`, `Rhythm-Forge-Standalone-v14.5.html`, `README.md`, `CHANGELOG.md` and this report. It added `scripts/benchmark-v3-automatic.mjs` and `benchmarks/v3-automatic-e0.json`. The existing packaging scripts already include the V3 policy module.

The remaining phase record describes the original experimental implementation and its historical benchmarks.

## Baseline and phase record

Work started on clean `main` at `55c4949`, tagged `v0.2.2`. The existing Node suite passed 138/138 in 39.37 s. The checkout contained 12 readable local MP3 files and an archived V1/V2 comparison. The measured data below come from fresh decoding and generation. The original reports and baseline archive were preserved.

| Phase | Working result and verification |
|---|---|
| 0 · Baseline | Audited the live generator routes, analysis/cache contracts, chart schema, workers, historical reports and both packaging paths. Established baseline tests before editing. |
| 1 · Timing | Measured attacks from PCM independently of a beat grid. Checked exact synthetic reference times across fixed and fractional tempos, a transition, a three-minute track, syncopation, dense fills and multiple sample rates. |
| 2 · Musical structure | Added event confidence, band evidence, measured sustain, estimated pulse, repeated phrase signatures and section intensity changes. Regression fixtures cover a swung onset, phase overrides, low bass, sustain releases and silence. |
| 3 · Composition | Generated four difficulties in five modes. Tested spacing, active holds, lane occupancy, seeded repetition, accent chords and preserved pauses. |
| 4 · Search and evaluation | Implemented five effort levels, alternative pulse sequences, deterministic layout search, a device/song budget and early stopping. Evaluated candidate costs and diminishing returns. Difficulty ratings and the layout objective await player calibration. |
| 5 · Integration | Implemented the selector, effort control, worker progress, cancellation, failure handling, single-track analysis reuse and project integration. Exercised real Web Workers and the editor/export/play flow in Chrome. |
| 6 · Validation and packaging | Built the static site and standalone HTML and ran paired benchmarks. Human preference, independent real-song annotations, cross-browser and mobile performance remain open release gates. |

## Architecture and integration contracts

The legacy app sends a cached core analysis to V1 or V2. That analysis stores normalized feature frames and candidate grid positions. Its Web Audio path can retry on the UI thread after a worker failure. V3 has a separate path from PCM because it needs source-sample timestamps and different cancellation behavior. The project database, chart editor, playback, ScoreV2, schema validator and chart result shape are reused.

| New module | Responsibility |
|---|---|
| `v3/client.js` | Decodes/resamples to 22,050 Hz through offline Web Audio, mixes stereo in a native audio graph and transfers mono PCM. Keeps one compact analysis for the active source. Terminates workers on cancellation, success or failure. Serializes native decodes so repeated cancellations cannot start multiple simultaneous decoders. |
| `v3/timing.js` | Tracks energy in three frequency bands over approximately 5 ms blocks. Uses two positive log-energy flux lags, peak followers, an adaptive threshold and waveform threshold crossing for exposed attacks. Inter-onset votes propose local periods. Circular phase concentration and a weighted linear fit rank and refine fractional pulse hypotheses in eight-second windows. |
| `v3/timeline.js` | Estimates release from same-band decay and retriggers. Finds near-silent intervals. Chooses a sequence of tempo hypotheses with a continuity penalty. Estimates four-beat accent phase and groups events into eight-beat phrases. Compares eighth-note activity masks to recognize approximate recurrence. Attaches phrase, pulse, confidence and salience to each event. |
| `v3/composer.js` | Ranks events within each phrase before applying spacing. Reuses seeded lane shapes for recurring motifs. Plans at most two-note chords and limits active holds to one on Easy/Normal and two on Hard/Expert. Both hold tails and same-lane recovery reserve the lane. |
| `v3/effort.js` | Controls timing-hypothesis breadth, event-visit budget, candidate limit and early-stop patience. Low tries one layout. Higher settings vary motif choices, preserve the best evaluated layout for the selected pulse interpretation and stop after a run of unsuccessful alternatives. |
| `v3/quality.js` | Counts collisions, heads in near-silence, density and chords. Separately estimates event support, sustain agreement, hand strain, layout variety and agreement across repeated phrases. The optimizer uses a subset of these estimates. |
| `v3/engine.js` | Composes from a shared timeline and emits schema-version-1 `{chart, diagnostics}` results, with the standard difficulty seed offsets. Serializes local BPM segments, sections, downbeat estimate, effort and resource class. |
| `v3/worker.js` | Accepts transferred samples or cached analysis, sends progress, validates all completed charts with the shared schema validator and checks lane collisions before returning the set. |

The higher-risk boundaries were stale results after cancellation or source changes, leakage of V3 data into the legacy analysis cache, and offline worker loading. Each UI generation captures its own abort signal and options. Native decoding may finish after cancellation, but its result is discarded. Standalone packaging embeds a dedicated Blob worker with the same generator and validator. The device class and song length bound the search. Browser input limits are 64/192 MiB compressed, 128/384 MiB decoded and 15/30 minutes for compact/standard devices. The decoded-size check takes effect after the browser decoder returns.

## Changes and reproduction

New source files are the eight modules above. New tests cover timing, timeline, composition, effort, evaluation and workers in `tests/v3-*.test.js`. New tools are `scripts/benchmark-v3.mjs` and `scripts/browser-v3.py`. The measured report is `benchmarks/v3-experimental.json`.

Modified files are `app.js`, `src/osu.css`, `scripts/build.py`, `scripts/build-artifact.py`, `scripts/syntax-check.mjs`, `Rhythm-Forge-Standalone-v14.5.html`, `README.md` and `CHANGELOG.md`. V1/V2 generation source and their existing tests retain their baseline contents.

Run from the repository root.

```sh
npm test
npm run typecheck
npm run build
python3 scripts/build-artifact.py /tmp/rhythm-forge-v3.html
node scripts/benchmark-v3.mjs --synthetic > /tmp/rf-v3-fixtures.json
node scripts/benchmark-v3.mjs > /tmp/rf-v3-comparison.json
```

For the browser check, serve the build with `npm run preview`, then run `python3 scripts/browser-v3.py` in a Python environment with Playwright and Chromium. The script opens isolated contexts for the hosted and standalone builds. `CHROMIUM_PATH` selects an installed Chromium executable and `RHYTHM_FORGE_URL` overrides the preview URL. The MP3 benchmark uses FFmpeg and accepts explicit file paths. On a clean checkout without local MP3s it uses the bundled demo WAV. The synthetic-only run uses Node.

### Verification results

| Command or check | Observed result |
|---|---|
| `npm test` on the release tag, then on the V3 branch | 138/138 before changes and 157/157 after changes. Zero failed, cancelled or skipped Node tests. Final run took 40.83 s. |
| `npm run typecheck`, `npm run build`, `python3 scripts/build-artifact.py Rhythm-Forge-Standalone-v14.5.html` | All passed. The typecheck script checks JavaScript syntax. The standalone test also executes its generated script preamble. |
| `python3 scripts/browser-v3.py` with local Chrome for Testing | Passed for the served production build and direct-file standalone. Both imported audio, cancelled before and during worker processing, reused cached analysis on regeneration, exported chart JSON from the editor and opened the playfield. |
| Browser parity against a separate site built from `git archive v0.2.2` | Generated the demo through each site's ordinary UI. Sorted-key JSON hashes of each difficulty's note array matched across versions for V1 and V2, eight comparisons total. |
| `node scripts/benchmark-v3.mjs` and a fresh `--synthetic` run | Completed for 12 real files plus four fixtures. The synthetic-only rerun reproduced the independent timing results. |
| Existing `python3 scripts/browser_test.py` | Fails at the expected dashboard heading “Make every beat count.” on both the untouched tag and this branch. Later assertions in that legacy script did not run. One intermediate attempt also timed out waiting for network idle before reaching that assertion. |
| Human comparison, mobile device testing, Firefox and Safari | Pending. The Chrome smoke test checks the playfield opens and the generator/editor flow works. |

## V2 versus V3

Each pair received the same decoded mono samples, Balanced mode, difficulties and seeds (1337 plus 7919 times the difficulty index). V3 used Medium effort and the standard resource class. The fresh report contains file hashes, separate analysis/generation durations, per-chart counts, candidate passes, structural checks, evaluator breakdown and temporal thirds for fixtures. [Raw measurements](benchmarks/v3-experimental.json)

**Independent timing.** The times programmed into each synthesizer are the reference. Each distinct chart head is compared with its nearest reference attack. Chords count once. Coverage counts distinct reference attacks within 35 ms of any head. This exposes charts that obtain low error by omitting most attacks. The table shows Normal. All four difficulties are in the raw report.

| Synthetic fixture | V2 MAE / P95, ms | V3 MAE / P95, ms | Reference coverage, V2 / V3 |
|---|---:|---:|---:|
| 120 BPM | 0.00 / 0.00 | 0.00 / 0.00 | 48 of 48 / 48 of 48 |
| 127.43 BPM | 0.74 / 1.67 | 0.25 / 0.49 | 89 of 90 / 90 of 90 |
| 90 → 144 BPM | 0.66 / 1.67 | 0.22 / 0.33 | 80 of 81 / 81 of 81 |
| 90 → 150 BPM ramp | 22.80 / 51.34 | 0.25 / 0.49 | 27 of 60 / 60 of 60 |

On the ramp, V3 MAE for the opening, middle and closing thirds was 0.17, 0.28 and 0.28 ms. These fixtures have discrete attacks. They give little evidence about perceptual timing in vocals, reverb or overlapping instruments.

**Real audio.** Each engine produced 48 valid charts across 12 files, with zero validator warnings and zero measured lane collisions. V3 produced zero heads in measured near-silence and V2 produced 20. Here near-silence means all three band levels stayed below 0.0005 for at least 100 ms. Real-song MAE and P95 are recorded as null because independent annotations were unavailable.

| Median per MP3 | V2 | V3 |
|---|---:|---:|
| PCM analysis including V3 timeline preparation | 2,288.23 ms | 35.36 ms |
| Composition of all four charts | 4,730.84 ms | 5.96 ms |
| Analysis and four charts combined | 7,019.06 ms | 41.97 ms |
| Easy / Normal / Hard / Expert notes per second | 2.21 / 3.80 / 7.12 / 7.60 | 1.18 / 2.00 / 3.28 / 4.94 |

These are single-process Node v24.16.0 measurements on macOS x64. They exclude FFmpeg, browser decoding, worker startup, external validation and project saving. Each median is calculated across songs separately. Peak process RSS across the entire paired run was 400.7 MiB, including the benchmark harness, inputs and both engines. Separate device or per-engine memory peaks were not measured.

The full-mix benchmark exposed an overly restrictive absolute chord threshold. Using phrase-local prominence and cross-band or pulse evidence gave 0, 52, 709 and 1,252 chord heads across Easy through Expert. Holds accounted for 8.9–10.4% of V3 notes across difficulty groups. Whether these choices make the maps feel better needs playtesting.

**Effort.** Medians below are for repeated Hard generation on those same 12 songs, with decoded features reused. Candidate counts are medians of integer counts. Utility scores the engine's own layout preferences. Medium can select a different pulse interpretation from Low. Results also vary with JIT warm-up and device class.

| Effort | Layouts evaluated | Timeline and search | Layout utility |
|---|---:|---:|---:|
| Low | 1 | 2.94 ms | 0.6925 |
| Medium | 3 | 4.52 ms | 0.6871 |
| High | 7.5 | 5.59 ms | 0.6951 |
| Ultra | 11 | 7.34 ms | 0.6951 |
| Max | 16.5 | 9.87 ms | 0.6951 |

High, Ultra and Max had the same median utility at four decimal places. This corpus provides little support for spending the Max budget by default.

## Independent playtest and release gates

1. A moderator selects passages before generation, including slow attacks, swing, dense percussion, tempo transitions and quiet sections. Include material outside this mostly electronic local corpus. Retain file hashes, decoder, seeds, difficulty, mode, effort and resource class.
2. For each song/difficulty pair, generate V2 and V3 from the same source. The moderator assigns anonymous A/B identifiers with a recorded random seed, keeps the engine key private, and alternates which chart is played first across testers. Load the charts before handing the player the controls. Keep latency calibration, audio device, playback rate, note speed, skin and holds display fixed.
3. Each tester plays the same full song or preselected passage on both charts. Collect independent 1–7 ratings for synchronization, musical emphasis, flow, physical playability and enjoyment. Ask for a paired preference with a tie option and timestamped examples. Lock responses before revealing identities.
4. Have annotators independently mark audible attacks and plausible sustain releases on uncharted audio. Preserve disagreements and ambiguous ranges. Report head MAE/P95, coverage and false-positive rates separately for each region and song. Report paired preferences and uncertainty across songs and players, including ties.
5. Use these observations to calibrate event thresholds, chord/hold placement and difficulty, then repeat on a held-out set. Exercise longer tracks on lower-memory devices and compare Safari and Firefox decoding, worker behavior and file-based playback before a release candidate.

The present system assumes common four-beat grouping and eight-beat phrase windows. Quiet or legato melodies can supply too few attacks. Coarse bands can merge simultaneous voices, and energetic reverb can extend a sustain. Time-varying pulse estimation has eight-second resolution and can select a half-time or double-time alias. Layout recurrence and the numerical difficulty rating are heuristics. The benchmark includes differently named recordings of closely related material. No blinded player ratings have been collected.
