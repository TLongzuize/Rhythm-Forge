# Reveal key

| Recording | Take 1 | Take 2 | Take 3 |
| --- | --- | --- | --- |
| Galaxy Collapse | Current V3 | V2 | Previous V3 |
| Unity | Previous V3 | Current V3 | V2 |
| Dance of the Sugar Plum Fairy | V2 | Previous V3 | Current V3 |

All three takes used the same PCM source, seed 25094, mode, and Density setting. V2 retains its distinct analysis, beat-grid placement, and composition, so these controls do not imply identical note counts. The offline comparison decodes mono at 22.05 kHz for all engines. Fresh browser V2 generation can vary with the device audio sampling rate.

The [per-track results](exports/results.json) include whole-chart results for all four difficulties, exact head changes, lane and hold safety, composition time and the actual excerpt counts. The two held-out recordings are Vibe Ace and Dance of the Sugar Plum Fairy. They were used in earlier project research and were excluded from selecting the articulation policy. The reruns corrected a recovery problem exposed by Unity and Mutilator and explored relative chord accents on Galaxy Collapse.

A fast finger is a repeated key with a positive gap below 1.5 times the profile's recovery floor. A fast hand is a positive time gap below that floor between uses of either key on a hand. Same-band reattacks within 22 ms of hold ends describe the mix as measured by V3 and cannot identify which instrument ended. Exact head agreement checks preservation of the detector's timestamps. The benchmark has no independent transcription of these recordings.

To reproduce from the repository root, use `node scripts/benchmark-v3-articulation.mjs REFERENCE_DIR HOLDOUT_DIR NEW_OUTPUT_DIR` with Node and FFmpeg. The reference directory contains the prior `pistachio.ogg` and `fishin.ogg`. The held-out directory contains `vibeace.ogg` and `nutcracker.ogg` from the earlier [audio pool](../../research/pattern-grammar/gate/pool.json).

The production implementation uses a bounded path search for measured Hard and Expert attacks, followed by lane assignment and sustain articulation. Phase and attack timestamps come from the existing timeline. Local interval evidence can make nearby heads compatible across an ordinary phrase boundary. The lane scorer considers the last press on both keys of a hand, and the chord rule can recognize a broadband peak relative to its neighbors. Holds compete by attack-relative sustain evidence and must leave room for scheduled presses. Rhythm-game generation research also identifies separate timing and step-choice problems and the importance of relationships between adjacent objects. [Dance Dance Convolution](https://arxiv.org/abs/1703.06891) · [TaikoNation](https://arxiv.org/abs/2107.12506)

The strongest negative findings were the loss of some strong attacks in Unity Hard and the much lower hold counts, including on the orchestral recording. The benchmark cannot tell whether fewer holds sound more natural, whether the remaining chords express the right layer, or whether the new lane choices are more enjoyable than V2. The earlier revision remains available through the direct generator option `compositionRevision: 'event-1'`. New charts record `articulation-1` alongside the existing `automatic-1` search policy.
