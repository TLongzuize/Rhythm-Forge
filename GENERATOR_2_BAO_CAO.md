# Smart Chart Generator 2.0 — Báo cáo triển khai (bản lõi)

## Đã làm
- `smartgen.js` (mới): lớp "hiểu nhạc" đặt trên `generateChart()` hiện có, không đổi schema chart.
  - `analyzeStructure`: chia section theo năng lượng RMS + mật độ onset thật; nhãn trung thực (Low/Medium/High Energy, Build-up) kèm confidence.
  - `tempoInterpretations`: BPM phát hiện + diễn giải half/double-time (độ tin cậy suy ra, không tuyên bố là đo được).
  - `generateSmart`: 6 mode (Balanced, Beat Focus, Melodic, Technical, Relax, Custom), mật độ theo năng lượng section, giới hạn jack theo độ khó/mode, dọn xung đột hold. Seed xác định.
  - `generateAllSmart`, `generateVariations`, `regenerateRange` (giữ nguyên ngoài khoảng, vùng khóa và note `manual:true`).
  - `evaluateChart`: 7 metric có công thức thật (khớp lưới 1/16, phủ onset mạnh, nhất quán mật độ, cân bằng lane, đa dạng/lặp pattern, khả năng chơi) + cảnh báo kèm mốc thời gian.
- UI Generator: chọn mode, điểm chất lượng Q và cảnh báo ngay trong kết quả.
- Test: `tests/smartgen.test.js` (8 test) + 12 test cũ = 20/20 pass.

## Chưa làm (giới hạn đã biết)
- Chưa viết lại phát hiện BPM/onset/tempo map (vẫn dùng `core.js`), chưa phát hiện đổi tempo.
- Chưa có UI 5 tab, timeline canvas, preview, chỉnh/ghép section, khóa section bằng giao diện (API đã có).
- Chưa chuyển sang Web Worker; chưa cache theo fingerprint; chưa thêm pattern mới (staircase, burst…) vào bộ sinh — hiện chỉ định hình lại chart gốc.
- Chưa có test cho âm thanh tổng hợp 13 trường hợp theo yêu cầu.

## Gợi ý bước tiếp
Thêm tempo map + test click-track 140 BPM, thư viện pattern thật, rồi UI tab Phân tích/Quality.

## Cập nhật lượt 2 — Tempo Map (chưa làm UI theo yêu cầu)
- `tempomap.js`: tempo map thật (segment: startTime/endTime/bpm/beatPeriod/beatPhase/confidence/source/manualOverride), beat position liên tục tại điểm đổi tempo; API getTempoAt, getBeatPosition, getBeatTime, getNearestBeat, getSubdivisionTime, getLocalBeatPeriod; chỉnh tay setSegmentBpm/splitSegment/mergeSegments.
- Sửa hợp đồng dữ liệu tempo candidate: `relativeScore` (core) không còn bị đọc thành 0 trong smartgen.
- Sửa lỗi octave: 160 BPM từng bị đọc thành 80 (core.inferTempo); tempo map chọn octave bằng "explained × support".
- Test tổng hợp (tests/tempomap.test.js, 8 test): 70/100/120/140/160, mở đầu im lặng, 120→140, click rất nhỏ, nhiễu, half/double-time, chỉnh tay.
- Phát hiện: timestamp onset của `core.extractFeatures` trễ hệ thống ≈17ms (ổn định, jitter <0.5ms). Chưa bù trong core vì ảnh hưởng gameplay; cần quyết định riêng.
- Chưa làm: chuyển tiếp tempo dần (gradual) mới xấp xỉ bằng bậc thang; chưa nối tempo map vào generateSmart/lưới beat; chưa Worker/cache.

## Cập nhật lượt 3 — Beat grid + nối tempo map vào bộ sinh
- `beatgrid.js`: buildBeatGrid (quarter/eighth/triplet/sixteenth/32nd/tùy ý, swing, accent, measureIndex, tham chiếu đoạn tempo), quantize thích ứng (chỉ snap khi lệch ≤ ngưỡng, giữ syncopation), rhythmicLevel (mức nhịp theo sai số tuyệt đối 20ms).
- `smartgen.js`: xác định note "on-beat" bằng tempo map; thêm metric `tempoMapAlignment` (trọng số 15%, tổng trọng số vẫn = 1) và cảnh báo khi note lệch lưới cục bộ.
- Đo thực tế trên bài synth 120→140 BPM: 98% note nằm trong ±30ms lưới 1/16 theo tempo map.
- Test: 34 (33→34 sau sửa lỗi test rhythmicLevel).
- Chưa làm: pattern library, motif, composition theo section, difficulty model mở rộng, Worker, cache, UI.

## Cập nhật lượt 4 — Pattern library + Composition engine (không UI)
- `patterns.js`: 14 pattern có descriptor đầy đủ (id, category, min/maxDifficulty, minSpacing, maxDensity, laneTransitions, chordRatio, jackIntensity, rhythmicComplexity, energyPreference, compatibleModes, playabilityConstraints); `scorePattern`/`choosePattern` (năng lượng, độ khó, mode, phạt lặp theo độ gần, nhiễu seed); lane bắt đầu gần lane trước (chuyển tiếp mượt).
- `compose.js`: engine sáng tác thật — slot lưới 1/16 theo tempo map, điểm slot từ accent + onset + dải thấp, quota mật độ theo năng lượng section (Build-up +15%), motif theo section (mới → lặp nguyên → lặp đảo), chord/hold có ràng buộc, ghi lại pattern & chuyển tiếp vào `generator.patterns/transitions`.
- `difficulty.js`: mô hình độ khó 10 chiều (NPS, peak, burst, khoảng cách TB, chord, hold, jack, chuyển lane, độ phức tạp subdivision…) → `quality.difficultyModel`, `metadata.difficultyRating`.
- `generateSmart` mặc định dùng compose (engine:'compose'); `engine:'legacy'` giữ làm fallback.
- Test: 41/41 (7 test mới: descriptor, chấm điểm, độ khó đơn điệu, ràng buộc khoảng cách/hold, 6 mode × 4 độ khó, deterministic, fallback).
- Chưa làm: Web Worker, cache phân tích (IndexedDB), sửa/khóa section có lưu, các metric chất lượng còn thiếu (accent alignment, transition quality, section intensity), tự sửa lỗi có preview/undo, test tổng hợp cho gradual/variable tempo, kiểm thử trình duyệt thật, báo cáo hiệu năng.
