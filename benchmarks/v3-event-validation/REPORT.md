# RF Generator V3 qualification

**NOT RELEASE READY.** The local `spectral-1` build improves attack recovery on dense electronic music. The held-out human onset and piano chord results still fall short of the requested accuracy. V2 remains the default. [Play six matched V2/V3 pairs](README.md).

## What changed

The V3 detector measures short-time log-frequency changes alongside the earlier broadband, sustain and pitch evidence. Local repetitions can corroborate a measured weak attack, including a timbre change inside a recurring figure. A raw-energy check rejects periodic vibrato that looks like an onset after logarithmic compression. The analysis uses a packed real FFT and a bounded spectrum cache. Stereo input with near-total downmix cancellation can fall back to an audible channel.

Composition follows recurring acoustic signatures into trills, anchors and controlled jacks. Separate onset and decay shapes, locally recurring timbres, and newly arriving harmonic series provide chord evidence. The former hold allocator removed every extra key at a hold start. The new allocator keeps a supported second gesture when it fits on a separate finger. A physical rating considers sustained workload, changes in inter-head interval, finger recovery and hold coordination. Optional tracing replays the winning layout and records the decisions without affecting generation.

## Galaxy Collapse, 3:20–3:40 Expert

| Engine | Heads | Extra chord keys | Matches to 149 external onset cues within 25 ms |
|---|---:|---:|---:|
| V1 | 159 | 38 | 28 |
| V2 | 166 | 94 | 57 |
| V3 phrase-1 | 130 | 21 | 51 |
| V3 spectral-1 | 167 | 18 | 129 |

The 109-press V2 versus phrase-1 difference comprised 36 net heads and 73 extra chord keys. The engines shared only 57 head times within 25 ms. Of the 109 unpaired V2 heads, 50 fell near a phrase-1 candidate rejected for confidence, 45 had no candidate in tolerance, six lost to minimum spacing, four lacked a supported phrase transition, three lacked spectral confirmation and one lost to a competing phrase.

The new chart covers 82 external cues that V2 missed. V2 alone covers ten and both miss ten. Among the 20 current misses, 11 fell near attacks rejected for insufficient envelope corroboration. Four produced raw peaks only. Two failed confidence, one had no candidate, one lacked spectral confirmation and one lost during phrase selection. Hard changed from 108 heads + 8 chord keys to 151 + 11. Expert still lacks independent confirmation of most chord decisions. Only two of its 18 chords agree within 25 ms with the eleven polyphonic onset groups estimated by Basic Pitch. That model is designed primarily for individual instruments. [Per-event ledger and source hashes](lineage.json) · [Pitch estimates](polyphony.json)

## Independent accuracy

The chart-blind reference uses two external madmom onset networks, with agreement within 20 ms, plus separate DSP estimates from phase novelty and band envelopes. The source recordings have no human foreground labels. The report keeps single-method cues and uncertain events separate. Each score maximizes one-to-one matches, then minimizes summed timing error. The stored results include median, P90, maximum and signed median error for matched pairs. [madmom](https://madmom.readthedocs.io/en/v0.16.1/modules/features/onsets.html) · [Complex-domain onset method](https://www.dafx.de/paper-archive/2003/pdfs/dafx81.pdf) · [Basic Pitch](https://github.com/spotify/basic-pitch) · [DSP estimates](reference.json) · [Network estimates](networks.json)

On eight Onset_Leveau development recordings, Expert recovered 221 individually annotated attacks from 305 heads, compared with 179 from 273. On the four held-out recordings it recovered 110 of 189 from 183 heads, versus 90 from 168. Against the three-annotator consensus it recovered 111 of 166 on holdout, with precision 60.7%, recall 66.9% and F1 63.6%. Consensus labels omit difficult-to-time onsets. Unmatched chart heads therefore include uncertain cases. The requested 90% precision and recall gate remains open. Bowed strings and quiet orchestral entrances remain difficult. [Label methodology](https://adasp.telecom-paris.fr/resources/2011-07-13-onset-leveau/) · [Development](annotated-development.json) · [Holdout](annotated-holdout.json)

Five MAESTRO v3.0.0 real piano performances supply independently recorded key-down and key-up times. Notes within 25 ms of the first note form a reference chord. On the original held-out test piece, matched heads rose from 299 to 350 of 474. Correctly timed chords stayed at 67 of 280 while proposed chords fell from 89 to 82. On the two additional frozen performances, matched chord counts rose from 18 to 26 and 46 to 52. One of these pieces lost four matched heads. The raw key-up errors are mechanical release comparisons and can differ from the audible decay under pedal. [Hawthorne et al., MAESTRO](https://magenta.tensorflow.org/datasets/maestro) · [All five performances](piano.json)

## Difficulty and regressions

Mean notes per second across ten recordings, Balanced mode and Density 1.00×:

| Difficulty | V2 | phrase-1 | spectral-1 |
|---|---:|---:|---:|
| Easy | 2.31 | 2.36 | 2.41 |
| Normal | 4.03 | 3.61 | 3.67 |
| Hard | 6.23 | 5.29 | 5.90 |
| Expert | 7.20 | 6.37 | 6.88 |

Mutilator Expert rose to 10.96 NPS, versus 8.77 previously and 4.97 for V2. Galaxy Normal became sparser in the stress cut. Fishin’, Brahms and No No No lost whole-song Expert density. Expert hold counts declined on several tracks, including Galaxy and Mutilator. Vibe Ace and Nutcracker gained Expert coverage. The primary and held-out reports preserve per-song interval distributions, peak rates, pattern families, chord sizes, holds and hand workloads; the upper-density sweeps check preservation of previously accepted notes. [Eight tracks](primary.json) · [Two held-out tracks](holdout.json) · [300 control settings](controls.json)

## Qualification and limits

202 automated tests passed. The forty default-density charts were generated twice, validated and checked against legacy timing. Source parity checks covered the V1 and V2 generation modules. Static build, standalone packaging, embedded Worker tests and syntax checks passed. Chrome and Firefox exercised both builds. Chrome also exercised cache reuse, cancellation, project reload, import/export and compact emulation. Native macOS Safari 26.5 verified the V2 default, Worker cancellation, four-chart generation, cache reuse and editor entry on the served build and on a temporary copy of the standalone with the smoke script appended and fresh local preferences. All twelve matched comparison files were imported into the editor, re-exported with exact JSON parity and started in gameplay with the expected audio duration on standalone Chrome. Two runs used Pixel 7 emulation. Physical iOS and Android, Safari gameplay and player preference remain unverified.

Paired desktop Node median analysis times in this run were 7.98 → 7.59 seconds on Galaxy, 2.63 → 1.92 on Unity and 8.21 → 7.13 on the 12-minute fixture. Isolated Galaxy process peak RSS increased from 143.1 to 200.6 MiB. These measurements exclude decoding and depend on host load. Reusing the FFT output buffers subsequently reduced peak RSS in two more isolated Galaxy runs to 179.2 and 180.6 MiB, versus 188.3 and 213.5 MiB for the same spectral analyzer before reuse. Complete analysis objects compared equal for all ten recordings. Compact-device memory remains an engineering risk. [Isolated memory samples](memory.json) [Paired performance](runtime.json)

The global-gain experiment recovered more quiet attacks and generated many unmatched heads. A continuous dominant-pitch plateau experiment added four heads without recovering another annotated attack on the development piano piece. Both were excluded. Short-frame recurrence without the raw-energy guard produced a false stream on steady vibrato. A regression fixture exercises that failure.

A separate offline experiment compared the normalized spectra before and after a soft transition, discounting changes already present on either side. Accepting peaks more than 50 ms from an existing head matched six additional development cello onsets but only one of nineteen additional techno heads. Requiring 150 ms of separation reduced the development result to six matches among nine additional heads. On held-out audio this variation found five violin matches among six additional heads, zero among six additional ensemble heads and no additional guitar or piano heads. It was excluded from production. A normalized autocorrelation pitch-change condition also failed on the development recordings (two matches among five additional heads). Future detectors should distinguish a new bowed articulation from a changing mixture before admitting these candidates. Local reproduction scripts, the ten-recording equality check and playback logs are preserved in `baseline/spectral-diagnostics/`.

## Reproduction and continuation

The original modified working trees are preserved in the ignored archives `baseline/phrase-1-worktree.tar.gz` (SHA-256 `cf541760c5fc74b3c258d20ebe8afecfb6e759430e015af8f34bbcc755f6835f`) and `baseline/context-1-worktree.tar.gz` on top of Git revision `55c49495cddd2dd36b4d48e83439df4fbef552d2`. New source is in `v3/attack-spectrum.js`, `sustain.js`, `timing.js`, `timeline.js`, `composer.js`, `engine.js`, `quality.js`, `client.js` and the standalone packager. The stored takes select the complete recordings before slicing. Use the historical cache instructions in the [phrase-1 report](../v3-phrase-validation/REPORT.md) when starting on a fresh machine.

```sh
refs="$(cat /tmp/rf-rc-audio-dir)"
cache=/tmp/rf-event-cache
out=benchmarks/v3-event-validation
node scripts/benchmark-v3-difficulty.mjs spectral "$refs" "$cache" /tmp/current-primary.json
node scripts/benchmark-v3-difficulty.mjs spectral-holdout "$refs" "$cache" /tmp/current-holdout.json
node scripts/benchmark-v3-difficulty.mjs spectral "$refs" "$cache" /tmp/current-controls.json galaxy unity nutcracker --controls
python3 scripts/reference-v3-attacks.py "$refs" "$out/reference.json"
python3 scripts/reference-v3-networks.py "$out/reference.json" "$refs" /tmp/rf-leveau-reference "$out/networks.json"
python3 scripts/reference-v3-polyphony.py "$refs" "$out/polyphony.json"
node scripts/build-v3-difficulty-playtest.mjs "$cache" /tmp/rf-new-comparison spectral
node scripts/trace-v3-attacks.mjs "$refs" /tmp/current-lineage.json
node scripts/benchmark-v3-annotated.mjs /tmp/rf-leveau-reference holdout
python3 scripts/fetch-v3-piano-reference.py /tmp/rf-maestro-references
node scripts/benchmark-v3-piano.mjs /tmp/rf-maestro-references train validation test unseen-validation unseen-test
node scripts/benchmark-v3-sustain-runtime.mjs /tmp/rf-preserved-phrase spectral
npm test
npm run typecheck
npm run build
python3 scripts/build-artifact.py Rhythm-Forge-Standalone-v14.5.html
python3 scripts/browser-v3-safari.py
```

For the post-optimization checks, the exact pre-change V3 module tree is in `baseline/spectral-before-buffer-reuse/`. From the repository root, `node baseline/spectral-diagnostics/rf-ring-parity.mjs` compares complete analysis outputs. Use `node scripts/benchmark-v3-sustain-runtime.mjs baseline/spectral-before-buffer-reuse spectral current` and repeat with `baseline` as the last argument for isolated runs.

The offline reference tools use FFmpeg, NumPy, mido, madmom (source 27f032e, models 7e3dc1b), or Basic Pitch 0.4.0 with ONNX Runtime 1.18.1 as appropriate. No model runs in the game. The next engineering priority is accurate soft and repeated pitch attacks on bowed material, followed by checking dense chord and release attribution against aligned performances and measuring memory on compact hardware. Player acceptance and publication are pending.
