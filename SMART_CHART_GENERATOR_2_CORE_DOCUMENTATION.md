# Smart Chart Generator 2.x — Tài liệu lõi

## Kiến trúc (module, không có engine song song)
| Module | Vai trò |
|---|---|
| `core.js` | Phân tích âm thanh (RMS, onset, băng tần thấp/trung/cao, section thô), `generateChart` cũ (fallback), `analyzeAudioFile` (Worker + cache), `analyzeSamplesIncremental` (feature chunks). |
| `tempomap.js` | Tempo map thật: segment (bpm, beatPeriod, beatPhase, confidence), chuyển đổi time↔beat↔measure, chỉnh tay; phát hiện tempo đổi dần (`gradual`). |
| `beatgrid.js` | Lưới beat/subdivision (1/4, 1/8, triplet, 1/16, 1/32, swing) theo tempo map. |
| `patterns.js` | Thư viện 14 pattern có descriptor + chấm điểm chọn pattern. |
| `compose.js` | Engine sáng tác: slot lưới → chọn theo accent/onset/dải thấp → quota mật độ theo section → pattern/motif → chord/hold. Hold planner xét khoảng trống cùng lane, sustain RMS và năng lượng section; độ dài snap theo tempo map, không yêu cầu chart phải ngừng phát note ở mọi lane. Triplet (Hard+) và 1/32 (Expert) **chỉ** khi có onset thật ở ô đó. |
| `difficulty.js` | Mô hình độ khó 10 chiều. |
| `smartgen.js` | Điều phối: 6 mode, section, `generateSmart/All/Variations`, `regenerateRange/Section`, `evaluateChart`. |
| `sections.js` | Sửa/khóa/tách/ghép/đổi tên section; quy tắc không ghi đè; gộp note vùng khóa. |
| `quality-extra.js` | Metric accent alignment, transition quality, section intensity. |
| `autofix.js` | Gợi ý sửa lỗi → preview → áp dụng → undo. |
| `cache.js` | Fingerprint + cache phân tích toàn bài và feature-chunk (IndexedDB, fallback bộ nhớ). |
| `genclient.js`, `gen-worker.js` | Sinh chart trong Web Worker, hủy được, fallback luồng chính. |

## Luồng
audio → decode/mono → Worker `analyzeSamplesIncremental` (feature chunks + context overlap; fallback main thread) → normalize toàn cục + infer BPM → cache → `buildTempoMap` → `analyzeStructure` (+ `applySavedSections`) → `compose` → `sanitize` → `evaluateChart` (+ `computeDifficulty`).

## Cache
Cache toàn bài khóa bằng `ANALYSIS_VERSION | fingerprint(file bytes) | settings`. Cache feature-chunk khóa thêm fingerprint đoạn samples, sample rate, start sample, core range, frame size, hop và context. Chunk dài mặc định 30s với 750ms overlap; các frame được cắt về core range để không trùng. Khi audio thay đổi, fingerprint chỉ làm mất hiệu lực chunk chứa vùng thay đổi (và chunk có overlap chạm vùng đó); các chunk còn nguyên được dùng lại. Sau khi ghép, feature được normalize lại trên toàn bài và tempo/sections được tính lại để giữ tính nhất quán toàn track.
Mục hỏng/lỗi thời bị xóa và ghi vào `cache.errors` (+`console.warn`). Cache toàn bài tối đa 6 mục; feature chunks tối đa 48 mục (LRU theo `savedAt`). `tempoMap` không được lưu (luôn dựng lại). BPM/offset override áp dụng lúc sinh nên không làm cache phân tích lỗi thời.

## Worker
`analysis-worker.js` chạy `analyzeSamplesIncremental` và trả `analysis` cùng số liệu chunk; `analyzeAudioFile` fallback incremental ở main thread nếu Worker/CSP lỗi. `genclient.js`: `generateAllSmartAsync(analysis,title,seed,opts)` / `generateSmartAsync(...)` gửi job tới `gen-worker.js`; gọi job mới sẽ terminate job cũ, hỗ trợ `cancelGeneration()`. Khi không có Worker/Worker lỗi, generation chạy trên main thread và giữ output deterministic (có test fallback). Browser phải hỗ trợ module Worker và IndexedDB để dùng hai lớp persistent cache; lỗi IndexedDB tự chuyển sang memory cache. Trong bản HTML đơn (artifact), Worker bị tắt và dùng fallback main thread.

## Section
Mỗi section: `id,startMs,endMs,startBeat,endBeat,startMeasure,endMeasure,energy,activity,rhythmicDensity,label,confidence` (+`locked`,`userEdited`). Nhãn là phân loại thuật toán (Low/Medium/High Energy, Build-up), không khẳng định verse/chorus.
Section `locked`/`userEdited` lưu ở `chart.generator.sectionEdits` và được áp dụng lại ở lần sinh sau; truyền `baseChart` để note trong vùng khóa giữ nguyên tuyệt đối (note mới trùng id sẽ được đổi id).

## API chính
```js
generateSmart(analysis, title, { difficulty, mode, custom, seed, locked, sections, baseChart, engine })
generateAllSmart / generateVariations / regenerateRange(chart, analysis, title, {from,to,seed,locked})
regenerateSection(chart, analysis, title, sectionId, opts)         // từ chối nếu section khóa
setSectionLocked / splitSection / mergeSectionWithNext / renameSection / applySavedSections
evaluateChart(chart, analysis) → { overall, metrics{score,why,applicable?}, issues[{severity,from,to,message,suggestion?}] }
suggestFixes → previewFixes → applyFixes (→ {chart, changes, undo}) → undoFixes(chart, undo)
fingerprint, cacheKey, createAnalysisCache
```

## Chất lượng (14 metric)
beatAlignment, tempoMapAlignment, onsetCoverage, densityConsistency, laneBalance, patternDiversity, repetition, playability (jack + hold + chồng note), **accentAlignment, transitionQuality, sectionIntensity**. Metric không đủ dữ liệu có `applicable:false` và bị loại khỏi điểm tổng (trọng số chuẩn hóa lại) thay vì cộng điểm giả.

## Long-note / hold planner
Hold được gắn sau bước chọn lane. Engine gom note theo thời điểm, bỏ chord làm điểm bắt đầu hold, tìm note kế tiếp trong **cùng lane**, rồi giới hạn tail trước note đó. Xác suất phụ thuộc difficulty, generation mode, accent, sustain RMS, khoảng trống khả dụng và mật độ cục bộ. Độ dài được snap theo tempo map từ khoảng 1/2 beat đến tối đa 2.5–4 beat tùy difficulty; số hold đang hoạt động đồng thời bị giới hạn (Easy 1, Normal 2, Hard 3, Expert 3). Cách này tránh lỗi cũ: hold chỉ được tạo khi khoảng trống đến *bất kỳ* note tiếp theo ≥600ms, khiến chart Normal/Hard/Expert dày gần như không có hold. Mode Relax/Melodic ưu tiên hold hơn; Technical giảm hold; Custom nhận hệ số `hold`.


## Tương thích chart
Schema không đổi. Trường tùy chọn mới trong `generator`: `sectionEdits`, `lockedRanges`, `subdivisionUsage`. Chart cũ vẫn tải/chơi bình thường (`validateChart` + toàn bộ test cũ pass).

## Cổng bằng chứng nhịp
`rhythmicEvidence(analysis)`: onset đã chuẩn hóa (max=1) nên đếm đỉnh >0.3; <6 đỉnh/phút → `hasRhythm:false`. Khi đó tempo map đặt `lowConfidence:true`, confidence ≤0.1; `generateSmart` trả chart rỗng và `evaluateChart` cảnh báo. Ngưỡng 6/phút dựa trên đo: demo/dense ≈ 128–146 đỉnh, ambient 1, nhiễu 1 (chưa kiểm trên nhạc thật đa dạng).

## Chọn tempo trên nhạc thật
`localTempo` chấm độ khớp peak theo chu kỳ + độ phủ nhịp. Khi BPM toàn cục có confidence đủ, BPM và beat phase toàn cục được dùng làm prior yếu **chỉ** để xử lý các alias phổ biến 1/2, 2, 2/3 (triplet) và 3/2; prior không ép các thay đổi không thuộc các tỉ lệ này, ví dụ 120→140 BPM. Lượt hai vẫn tính tempo chủ đạo theo histogram confidence để xử lý các cửa sổ cục bộ bị khóa vào subdivision. Cách này xử lý được test syncopated 3-3-3-3-2-2 với nhịp nền 120 BPM và test triplet 120 BPM; chưa phải bộ phân loại meter/downbeat phổ quát cho mọi bản nhạc. Kiểm tra MP3: `node scripts/analyze-real.mjs file.mp3` (cần ffmpeg).

## Giới hạn đã biết
- Syncopation có nhiều kiểu. Bộ test hiện xác nhận mẫu 3-3-3-3-2-2 ở nhịp nền 120 BPM và pattern triplet 120 BPM; cần thêm ground truth từ nhiều thể loại/bản thu thật để tránh overfit theo các alias đã biết.
- Tempo đổi dần là **xấp xỉ bậc thang** (đoạn 4s), không nội suy tuyến tính; ramp ngắn/nhỏ có thể bị gộp thành 2 đoạn (ví dụ 90→130 BPM trong 50s: sai số beat trung bình ≈100ms). Ramp 100↔140 trong 60s: sai số TB ≈16–22ms, tối đa ≈41–59ms.
- `core.extractFeatureFrames` dùng tâm của frame thực tế (kể cả frame cuối ngắn) để timestamp không bị chạy ra ngoài thời lượng audio và incremental/full analysis trùng nhau. Độ trễ phát hiện onset so với transient có thể còn phụ thuộc frame/window và không được xem là phép đo tuyệt đối.
- Auto-fix chỉ xử lý: note không hợp lệ, hold chồng, jack dài, đỉnh mật độ. API preview/apply/undo đã có test; không bổ sung nút UI trong phase này theo yêu cầu giữ nguyên UI. Section edits/lock/split/merge/rename cũng đang ở API, chưa có UI chỉnh sửa.
- Đã thử chạy smoke test bằng Chromium/Playwright nhưng môi trường trả `net::ERR_BLOCKED_BY_ADMINISTRATOR` cho cả localhost, data URL và chrome://; do đó chưa thể xác nhận Worker, IndexedDB và UI end-to-end trong browser ở môi trường hiện tại. Các test Node chỉ xác nhận fallback, incremental chunks, cache contract và deterministic output; không thay thế browser test.
- Metric accentAlignment đạt ~1.00 trên demo; nó phản ánh việc compose ưu tiên accent, nên ít phân biệt giữa các chart do compose sinh (vẫn giảm rõ khi note bị lệch — có test).
