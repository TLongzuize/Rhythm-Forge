# Rhythm Forge implementation report — isolated play screen and hold input update

## Gameplay screen
- Gameplay replaces the app root with a dedicated full-viewport play surface. The studio sidebar, topbar, footer, song metadata, combo, judgement counters, editor link, and toast overlays are absent while playing.
- Gameplay HUD is limited to score, accuracy, the latest judgement, the playfield, and Audio / Retry / Pause / Exit buttons.
- Fullscreen is attempted when the browser supports it; CSS keeps the game viewport-filling where the native Fullscreen API is unavailable.
- No landscape orientation lock or rotated portrait layout is used. The same layout adapts to portrait and landscape sizes, with viewport-safe-area padding.
- Viewport meta includes `viewport-fit=cover` for devices with display cutouts.

## Settings
- Note scroll speed is a touch-friendly slider from 0.5× to 3.0× (0.1× steps), with a live value readout and locally persisted setting.
- Higher values make notes travel faster; lower values increase approach time.

## Long note/input improvements
- Long note bodies and tails are wider/brighter for better visibility.
- Keyboard and pointer/touch hold logic now tolerates brief releases for 145 ms, and the final 170 ms of a hold is more forgiving.
- Removed the touch-event time throttle that could drop legitimate quick taps/chords.
- Touch lanes still use the full width of each lane; multi-pointer holds can be tracked independently.

## Verification
- `npm test`: 11/11 tests passed, including chart generation, judgement tiers, and long-note chart validity.
- `npm run typecheck`: `app.js`, `core.js`, and `analysis-worker.js` syntax checks passed.
- `npm run build`: static production build completed successfully.
- The updated browser smoke test was attempted, but Chromium navigation to the local test server was blocked by the environment with `ERR_BLOCKED_BY_ADMINISTRATOR`. Browser interaction on a physical mobile device is therefore not claimed as verified.

## Remaining limits
- Native fullscreen behavior depends on browser support and user gesture rules. On browsers without an element Fullscreen API, the CSS-only dedicated play surface is used, though browser chrome may remain visible.
- Dedicated advanced hold-tail editing in the chart editor remains limited.
