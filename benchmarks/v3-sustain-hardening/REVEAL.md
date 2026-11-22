# Reveal key

| Recording | Take 1 | Take 2 | Take 3 |
| --- | --- | --- | --- |
| Unity | Previous V3 | Revised V3 | V2 |
| Galaxy Collapse | Revised V3 | V2 | Previous V3 |
| Dance of the Sugar Plum Fairy | Revised V3 | Previous V3 | V2 |

## Root causes

The original fixed-bin detector required three consecutive below-floor frames before reporting a release. It discarded a partial still present at its 1.8 s observation limit. The composer also rejected some observed releases independently, including a clean 1.7 s fixture under the previous Expert duration cap. With a 2.1 s fixture starting at 200 ms, the previous detector estimated releases at 890 and 690 ms for 40 and 90 Hz glides. The observed audio release was at 2,300 ms.

The added tracker operates on clear dominant partials in relatively open entrances. It follows a bounded peak trajectory, checks for a confirmed reattack or competing replacement, and requires repeated absence before estimating a release. Near the audio or analysis boundary it can return an active state with its last observation and no tail. Strong sweeps or potential replacements can return ambiguous evidence. Existing fixed-bin evidence remains the fallback for mixed passages where the new path cannot establish a clear starting partial.

The composer uses corroborated releases and keeps the original layout search. Unity Expert initially changed more than 1,000 press positions because a few hold changes altered the winning layout. The revised placement step applies the new articulation only to the winning control variation. The final version changes one Unity Expert press lane, at a newly scheduled hold. At 28.405 s Unity's previous V3 hold ended at 28.750 s and the revised estimate ends at 29.110 s.

## Release evidence

See the [eight-recording report](exports/results.json) for every difficulty and the [paired runtime trials](performance.json) for the previous and revised analyzers. The report records head, note, chord and hold counts, median and 90th-percentile hold duration, changed lanes, timing and early or late disagreement with the qualified tracked estimate. Among holds with a qualified tracked estimate, the previous charts had four early and nine late disagreements beyond 35 ms. The revised charts recorded zero in those categories. These comparisons use a detector estimate as a reference. An independent instrument annotation is unavailable for these mixes.

Desktop analysis of the 12-minute splice took 3.16–3.77 s on the baseline and 3.34–3.37 s on the revision. A sequential Unity browser trial took 4.2 s and 4.4 s respectively with Pixel 7 layout emulation, the compact policy, and 4× CPU throttling. The mobile trial used desktop Chromium.

The two held-out recordings in this round are Vibe Ace and Hungarian Dance No. 5. The tracker recovered clean synthetic notes through 3.2 s. In this real-audio corpus most charts changed very little and no revised Expert hold exceeded 1.8 s. Galaxy Collapse at 3:20–3:40 and the larger musical preference gap remain part of player acceptance.

Run the same real-audio comparison from the repository root with Node and FFmpeg.

```sh
node scripts/benchmark-v3-articulation.mjs REFERENCE_AUDIO_DIR HOLDOUT_AUDIO_DIR NEW_OUTPUT_DIR hardening
node scripts/benchmark-v3-sustain-runtime.mjs PATH_TO_ARTICULATION_2_SOURCE_SNAPSHOT
```

Use the same recordings listed in the [previous test documentation](../v3-stabilization/REVEAL.md). The runtime runner alternates baseline and revised order and checks that attack timestamps, previously generated evidence, and tempo maps agree. It reuses 60 seconds of Galaxy Collapse PCM to form a repeatable 12-minute workload.
