# RF Generator V3 engineering verification

**NOT RELEASE READY.** The working tree now generates `phrase-1` by default when V3 is selected. Challenge increased across the ten recordings. The hardest Galaxy excerpt still has a large head and chord gap, independent attack agreement remains mixed, and higher Expert hand workload requires musical and physical validation. The local [comparison package](README.md) is playable. No player ratings were collected.

## Source and reversible checkpoint

The branch `codex/rf-generator-v3` started at `55c49495cddd2dd36b4d48e83439df4fbef552d2` (v0.2.2). Git history had no integrated V3 revision. The pre-existing V3 code, including `context-1`, was in the working tree. It passed all 190 baseline tests. Its prior [report](../v3-final-acceptance/REVEAL.md) and charts remain available.

The checkpoint `baseline/context-1-worktree.tar.gz` contains the original 425 modified or untracked paths. Its SHA-256 is `e0e156acc05e5e34c75bb61ecce63a6294c68bfce5cfddddf2b3658790dc8c9a`. To inspect it, extract it into an empty directory and borrow the repository's package.json to run the module files. The archive excludes the committed base and ignored audio. Restore it only on top of an isolated v0.2.2 checkout if a full revert is needed. In direct generation, `compositionRevision: 'context-1'` also replays the former notes and tempo maps using the current analysis. The primary harness compared all 32 development charts against the saved original full charts.

## Confirmed causes and changes

- RMS flux sometimes merges weak pitches into steady accompaniment. The short-window spectral pass measures new attacks in separate frequency ranges and uses a local background and neighboring-bin suppression. A longer window corroborates narrow pitched arrivals. The short window also measures transient shape. Composition admits a new timestamp with credible independent-pitch evidence or supported high-band rhythmic evidence. The existing RMS timestamps, hold detection and tempo input are preserved. This analysis describes measurements in the mixed recording. [Vibrato suppression paper](https://www.dafx.de/paper-archive/details.php?id=0oee-99Z88WL7pSo749gcA)
- The earlier composer favored isolated strong attacks and dispersed chords. The selection path now weighs evidenced arrivals and continuous transitions together. Dense selections respect a rolling key limit. Easy and Normal receive more supported detail in active phrases, while the Hard and Expert search considers denser sequences. Charts use the measured timestamps.
- Chord width is considered inside fingering with actual finger availability and a lookahead for the next heads. Repeated measured accents can form linked chords with controlled shared-finger recovery. Melodic follows pitched arrival cues, Technical uses shorter chord cadence, and Beat Focus and Relax replay their established layout paths at the same settings. Isolated compound accents can place Expert hands in controlled fixtures.
- Fingering recognizes rhythmic figures including gallops, trills and rolls and can mirror a figure to fit its entry. The layout search measures all physical chord fingers, fast reuse, workload balance and usable hold time. Reliable releases can take a clear lane on either hand or displace an optional chord key where justified. The existing reattack and moving-pitch hold rules supply release evidence.
- The single-file packager now flattens multiline V3 imports. A regression test executes the actual embedded Worker with PCM and checks the result set. This caught a packaging failure that the app-preamble test could not see.

The production files touched are `v3/sustain.js`, `v3/timeline.js`, `v3/composer.js`, `v3/quality.js`, `v3/engine.js` and `scripts/build-artifact.py`. Supporting changes are in `tests/v3-phrase.test.js`, `tests/standalone-bundle.test.js`, the annotation, difficulty and runtime harnesses, the comparison exporter and browser verification. The release tag's V1/V2 generation modules match byte for byte. V2 is the default. The existing chart schema, cache contract, Density range, deterministic seeds and automatic optimization remain in use.

## Real-audio results

All ten source filenames and hashes appear in the JSON. The first eight match the existing local benchmark recordings. No No No and Funk Abnormal Slowed were reserved for validation. All runs use identical 22.05 kHz mono PCM within each pair, Balanced, Density 1.00× and seeds 1337 + 7919 times the difficulty index. The values below are rounded to two decimals and give V2 / `context-1` / `phrase-1` notes per second.

| Recording | Easy | Normal | Hard | Expert |
| --- | --- | --- | --- | --- |
| Galaxy Collapse | 2.41 / 1.78 / 2.45 | 4.73 / 3.50 / 4.05 | 8.05 / 5.64 / 6.47 | 9.38 / 7.20 / 7.96 |
| Unity | 2.41 / 2.72 / 2.79 | 3.21 / 3.57 / 3.76 | 6.39 / 5.17 / 5.88 | 7.18 / 6.29 / 7.31 |
| Mutilator Ultra Slowed | 2.18 / 2.09 / 2.48 | 4.33 / 3.75 / 4.48 | 4.66 / 6.12 / 6.95 | 4.97 / 7.92 / 8.77 |
| Pistachio | 2.36 / 2.12 / 2.45 | 3.82 / 3.39 / 3.60 | 5.94 / 4.08 / 4.55 | 6.39 / 4.73 / 5.06 |
| Let's Go Fishin' | 2.44 / 2.27 / 2.33 | 4.86 / 3.49 / 3.93 | 6.23 / 4.87 / 5.80 | 10.74 / 5.86 / 6.64 |
| Vibe Ace | 2.23 / 1.92 / 2.54 | 4.18 / 2.99 / 3.27 | 8.12 / 3.76 / 4.46 | 9.19 / 4.64 / 5.22 |
| Dance of the Sugar Plum Fairy | 2.77 / 1.63 / 1.84 | 3.10 / 2.17 / 2.44 | 5.70 / 2.37 / 3.13 | 5.97 / 3.05 / 3.89 |
| Brahms Hungarian Dance No. 5 | 2.31 / 1.61 / 1.92 | 4.52 / 2.44 / 2.81 | 5.19 / 3.25 / 3.97 | 5.45 / 3.97 / 4.78 |
| No No No | 2.09 / 1.88 / 2.13 | 3.99 / 3.37 / 3.84 | 4.95 / 5.02 / 5.68 | 5.18 / 6.19 / 6.92 |
| Funk Abnormal Slowed | 1.90 / 1.79 / 2.62 | 3.54 / 3.35 / 3.90 | 7.08 / 4.72 / 6.04 | 7.58 / 5.92 / 7.12 |

[Primary tracks](primary.json) · [Held-out tracks](holdout.json) · [Controls](controls.json)

In Galaxy 3:20–3:40, Expert moves from 114 heads + 14 chord keys to 130 + 21. V2 has 166 + 94 in that same cut. Hard moves from 94 + 12 to 108 + 8, so its chord keys regress despite head recovery. Unity 0:20–0:40 Hard goes from 117 to 125 total keys, versus V2's 102. Nutcracker 0:12–0:32 Expert moves from 50 to 64 total keys, versus V2's 124. These are chart mechanics. The whole-song rows show why matching overall NPS would obscure these differences.

The raw reports include interval buckets, peak one- and two-second workload, key counts by finger, pattern windows, hold counts, held duration, and exact or nearby detector support. The revised Expert charts use more fast same-hand edges. Measured four-head trill and roll windows declined in aggregate. Individual hold counts or duration can also decline even while the ten-chart totals rise. Real-song three-key chord coverage remains limited. Compare individual entries before generalizing about playability or technique.

## Independent timing

The controlled masked-tone case recovers all eleven programmed arrivals within 4 ms, with zero extra spectral attacks in the vibrato control. Controlled tests also cover mixed accents, three-key fingering, gallops, chord repeats and sustained bursts. The earlier click, long tempo, syncopation and sustain tests continue to run.

The Onset_Leveau experiment used eight development excerpts and four held-out excerpts. A one-to-one matcher maximizes cardinality then minimizes absolute timing error. At ±25 ms against the individual annotations, development Expert matched heads rose from 165 of 238 chart heads to 179 of 273. On the holdout they rose from 85 of 152 to 90 of 168. At ±50 ms on the holdout, matches were 104 and 115 with 189 reference attacks. These results show better coverage with lower narrow-tolerance precision. Agreement varies by recording, and the consensus and single-annotator label sets score separately. The annotated cuts provide independent attack times. Preferred foreground and chord emphasis in the ten full recordings still need independent evidence. [Onset_Leveau provenance and label definitions](https://adasp.telecom-paris.fr/resources/2011-07-13-onset-leveau/) · [Development results](annotated-development.json) · [Holdout results](annotated-holdout.json)

The broad first-pass spectral admission was rejected. It added 125 spectral-only Expert heads on the annotated development material, of which 33 matched within ±25 ms. The retained admission charted seven, six of which matched. The additional short-spectrum low/high coincidence experiment produced only one more note in the Galaxy Expert stress cut and shifted many more chords into Unity. That experiment is excluded. The initial layout also lost Expert holds until the sustain planner was given priority over optional chord keys.

## Technical verification and integration

- All 195 automated tests passed. JavaScript syntax checks, the static build, the single-file build and the embedded Worker test passed. The 40 Balanced default-density charts were deterministic and passed schema validation with zero warnings, lane collisions, quiet-region heads or presses within 45 ms of a same-lane hold release. The legacy tempo maps matched.
- The 300-chart control sweep exercised five modes, four difficulties and five density settings across Galaxy Collapse, Unity and Nutcracker. Counts were nondecreasing at every tested slider step. Upper Hard and Expert results preserved their 1.00× chart and extended it without removing accepted 1.20× placements. All ten primary and held-out recordings had strictly increasing default note counts across the four difficulties. [Control sweep](controls.json)
- Chrome passed real Worker cancellation, same-source analysis reuse, saving and reloading a project, legacy metadata import/export, editor entry and gameplay on the static build served locally and on the single-file build opened from disk. Firefox passed generation, export, editor entry and gameplay on both builds. Chrome Pixel 7 emulation passed the compact policy and cache workflow. Every comparison take was imported, exported and started with its matching audio. One take was exercised in mobile emulation. The local WebKit launcher stalled. Safari and real Android/iOS hardware remain unverified.

| Desktop Node, 22.05 kHz mono | PCM analysis, context-1 → phrase-1 | Four-chart standard composition from cached analysis |
| --- | ---: | ---: |
| Galaxy Collapse | 1.32 → 3.09 s | 110 → 116 ms |
| Unity | 0.88 → 1.81 s | 58 → 87 ms |
| 12-minute repeat of the Galaxy development passage | 1.96 → 5.48 s | 127 → 141 ms |

The paired figures are medians from two or three repetitions and exclude decoding. Galaxy compact-policy composition took 87 → 97 ms. In separate single-process Galaxy runs, peak RSS with PCM and four compact-policy charts was 140.4 → 152.3 MiB. Those figures include Node and FFmpeg output buffers. The desktop observations and browser emulation leave actual compact-device latency and memory open. [Runtime](runtime.json) · [Isolated memory observations](memory.json)

## Reproduce

The reference Ogg directory recorded by the previous session is in `/tmp/rf-rc-audio-dir` on this workstation. Its provenance is listed in the [original comparison manifest](../v3-player-acceptance/exports/results.json). Benchmarks use the ignored local audio directory for MP3s and exact WAV excerpts. The public annotated materials are intentionally kept outside the release assets. Extract the original WAVs and both label ZIPs from Onset_Leveau. Convert their MATLAB `labels_time` arrays into JSON objects with that same key. Name the files `<recording>.goodlabels.json` for consensus and `<recording>.labels.json` for the individual labels, alongside the WAVs.

```sh
refs="$(cat /tmp/rf-rc-audio-dir)"
cache="$(mktemp -d)"
node scripts/benchmark-v3-difficulty.mjs baseline "$refs" "$cache" "$cache/baseline.json"
node scripts/benchmark-v3-difficulty.mjs candidate "$refs" "$cache" "$cache/difficulty-1.json"
node scripts/benchmark-v3-difficulty.mjs context "$refs" "$cache" "$cache/context-1.json"
node scripts/benchmark-v3-difficulty.mjs phrase "$refs" "$cache" "$cache/primary.json"
node scripts/benchmark-v3-difficulty.mjs phrase-holdout "$refs" "$cache" "$cache/holdout.json"
node scripts/benchmark-v3-difficulty.mjs phrase "$refs" "$cache" "$cache/controls.json" galaxy unity nutcracker --controls
node scripts/build-v3-difficulty-playtest.mjs "$cache" "$cache/charts" phrase
node scripts/benchmark-v3-annotated.mjs /path/to/onset-leveau development
node scripts/benchmark-v3-annotated.mjs /path/to/onset-leveau holdout
snapshot="$(mktemp -d)"
tar -xzf baseline/context-1-worktree.tar.gz -C "$snapshot" v3
cp package.json "$snapshot/"
node scripts/benchmark-v3-sustain-runtime.mjs "$snapshot" phrase
node scripts/benchmark-v3-sustain-runtime.mjs "$snapshot" phrase baseline
node scripts/benchmark-v3-sustain-runtime.mjs "$snapshot" phrase current
npm test
npm run typecheck
npm run build
python3 scripts/build-artifact.py Rhythm-Forge-Standalone-v14.5.html
```

Serve the production build locally and run `scripts/browser-v3.py` in a Playwright environment with Chrome. Pass the preview URL and standalone file URL as positional arguments. Use `RF_V3_COMPACT=1` for the Pixel 7 exercise and the compact Worker policy.

The most valuable unresolved engineering work is stronger attribution in dense mixes. On Galaxy, prioritize identifying which missed simultaneous accents really warrant multiple presses and which close attacks belong to one sound. Include Vibe Ace and Nutcracker as contrasting checks. Timing and release precision need independent reference cues for those same passages. Once those gates pass, use the matched chart package for the final player-acceptance comparison.

<details>
<summary>Take order for after play</summary>

| Pair | Take 1 | Take 2 |
| --- | --- | --- |
| Galaxy Easy | V2 | V3 |
| Nutcracker Normal | V3 | V2 |
| Unity Hard | V2 | V3 |
| Galaxy Expert | V3 | V2 |

</details>
