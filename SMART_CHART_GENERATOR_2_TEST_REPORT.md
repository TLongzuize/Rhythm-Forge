# Báo cáo kiểm thử — Smart Chart Generator 2.0

## Kết quả tự động

- `npm test`: **67/67 pass** (Node v22.16.0; `--test-concurrency=2`).
- `npm run typecheck`: **15/15 module syntax checks pass**.
- `npm run build`: **PASS**, static build tạo `dist/` được tái tạo thành công (4,578,535 bytes).
- `node scripts/benchmark-engine2.js`: PASS.

## Test được bổ sung trong lượt này

1. Syncopated `3-3-3-3-2-2`, nền 120 BPM: core BPM và tempo map đều ~120 BPM; trước đây tempo map bị hút lên khoảng 180 BPM.
2. Triplet 120 BPM: Expert tạo note triplet có bằng chứng onset; Easy không dùng triplet.
3. Stable 180 BPM: tempo map 180 BPM, phase bias khoảng 17.4ms, jitter gần 0 trên synthetic fixture.
4. Weak percussion 120 BPM: gain 2%, thêm nhiễu nhẹ; tempo map ~120 BPM, confidence >0.5.
5. Incremental analysis: 5 chunk lần đầu đều được tính; lần hai cache-hit cả 5; chỉnh audio trong một chunk chỉ tính lại chunk bị ảnh hưởng; output feature/BPM khớp full analysis.
6. BPM 160: `analysis.bpm` và `chart.metadata.bpm` cùng ~160; `bpmOverride` vẫn được tôn trọng.


## Long-note regression fix (v13)

- Tái hiện trên `HOMAGE FUNK.mp3`: v12/seed 1337/mode Balanced tạo 0 hold ở Normal, Hard và Expert.
- Nguyên nhân: planner cũ yêu cầu khoảng trống ≥600ms tới note kế tiếp ở bất kỳ lane nào. Ở difficulty cao, note trên lane khác khiến điều kiện gần như không đạt.
- Sửa: xét khoảng trống tới note tiếp theo trên cùng lane; chọn hold dựa trên sustain RMS, beat accent, năng lượng section, mật độ cục bộ và giới hạn hold đang hoạt động. Tail snap theo tempo map và dừng trước note cùng lane kế tiếp.
- Có hệ số hold riêng theo difficulty và generation mode; Custom hỗ trợ `hold` multiplier.
- Regression tests: hold xuất hiện ở Normal/Hard/Expert, độ dài hợp lệ, không đè note cùng lane; mode hold preferences được cấu hình độc lập.
- MP3 sample (130 BPM, 122.7s, seed 1337, Balanced): Easy 23/194 (11.9%), Normal 50/281 (17.8%), Hard 51/612 (8.3%), Expert 63/953 (6.6%). Các chart không có lỗi nghiêm trọng từ evaluator. Đây là một bài nhạc mẫu, không phải cam kết tỷ lệ cho mọi genre.

## Kiểm thử trình duyệt

Đã thử `scripts/browser_test.py` bằng Playwright + Chromium headless với local server. Chromium trả `net::ERR_BLOCKED_BY_ADMINISTRATOR` ngay khi điều hướng đến `http://127.0.0.1:4173/`; thử thêm `localhost`, `data:` và `chrome://policy/` cũng bị chặn. Vì vậy browser test **BLOCKED / NOT VERIFIED**, không ghi là pass. Script đã được tăng cường để khi chạy được sẽ kiểm tra Worker creation, IndexedDB databases (analysis + feature chunks), repeat-analysis cache hit, UI gameplay/editor/import/export và các viewport.

## Nhạc thật

`node scripts/analyze-real.mjs '/mnt/data/HOMAGE FUNK.mp3'`:

- Duration: 123s.
- Core BPM: 130.0.
- Tempo map: 130.0 BPM, confidence 0.66.
- Strong onset peaks within ±35ms of eighth-note grid: 99%.

Đây là phép đo onset-vs-grid, không phải nhãn BPM được xác nhận bằng tai hoặc ground truth chart của nhà sản xuất.

## Benchmark (Node v22.16.0)

| Audio | Analyze | Tempo map | Generate Hard | Notes |
|---|---:|---:|---:|---:|
| 30s | 408ms | 153ms | 325ms | 169 |
| 180s | 2,818ms | 878ms | 1,811ms | 1,024 |

24 lần sinh demo mode×difficulty: mean 8.9ms, max 109.3ms. Memory cache hit: 0.08ms. Đây không phải browser/device performance.

## Điều chưa xác minh / còn hạn chế

- Worker, IndexedDB và UI end-to-end trên browser thật vẫn blocked bởi policy của môi trường.
- Tempo ramp vẫn được xấp xỉ bằng các segment bậc thang; chưa phải tempo curve liên tục.
- Syncopation đã thêm ca 3-3-3-3-2-2 và triplet có ground truth, nhưng cần thêm nhiều mẫu syncopation/meter và nhạc thật.
- Auto-fix và section editing có API; không có button/UI trong phase này vì prompt yêu cầu giữ nguyên UI và không thêm màn hình/component.
- Chưa có đo hiệu năng trên thiết bị di động hoặc browser thực.
