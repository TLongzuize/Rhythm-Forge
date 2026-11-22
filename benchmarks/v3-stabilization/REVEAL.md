# Reveal key

| Recording | Take 1 | Take 2 | Take 3 |
| --- | --- | --- | --- |
| Galaxy Collapse | Revised V3 | V2 | Previous V3 |
| Unity | Previous V3 | Revised V3 | V2 |
| Dance of the Sugar Plum Fairy | Revised V3 | Previous V3 | V2 |

The engineering gate tests 32 full charts on eight recordings across all four difficulties. Vibe Ace and Hungarian Dance No. 5 were excluded from tuning this change. The full results include the previous Galaxy Collapse 3:20–3:40 excerpt, where the new sustain analysis found no additional hold. The intro was selected for the playable hold comparison because its hold schedule changed. [Results and recording fingerprints](exports/results.json)

## What changed

The previous hold filter treated increased energy across an entire coarse band as evidence for one attributable sound. In the Galaxy Collapse diagnostic, 412 of 454 selected Expert heads with enough legacy band duration fell below the required contrast to the prior material. In Unity, 31 of 52 selected heads carrying broad-band release evidence met a lane or chord conflict in the previous layout. These categories describe the detector and layout. They do not label individual instruments or determine whether every excluded hold was appropriate.

The new analysis follows a prominent spectral peak that becomes audible at a measured attack. It asks for contrast with the preceding mix, checks persistence after the attack, and observes decay before emitting a release. A rebound or a train of separate plucks cannot automatically extend a hold. Presses are still laid out first. If the original finger has a later press before release, the hold can use the other finger on the same hand only with enough clearance. Upper Density also avoids reusing note IDs when a sustained gesture replaces a chord key.

New charts record `articulation-2`. The prior `articulation-1` and E.1 `event-1` composition routes remain available to direct V3 callers. Timing, automatic effort, and V1/V2 generator code are unchanged. V2 excerpts use the same mono PCM source, mode, difficulty, Density, and seed as the V3 excerpts. V2's own analyzer and beat grid remain visible in its chart behavior.

## How to reproduce

Run from the repository root with Node and FFmpeg.

```sh
node scripts/benchmark-v3-articulation.mjs REFERENCE_DIR HOLDOUT_DIR NEW_OUTPUT_DIR release
```

The reference directory contains `pistachio.ogg`, `fishin.ogg` and `brahms.ogg` from the earlier [recording manifest](../../research/pattern-grammar/benchmark.json). The holdout directory contains `vibeace.ogg` and `nutcracker.ogg` from the earlier [audio pool](../../research/pattern-grammar/gate/pool.json). The runner checks previous V3 control metrics against the archived measurements and reuses archived V2 excerpts where the recording, settings, and window match.
