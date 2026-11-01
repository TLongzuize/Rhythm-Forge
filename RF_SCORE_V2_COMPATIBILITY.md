# Rhythm Forge ScoreV2 compatibility notes

## Implementation

`score-v2.js` implements a 4K adaptation of the osu!lazer mania ScoreV2 model. The standardised total is capped at 1,000,000 and split into 150,000 combo points and 850,000 accuracy points. Combo progress uses the ordered judgement sequence and a logarithmic combo weighting with base 4 and a capped reference combo of 400. Accuracy contribution uses the normalized weighted accuracy and the `2 + 2 × accuracy` exponent curve.

Rhythm Forge maps its judgement tiers to osu!mania-style values:

| Rhythm Forge judgement | Accuracy value |
|---|---:|
| Marvelous | 305 |
| Perfect | 300 |
| Great | 200 |
| Good | 100 |
| OK | 50 |
| Bad | 25 |
| Miss | 0 |

Hold heads and tails are separate judged objects. A complete play records the actual judgement order; legacy aggregate-only results receive a deterministic conservative fallback and are marked as not having an exact combo sequence.

## Grade policy

The requested Rhythm Forge SS grade begins at **99.00% accuracy**. Lower grades remain RF-owned: S ≥95%, A ≥90%, B ≥80%, C ≥70%, otherwise D.

## Compatibility boundary

This is not a claim of byte-for-byte compatibility with osu!mania. Rhythm Forge retains its own judgement windows and seven-tier judgement model, while adapting the lazer mania normalized score structure and combo/accuracy split. The version identifier is `rf-score-v2-lazer-mania-adapted-3`.
