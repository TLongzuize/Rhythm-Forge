# RF Generator V3 · Density responsiveness (E.1)

**Verdict · Conditional GO for the opt-in upper Hard/Expert range.** The control gives a measurable increase on every tested technical chart while preserving the whole 1.00× layout. Galaxy's increase remains modest and Hard sees more rapid shared-hand transitions. The evidence supports retaining the focused control change, with no case for increasing default density or broadening the accent rule.

## Diagnosis before implementation

The harness instrumented the E.0 composer in memory. It identified the winning layout candidate and reproduced that candidate exactly with tracing. Each detected attack is counted once at its first rejection stage or as a final head. Spacing denotes incompatibility with a selected neighbor, including the asymmetric minimum-gap rule in the technical selector. Transition means the previous phrase's last accepted head was too close. Objective denotes a remaining eligible head omitted by the optimizer. Chord reasons are counted separately on final heads. The scopes are a whole song and a fixed excerpt, with identical sources and seed offsets across Density settings.

For Galaxy's 5,154 detected attacks, these were the full-song winning-candidate traces. No event in these Hard/Expert runs was excluded solely by the objective or by lane occupancy.

| Difficulty | Density | Confidence | Rank | Spacing | Transition | Final heads | Extra chord notes | Chord accent rejection |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Hard | 0.55× | 1944 | 1024 | 833 | 35 | 1318 | 47 | 1247 |
| Hard | 0.75× | 1944 | 1024 | 617 | 18 | 1551 | 38 | 1473 |
| Hard | 1.00× | 1944 | 1025 | 486 | 8 | 1691 | 35 | 1611 |
| Hard | 1.20× | 1944 | 1025 | 466 | 6 | 1713 | 35 | 1631 |
| Hard | 1.45× | 1944 | 1025 | 460 | 6 | 1719 | 35 | 1637 |
| Expert | 0.55× | 1944 | 419 | 850 | 19 | 1922 | 66 | 1830 |
| Expert | 0.75× | 1944 | 419 | 609 | 7 | 2175 | 67 | 2079 |
| Expert | 1.00× | 1944 | 419 | 338 | 5 | 2448 | 60 | 2352 |
| Expert | 1.20× | 1944 | 419 | 320 | 5 | 2466 | 59 | 2370 |
| Expert | 1.45× | 1944 | 419 | 304 | 5 | 2482 | 56 | 2386 |

Moving the slider only changed base spacing. A supported Hard attack was already at the 76 ms floor in the standard balanced case, and Expert used a 50 ms floor. Confidence and effective rank gates barely moved. More selected heads also meant less lookahead room for existing jumps. Only 28 additional Hard heads and 34 Expert heads reached the chart at the old maximum, before the loss of four Expert chord notes. Shrinking spacing further would put pressure on playability and would leave the eligibility bottleneck.

## Implementation

For automatic Hard and Expert above 1.00×, the existing optimization runs on the exact 1.00× core. An evidence-ordered pass then offers optional detail. It keeps core note IDs, lanes, taps, chords and holds. The slider changes the minimum evidence for optional detail. The order of accepted placements at lower settings is a prefix of the same evidence order at higher settings. Added taps use measured attacks and require a corroborating local rhythmic figure, a bounded subdivision, or established interval recurrence. The optional confidence floor is at least 0.14 and never below the caller's configured floor.

A prominent broadband core tap may gain one opposite-hand key where there is an audible neighboring head, chord cooldown and clearance on either side. Additional width is limited to two. This is a mapping emphasis cue, with no claim of independent instrument separation. Relax disables optional jumps. Both additions respect the existing difficulty floor for same-finger reuse, lane reservations, 45 ms after release and the existing 18-notes-per-second warning threshold. Existing charts keep their metadata. New upper Hard/Expert results record `densityRevision: "optional-detail-1"` under the same `automatic-1` optimization budget.

Easy, Normal, the lower half of the slider, and explicit historical Effort replay keep their original selection path. Existing lower-density event substitution and occasional core-accent loss in Easy/Normal are thus still possible. The main UI, range, timing detector, tempo map, Worker protocol, Density default, and V1/V2 generation are outside this code change.

Production files changed are `v3/composer.js`, `v3/engine.js`, and the regenerated `Rhythm-Forge-Standalone-v14.5.html`. New verification files are `tests/v3-density.test.js`, `scripts/benchmark-v3-density.mjs`, and the four files in this report directory.

## Measured response

Whole-recording note totals for Balanced Hard and Expert. Columns list results at 0.55×, 0.75×, 1.00×, 1.20× and 1.45× in order. The underlying four-difficulty sweeps are in the raw reports. Development sources were Galaxy, Unity, and slowed Mutilator. The prior verified piano, vocal folk/pop, and variable-tempo orchestral samples were replayed as a held-out set for this milestone. Production code and the harness were hashed before the held-out outcome run.

| Track | Difficulty | E.1 sweep | E.0 at 1.45× | New heads + extra chord notes vs. 1.00× |
|---|---|---:|---:|---:|
| Galaxy Collapse | Hard | 1365 / 1589 / 1726 / 1748 / 1800 | 1754 | +44 heads, +30 chord notes |
| Galaxy Collapse | Expert | 1988 / 2242 / 2508 / 2544 / 2584 | 2538 | +31 heads, +45 chord notes |
| Unity | Hard | 909 / 1030 / 1161 / 1221 / 1272 | 1196 | +61 heads, +50 chord notes |
| Unity | Expert | 1326 / 1428 / 1462 / 1511 / 1526 | 1477 | +8 heads, +56 chord notes |
| Mutilator Ultra Slowed | Hard | 618 / 690 / 767 / 777 / 795 | 778 | +17 heads, +11 chord notes |
| Mutilator Ultra Slowed | Expert | 866 / 992 / 1054 / 1080 / 1094 | 1069 | +22 heads, +18 chord notes |
| Pistachio | Hard | 272 / 282 / 286 / 299 / 302 | 286 | +3 heads, +13 chord notes |
| Pistachio | Expert | 318 / 323 / 325 / 359 / 359 | 329 | +0 heads, +34 chord notes |
| Let's Go Fishin' | Hard | 477 / 512 / 525 / 539 / 549 | 528 | +8 heads, +16 chord notes |
| Let's Go Fishin' | Expert | 643 / 675 / 712 / 728 / 739 | 732 | +8 heads, +19 chord notes |
| Brahms Hungarian Dance No. 5 | Hard | 82 / 86 / 87 / 91 / 97 | 88 | +2 heads, +8 chord notes |
| Brahms Hungarian Dance No. 5 | Expert | 135 / 140 / 151 / 157 / 161 | 154 | +1 head, +9 chord notes |

Galaxy rises by 4.29% Hard and 3.03% Expert at 1.45× relative to 1.00×. Its NPS moves from 4.24 to 4.42 for Hard and 6.16 to 6.35 for Expert. This is a modest response. The protected 1× core, frequent close spacing, confidence gating and lack of corroborating evidence for some surplus attacks constrain how much can be added safely. The results establish neither a detector shortage nor a musical preference. Expert piano plateaus from 1.20× upward and adds only chords. These observed plateaus make an independent check of the broadband accent proxy worthwhile. The sparse/sustained fixture does not grow a single isolated sustained event, and Brahms Easy stays at nine notes. Some acoustic accents still get more simultaneous keys on technical tiers.

All upper technical cases preserve every core note and all strong core accents. No unsupported heads, quiet-head violations, validator warnings, lane collisions, or hold/release conflicts were recorded in the 120 updated cases. Galaxy Hard's short regular windows rise 55 → 73 and supported subdivision gaps 679 → 716. Its selected low-confidence heads increase 378 → 392 and rapid same-hand transitions increase 0 → 17, as measured by the profile's faster-than-lane-gap proxy. Minimum same-finger gap drops 174 → 155 ms, the existing Hard floor. Peak one-second density remains 10. Galaxy Expert's minimum same-finger gap and peak density stay at 109 ms and 14. Piano Expert's one-second peak increases 8 → 9 and Brahms Hard 5 → 7. These are technical tradeoffs despite legal spacing. Musical fit and perceived difficulty remain unverified.

## Compatibility, costs and reproduction

All 24 default-density chart note hashes and tempo hashes match E.0. All 96 off-scope comparisons (Density ≤1.00× or Easy/Normal) match their existing note hashes. The benchmark checks deterministic reruns and nested placement for upper technical settings. The candidate counts still match the 1× search. The extra pass uses sorted attack and lane arrays with storage linear in note and event counts. Measured generation-only maxima for the upper technical runs in this small sweep were 18.5 → 21.5 ms on development and 4.1 → 5.6 ms held-out. These are single samples, not production latency guarantees. Peak process RSS includes FFmpeg output, Node, analysis and trace data where applicable, so it does not isolate the optional pass. Mobile and browser performance were not separately measured.

30 focused tests, syntax checks, static build and standalone bundle checks passed. The V1/V2 generator sources match the baseline release. No new browser automation was run.

The report bundles the pre-edit trace and post-edit measurements. Use Node and FFmpeg. Reference paths are described in the [prior benchmark manifest](../../research/pattern-grammar/benchmark.json) and the [pattern grammar report](../../research/pattern-grammar/README.md). To rerun the final comparison, extract the recorded baseline and pass the local outside-repository reference-audio directory. The trace mode expects the original E.0 composer.

```sh
node -p "JSON.stringify(require('./benchmarks/density-e1/development.json').before)" >/tmp/rf-density-before.json
node scripts/benchmark-v3-density.mjs after development /path/to/reference-audio /tmp/rf-density-before.json
node --test tests/v3-*.test.js tests/standalone-bundle.test.js
```

**E.2 scope.** Evaluate which optional technical accents belong in the chart, with a small independently annotated matched-core comparison of Galaxy Hard and acoustic Expert. Examine the extra same-hand transitions and acoustic chord plateaus before broadening the density path. Keep this separate from timing or grammar work.
