# Rhythm Forge V2.3 implementation report

## Generator and sync

- Tempo analysis refines the strongest independent autocorrelation basins to 0.05 BPM instead of rounding every song to an integer tempo.
- Synthetic impulse calibration compensates the stable 17 ms onset-frame lead. Residual phase bias is approximately 0.3–0.4 ms on synthetic 70–180 BPM tests.
- The continuous tempo map is serialized in every V2 chart. Gameplay reads the active segment, so live BPM follows the current musical section.
- Short 3:4 / 4:3 tempo aliases surrounded by a stable tempo are removed. Long or one-way tempo changes remain intact.
- V2 preserves onset-backed triplet and 1/32 slots instead of re-quantizing every selected event to 1/16.
- The evidence-ranked hold planner caps hold ratio and simultaneous holds; transient drums and reverb tails do not become long notes without sustain evidence.

## Gameplay and ScoreV2

- ScoreV2 now separates current judged accuracy from map-completion progress. Future notes are not counted as misses, eliminating end-of-map score ballooning.
- The canvas HUD uses seven fixed score cells and exact score/accuracy values rather than per-frame interpolation, eliminating layout growth and number shake.
- CPS counts every raw keyboard/pointer press in the rolling one-second window, including presses that do not hit a note, and displays peak CPS.
- The HUD adds segment-local live BPM, health, and a full-width song progress indicator.

## UI and customization

- Core navigation and buttons are preserved while panels, cards, focus states, transitions, depth, responsiveness, and reduced-motion behaviour receive a consistent polish pass.
- Nine workspace skins are available, including Cyber Pulse and Sakura Glass.
- Gameplay adds five note skins, four receptor skins, per-lane skin colors, and optional lane guides.

## Verification

- Syntax/typecheck covers every runtime module.
- The automated suite covers ScoreV2 partial-map progress, tempo phase, gradual and abrupt tempo changes, V2 grid sync, long-note constraints, and the standalone bundle.
- Real-audio validation covers 12 MP3 files and all four difficulties per generator. Generated V2 charts remain structurally valid.
- A headless Chrome production render successfully painted the live dev server. Playwright is not installed in this environment, so the Playwright-specific browser suite could not run.
