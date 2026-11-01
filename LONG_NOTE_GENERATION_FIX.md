# Long-note generation fix — Rhythm Forge v13

## Lỗi tái hiện
Trên `HOMAGE FUNK.mp3` (130 BPM, 122.7s), v12 dùng compose-2 ở seed 1337 và mode Balanced tạo 0 hold ở Normal, Hard và Expert.

## Nguyên nhân
Planner cũ chỉ tạo hold khi note kế tiếp của toàn chart cách note hiện tại ít nhất 600 ms. Ở difficulty cao, dù lane của note hiện tại còn trống, các lane khác vẫn có note nên điều kiện toàn-chart chặn gần hết hold.

## Sửa đổi
- Tìm note kế tiếp trong cùng lane và dùng nó làm giới hạn tail, không dùng note gần nhất bất kể lane.
- Ước lượng sustain từ RMS tương đối quanh onset; kết hợp beat accent, khoảng trống, năng lượng section và mật độ cục bộ.
- Snap end theo tempo map, giữ tail trước note cùng lane kế tiếp và giới hạn số hold đồng thời.
- Difficulty và mode có hệ số hold riêng; Custom hỗ trợ `hold` multiplier.
- Giữ nguyên chart schema, lane mapping, UI và gameplay interface.

## Kết quả trên bài nhạc mẫu
`HOMAGE FUNK.mp3`, 130 BPM, 122.7s, seed 1337, Balanced:

| Difficulty | Holds | Tỷ lệ | Độ dài TB |
|---|---:|---:|---:|
| Easy | 23 / 194 | 11.9% | 0.98 beat |
| Normal | 50 / 281 | 17.8% | 1.16 beat |
| Hard | 51 / 612 | 8.3% | 1.11 beat |
| Expert | 63 / 953 | 6.6% | 0.87 beat |

Các chart sample có zero error ở quality evaluator. Đây là phép đo trên một bài nhạc, không khẳng định tỷ lệ tối ưu cho mọi thể loại.

## Xác minh
- `npm test`: 67/67 pass.
- `npm run typecheck`: 15 module syntax checks pass.
- `npm run build`: pass.
- Standalone build + bundle smoke test: pass.
- Browser end-to-end vẫn chưa xác minh trong môi trường này do Chromium bị chặn bởi `ERR_BLOCKED_BY_ADMINISTRATOR`.
