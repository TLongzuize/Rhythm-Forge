# Báo cáo bàn giao — Smart Chart Generator 2.0 Core Engine

## Trạng thái

**Đã hoàn thiện các hạng mục code có thể kiểm tra trong môi trường hiện tại.** Bộ test Node, syntax check, production build và standalone HTML build đều pass. Browser end-to-end vẫn chưa được xác nhận do Chromium bị chính sách môi trường chặn ngay tại navigation; không xem đây là bản production-verified cho đến khi chạy browser smoke test trên máy/môi trường không bị chặn.

## Đã hoàn thiện trong lượt này

### Bổ sung v13 — khôi phục mật độ long note

- Tái hiện lỗi v12 trên `HOMAGE FUNK.mp3`: Normal/Hard/Expert có 0 hold trong mode Balanced do điều kiện cũ đòi khoảng trống 600ms đến note kế tiếp ở toàn chart.
- `compose.js` đã chuyển sang xét khoảng trống **cùng lane**, dùng sustain RMS + accent + section energy + mật độ cục bộ để chọn hold; tail được snap theo tempo map và kết thúc trước note cùng lane tiếp theo.
- Hold chance và số hold đồng thời được điều chỉnh theo difficulty; 6 mode có preference riêng; Custom nhận `hold` multiplier. Không đổi chart schema hoặc UI.
- Đo trên `HOMAGE FUNK.mp3` (130 BPM, 122.7s, seed 1337, Balanced): Easy 23/194 (11.9%), Normal 50/281 (17.8%), Hard 51/612 (8.3%), Expert 63/953 (6.6%). Chart không có lỗi nghiêm trọng từ evaluator.
- Thêm 2 regression tests về hold ở chart mật độ cao, kết thúc trước note cùng lane, và preference theo mode.


1. **Chống khóa nhầm BPM ở syncopation/triplet:** tempo-map local fitting dùng BPM + beat phase toàn cục làm prior yếu chỉ với alias octave/triplet (1/2, 2, 2/3, 3/2), khi confidence toàn cục đủ và score grid vẫn có bằng chứng. Tránh ép các thay đổi như 120→140 BPM. Test 3-3-3-3-2-2 120 BPM và triplet 120 BPM đều pass.
2. **Thống nhất BPM ở trường nguồn và chart:** test stable 160 BPM xác nhận `analysis.bpm` và `chart.metadata.bpm` đều đúng khoảng 160; `bpmOverride` của người dùng vẫn được ưu tiên. Không còn cần một sửa octave hậu kỳ cho ca stable này.
3. **Weak-percussion test riêng cho tempo map:** click gain 2%, thêm nhiễu nền nhẹ, giữ 120 BPM và confidence >0.5.
4. **Incremental analysis được xác nhận:** `analyzeSamplesIncremental` chia feature chunks, overlap context, key theo fingerprint + sample/config. Lần đầu tính 5/5 chunk, chạy lại cache-hit 5/5; khi sửa sample trong một chunk, chỉ chunk ảnh hưởng bị tính lại. Full và incremental features khớp trong test.
5. **Sửa timestamp frame cuối:** frame ngắn ở cuối audio dùng tâm của số sample thực tế thay vì `frameSize/2`, tránh timestamp vượt thời lượng và làm full/incremental feature stream lệch số frame.
6. **Worker diagnostic:** `analysis-worker` gửi incremental stats và `analyzeAudioFile` giữ chúng trên kết quả runtime; stats không cần lưu như dữ liệu phân tích persistent.
7. **Browser smoke test được mở rộng:** script giờ đo số lần tạo Worker, lần mở IndexedDB, xác nhận hai DB cache tồn tại và probe repeat-analysis cache hit, ngoài các kiểm thử UI gameplay/editor/import/export/responsive hiện có.
8. **Standalone builder:** sửa bộ nhận diện dòng `new Worker()` trong `scripts/build-artifact.py` để tương thích với whitespace hiện tại; standalone artifact tạo và syntax-check pass.
9. **Ổn định test runner:** `npm test` dùng `--test-concurrency=2`; toàn bộ 67 test pass trong lần xác minh cuối.

## Kết quả xác minh

- `npm test`: **67/67 pass** (Node v22.16.0; lần xác minh cuối khoảng 20.6s, test concurrency 2).
- `npm run typecheck`: **15/15 JS module syntax checks pass**.
- `npm run build`: **PASS**, `dist/` được tái tạo (4,578,535 bytes).
- `python3 scripts/build-artifact.py /mnt/data/rhythm-forge-v13.html`: PASS; inline ES module `node --check` PASS; artifact 5,986,998 bytes.
- Real audio `HOMAGE FUNK.mp3`: 123s, core BPM 130.0, tempo map 130.0 (confidence 0.66), 99% strong onset peaks within ±35ms of eighth-note grid.
- Benchmark Node v22.16.0: 30s analyze 408ms / tempo map 153ms / Hard generation 325ms; 180s analyze 2,818ms / tempo map 878ms / Hard generation 1,811ms; 24 demo mode×difficulty mean 8.9ms, max 109.3ms; memory cache hit 0.08ms.

## Browser test — chưa được xác minh

Đã khởi động local server và thử chạy `scripts/browser_test.py` bằng Playwright + Chromium headless. Chromium trả `net::ERR_BLOCKED_BY_ADMINISTRATOR` khi mở `http://127.0.0.1:4173/`; thử `localhost`, `data:` và `chrome://policy/` cũng bị chặn. Vì vậy không thể xác nhận thực tế Worker, IndexedDB hoặc UI end-to-end trong phiên môi trường này. Script đã được tăng cường, sẵn sàng chạy lại trên máy local không có chính sách chặn.

## Những gì được giữ nguyên

- UI, màn hình, component, luồng sử dụng hiện tại; không thêm tab/panel/button.
- Chart schema và tương thích chart cũ.
- Sáu generation modes, bốn difficulties, generation legacy fallback.
- Manual notes, locked sections, selective regeneration, deterministic seed.
- API auto-fix preview/apply/undo và API section lock/split/merge/rename.

## Giới hạn còn lại

- **Browser thật:** còn pending do lỗi policy ở môi trường test; phải chạy `npm run browser:test` trên máy có Chromium truy cập được localhost.
- **Tempo ramp:** vẫn biểu diễn gần đúng bằng các segment bậc thang, chưa nội suy tempo curve liên tục.
- **Syncopation:** hai fixture cụ thể (3-3-3-3-2-2 và triplet) đã pass; cần nhiều pattern phức tạp, meter lạ và nhạc thật có ground truth để khẳng định rộng hơn.
- **UI controls:** không thêm nút auto-fix/section editing vì prompt yêu cầu giữ nguyên UI và không xây Studio UI trong phase core engine. Chức năng backend/API đã có, có test.
- **Hiệu năng:** benchmark hiện là Node synthetic, không phải đo trên browser/điện thoại.

## Các file sửa/thêm chính

**Sửa:** `core.js`, `tempomap.js`, `compose.js`, `smartgen.js`, `package.json`, `scripts/browser_test.py`, `scripts/build-artifact.py`, `tests/engine2.test.js`, `tests/tempomap.test.js`, `tests/compose.test.js`, `SMART_CHART_GENERATOR_2_CORE_DOCUMENTATION.md`, `SMART_CHART_GENERATOR_2_TEST_REPORT.md`, `SMART_CHART_GENERATOR_2_FINAL_REPORT.md`.

**Thêm:** `tests/incremental.test.js` và regression tests hold trong `tests/compose.test.js`.

**Build output cập nhật:** `dist/`.

## Cách xác minh lại

```bash
npm test
npm run typecheck
npm run build
npm run browser:test
node scripts/analyze-real.mjs "/path/to/track.mp3"
node scripts/benchmark-engine2.js
```
