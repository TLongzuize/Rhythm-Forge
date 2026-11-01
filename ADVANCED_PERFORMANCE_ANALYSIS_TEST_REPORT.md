# Advanced Performance Analysis — Test Report

## Final automated result

- Full project suite: **102/102 passed** (`npm test`, Node test runner, concurrency 2).
- JavaScript syntax/typecheck pass (`npm run typecheck`).
- Production static build pass (`npm run build`, 4,615,122 bytes in `dist`).
- Standalone bundle regression test: **1/1 passed**; the flattened bundle exports and binds the dependencies needed by the tempo map and performance modules.

The automated suites cover perfect, early/late, unstable, lane-imbalanced and lane-balanced plays; stream/jack/chord/burst/hold skill evidence; sections and patterns; gradual timing drift; sudden accuracy changes; miss clusters and recovery; incomplete/failed plays; legacy records without timing events; malformed/duplicate events; deterministic RF rating; recommendations; local profile aggregation; score cap/combo/accuracy/hold-tail behavior; 99% SS grade policy; chart generation; tempo map; cache; section locking; auto-fix; and standalone bundling.

## Benchmark methodology and results

`scripts/performance-analysis-benchmark.js` generates deterministic synthetic gameplay events and measures three `analyzePlay()` runs for 1k, 10k, 50k and 100k events after a warm-up. It records runtime, OS, CPU, logical cores, each run, median duration, and observed heap delta. Raw measurements are saved in `ADVANCED_PERFORMANCE_ANALYSIS_BENCHMARK.json`.

| Events | Median analysis time | Observed heap delta |
|---:|---:|---:|
| 1,000 | 8.53 ms | 3.24 MiB |
| 10,000 | 60.22 ms | 28.58 MiB |
| 50,000 | 353.47 ms | 86.00 MiB |
| 100,000 | 812.68 ms | 26.66 MiB |

Environment: Node v22.16.0, Linux 6.18.57 x64, AMD EPYC 9V74, 3 logical cores. Heap delta is a process-level before/after observation and is affected by garbage collection; it is not a peak-memory guarantee. The benchmark measures Node analysis, not browser Worker latency.

## Browser and device validation limitation

`scripts/browser_test.py` covers gameplay, judgement, pause/resume, editor, chart export/import, Worker creation, IndexedDB cache, settings persistence, portrait/landscape layout and results. It was attempted against `http://127.0.0.1:4173/`, but Chromium navigation failed before any app assertions with `net::ERR_BLOCKED_BY_ADMINISTRATOR`. Therefore this delivery does **not** claim browser end-to-end, physical-device, mobile Safari/Chrome, touch, audio autoplay or IndexedDB UI validation. Static responsive styles, code syntax, production build and automated unit tests passed.

## Evidence limitations

Legacy plays that only stored summary counts are migrated without manufacturing event timing. Skill categories without enough observations remain `insufficient-data`. Pattern attribution requires actual pattern metadata. RF rating is provisional and not calibrated against population data.
