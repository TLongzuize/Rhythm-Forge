# V2.3 music-aware long-note planner

## Lỗi gốc

V2.1 đánh giá từng tap độc lập và chuyển tap thành hold với xác suất tới 85–100% sau khi vượt một ngưỡng sustain khá thấp. RMS lại được chuẩn hóa bằng một cửa sổ rất ngắn quanh note, nên các bản nhạc đã master/nén lớn thường bị hiểu nhầm nền âm liên tục là một âm kéo dài. Kết quả trên 12 bài thật là 13–46% long note ở nhiều chart, có lúc nhiều lane cùng bị khóa.

## Thiết kế V2.3

- Nhận diện một **musical gesture liên tục** bằng nhiều tín hiệu: độ bền envelope, độ ổn định phổ low/mid/high, mật độ onset và release/new attack kế tiếp. RMS lớn một mình không còn đủ để sinh hold.
- Dùng onset hoặc thay đổi timbre/envelope kế tiếp làm release boundary, sau đó snap tail vào tempo-map 1/16 gần nhất.
- Tạo toàn bộ hold candidate trước, chấm điểm evidence rồi chọn toàn cục. Candidate yếu không thể chiếm chỗ của phrase rõ hơn.
- Áp dụng budget theo difficulty/mode, khoảng cách tối thiểu giữa các hold head và hard safety cap cho cả Custom mode.
- Easy/Normal tối đa 1 hold đồng thời; Hard/Expert tối đa 2. Vì vậy luôn còn ít nhất 2 lane tự do và không thể có four-lane hold wall.
- Không tạo hold trên chord, không vượt note kế tiếp cùng lane, không overlap và không tạo tail ngoài bài.
- Generator ghi `generator.holdPlanning` cùng `diagnostics.holdRatio`/`maxActiveHolds` để có thể audit quyết định.

## Kết quả trên 12 MP3 thật

Balanced, seed 42:

| Difficulty | Tỷ lệ V1 trung bình | Tỷ lệ V2.2 trung bình | Khoảng V2.2 | Hold lệch head/tail | Overlap | Max active |
|---|---:|---:|---:|---:|---:|---:|
| Normal | 22.13% | 5.02% | 3.76–5.45% | 0 / 0 | 0 | 1 |
| Hard | 19.83% | 4.80% | 2.81–6.38% | 0 / 0 | 0 | 1 |
| Expert | 34.53% | 4.39% | 2.46–5.43% | 0 / 0 | 0 | 2 |

Báo cáo chi tiết nằm tại `hold-validation/hold-validation-report.json`.

## Xác minh

- `npm test`: 137/137 pass.
- `npm run typecheck`: pass, gồm `rfgen-v2.js`.
- `npm run build`: pass.
- Dedicated V2 suite: 35/35 pass, gồm transient kick/snare/reverb, sustain thật, ratio cap, Custom safety cap, overlap, active-lane cap và tail grid alignment.
