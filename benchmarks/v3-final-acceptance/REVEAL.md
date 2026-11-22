# RF Generator V3 · Contextual chart comparison

**Decision — NOT RELEASE READY.** The integrated revision is mechanically valid on the tested material. The reported challenge deficit is unresolved, particularly on dense Expert passages and on several recordings outside electronic music. Gameplay preference and difficulty parity remain unverified.

## Diagnosis

In Galaxy Collapse 3:20–3:40, V2 Expert uses 166 heads and 94 additional chord keys. The previous V3 uses 113 heads and 8 additional chord keys. The chord-key gap accounts for 86 of the 139 missing presses. V2 uses its tempo grid and a wider onset neighborhood. Of its 166 head timestamps, 69 are within 35 ms of a new V3 head. Of the 97 unmatched timestamps, 25 have no V3 attack within 35 ms and 57 have only sub-0.10 confidence attacks. Fifteen have a stronger nearby attack and nine of those leave a preliminary 53 ms gap to existing V3 heads. That gap test does not establish rhythmic or finger suitability. Detector disagreement alone does not adjudicate either engine's timing.

The old chord pass frequently misses locally audible attacks that fail its contrast and cadence gates. In the same Expert excerpt, 28 heads passed the exploratory two-band rise screen. Only 11 where a chord was absent survived preliminary spacing. We kept the chord test conservative because two band rises can also come from a single broadband sound. The narrower lane-only handstream experiment found just three overlapping eligible Expert windows across Galaxy and none in the stress excerpt or Unity. For Easy and Normal, swapping the greedy selector for weighted scheduling changed 76 and 83 full-song Galaxy heads and improved the stress excerpt by one Easy head and zero Normal heads. That exploratory change is excluded.

## Integrated revision

The default V3 revision `context-1` uses the `difficulty-1` layout as its base. Easy and Normal can complete a measured even figure between two charted attacks. Normal, Hard and Expert can accent a single head with another key when two relative band rises corroborate it. Expert can choose a same-hand bracket when its approach and exit are clear. Hard and Expert can recover a weak measured attack when nearby attacks corroborate the interval and band pattern or when a separately measured pitched arrival supports it. Candidate presses check both adjacent finger presses, active holds, release clearance, silence and local peak load. Beat Focus and Relax keep their previous notes. No density or optimizer defaults changed. The tonal-arrival auxiliary test uses a frequency neighborhood to reduce false positives from moving partials. [Böck and Widmer, DAFx 2013](https://www.cp.jku.at/research/papers/Boeck_Widmer_DAFx_2013.pdf)

Production changes are in `v3/arrangement.js`, `v3/engine.js`, `v3/timing.js`, `v3/sustain.js`, `v3/quality.js` and `v3/worker.js`. Packaging adds the arrangement module to `scripts/build-artifact.py` and rebuilds the standalone HTML. Tests and tooling changed in `tests/v3-arrangement.test.js`, `tests/v3-composer.test.js`, `tests/v3-sustain.test.js`, `scripts/benchmark-v3-difficulty.mjs`, `scripts/benchmark-v3-sustain-runtime.mjs`, `scripts/browser-v3.py` and `scripts/build-v3-difficulty-playtest.mjs`. The research prototypes and V1/V2 generator sources retain their prior versions.

## Results

Each cell is V2 / V3 `difficulty-1` / V3 `context-1` notes per second, using full recordings and the same Balanced, Density 1.00× settings. The last two recordings were held out from this revision's decisions. Their file hashes, measured tempos, attack rates and individual chart metrics are in the reports.

| Recording | Easy | Normal | Hard | Expert |
| --- | ---: | ---: | ---: | ---: |
| Galaxy Collapse | 2.41 / 1.74 / 1.78 | 4.73 / 3.37 / 3.50 | 8.05 / 5.44 / 5.64 | 9.38 / 6.94 / 7.20 |
| Unity | 2.41 / 2.64 / 2.71 | 3.21 / 3.56 / 3.57 | 6.39 / 5.12 / 5.17 | 7.18 / 6.21 / 6.29 |
| Mutilator Ultra Slowed | 2.18 / 2.08 / 2.09 | 4.33 / 3.72 / 3.75 | 4.66 / 6.07 / 6.12 | 4.96 / 7.86 / 7.92 |
| Pistachio | 2.36 / 2.04 / 2.12 | 3.81 / 3.24 / 3.39 | 5.93 / 4.06 / 4.08 | 6.39 / 4.69 / 4.73 |
| Let's Go Fishin' | 2.44 / 2.23 / 2.27 | 4.86 / 3.48 / 3.49 | 6.23 / 4.82 / 4.87 | 10.74 / 5.81 / 5.86 |
| Vibe Ace | 2.23 / 1.90 / 1.92 | 4.18 / 2.98 / 2.99 | 8.12 / 3.74 / 3.76 | 9.19 / 4.59 / 4.64 |
| Nutcracker | 2.77 / 1.59 / 1.63 | 3.10 / 2.16 / 2.17 | 5.70 / 2.32 / 2.37 | 5.97 / 2.96 / 3.04 |
| Brahms | 2.31 / 1.59 / 1.61 | 4.51 / 2.40 / 2.44 | 5.19 / 3.14 / 3.25 | 5.45 / 3.88 / 3.97 |
| No No No | 2.09 / 1.86 / 1.88 | 3.99 / 3.32 / 3.37 | 4.95 / 4.91 / 5.02 | 5.18 / 6.02 / 6.19 |
| Funk Abnormal Slowed | 1.90 / 1.75 / 1.79 | 3.54 / 3.28 / 3.35 | 7.08 / 4.65 / 4.72 | 7.58 / 5.78 / 5.92 |
| Mean of the first eight | 2.39 / 1.98 / 2.02 | 4.09 / 3.11 / 3.16 | 6.28 / 4.34 / 4.41 | 7.41 / 5.37 / 5.46 |

Across the first eight recordings, the revision completed 104 Easy/Normal figure heads, added 206 chord keys including 36 Expert brackets, and recovered 107 Hard/Expert weak attacks, 51 with pitched-arrival evidence. In the Galaxy excerpt, Hard goes from 100 to 106 notes with 94 heads in both versions. Expert goes from 121 to 128 notes and from 113 to 114 heads. The 279 nearby detector events include uncharted sounds. V2 has 223 Hard and 260 Expert notes in the same cut. On the full Galaxy Expert chart, presses repeated on one finger within 160 ms rise from 17 to 19 and same-hand transitions within 110 ms rise from 48 to 69. Repeats within 100 ms stay at zero, the one-second peak stays at 14 keys, and the 87 holds stay identical. Mutilator Expert stays at 8 repeats within 160 ms, 37 rapid same-hand transitions, a peak of 14 and 36 unchanged holds. The two held-out Expert charts each gain two rapid same-hand transitions. No No No also gains one repeat within 160 ms.

The 40 default-density V3 pairs replay deterministically, preserve all earlier note objects including 1,569 holds, and preserve the tempo maps. The new 22,225 heads all use rounded detector timestamps. There were zero chart warnings, lane collisions, detected quiet-region heads and same-lane presses less than 45 ms after a hold release. The 0.55× and 1.45× boundary checks and every mode on Galaxy, Unity and Nutcracker also passed. Independent fixture onset errors remain within 1.5 ms for steady, fractional, slow, changing and long click tracks. Real audio has no complete independent set of attack, instrument and release annotations in this comparison. [Primary results](results.json) · [Held-out results](holdout.json)

## Runtime and workflow

Separate local runs with 22.05 kHz PCM excluded decoding. Galaxy analysis took 2,540 → 2,586 ms and median four-chart generation took 188 → 203 ms. Peak process RSS changed 149.6 → 152.7 MiB. Nutcracker analysis took 742 → 759 ms and generation 39 → 48 ms, with RSS 89.1 → 86.2 MiB. Each composition median is three repetitions after one warm-up; analysis and RSS are single process observations. Candidate counts were identical on both inputs. [Runtime samples](runtime.json)

The full 190-test suite, syntax check, static build and standalone bundle passed. Chrome verified V2 default and V3 automatic generation, cancelling a live Worker, cache reuse, editor entry, older Effort metadata round trips and playback on the static site and local standalone. All eight comparison charts were imported, exported and previewed with their matching WAV. In Pixel 7 emulation, Unity Hard Take 2 played and a separate run exercised the `compact` Worker budget and its cache. Real Android/iOS hardware and Firefox/Safari remain unverified.

## Reproduction and release blocker

On this workstation, `/tmp/rf-v3-final-baseline-dir` points to the pre-change V3 modules and original cached full charts. `/tmp/rf-rc-audio-dir` points to the five reference Oggs. The recordings and WAV checksums are recorded in `benchmarks/v3-player-acceptance/exports/results.json`. With the same audio, the production engine can replay the original composition revisions if the temporary cache is unavailable.

```sh
refs="$(cat /tmp/rf-rc-audio-dir)"
cache="$(mktemp -d)"
node scripts/benchmark-v3-difficulty.mjs baseline "$refs" "$cache" "$cache/baseline.json"
node scripts/benchmark-v3-difficulty.mjs candidate "$refs" "$cache" "$cache/difficulty-1.json"
node scripts/benchmark-v3-difficulty.mjs context "$refs" "$cache" "$cache/context-1.json"
node scripts/benchmark-v3-difficulty.mjs holdout "$refs" "$cache" "$cache/holdout.json"
node scripts/build-v3-difficulty-playtest.mjs "$cache" "$cache/charts" context
npm test
npm run typecheck
npm run build
python3 scripts/build-artifact.py Rhythm-Forge-Standalone-v14.5.html
```

The largest gap still falls where dense layers and weak subdivisions are hard to attribute in a mixed recording. The current onset, interval and band cues cannot establish which missing figures deserve a new head or chord across those regions. Compare annotated examples of percussion, pitch changes and phrase accents before relaxing those gates. Include the Galaxy stress cut plus Vibe Ace and Nutcracker, where the density deficit is also large. Musical correspondence, appropriate challenge and preference are still open. The saved comparison package is available once the technical blocker has been addressed. [Blinded charts](README.md)

| Pair | Take 1 | Take 2 |
| --- | --- | --- |
| Galaxy Easy | V2 | V3 |
| Nutcracker Normal | V3 | V2 |
| Unity Hard | V2 | V3 |
| Galaxy Expert | V3 | V2 |
