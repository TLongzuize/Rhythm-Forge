# Đáp án và ghi chú kỹ thuật

| Đoạn Expert | Take 1 | Take 2 | Tổng phím bấm V2 / V3 | Thời điểm bấm V2 / V3 | Hold V2 / V3 |
| --- | --- | --- | --- | --- | --- |
| Galaxy Collapse · 3:20–3:40 | V2 | V3 | 260 / 113 | 166 / 109 | 1 / 0 |
| Unity · 0:20–0:40 | V3 | V2 | 102 / 132 | 98 / 108 | 11 / 14 |
| Dance of the Sugar Plum Fairy · 0:12–0:32 | V2 | V3 | 124 / 49 | 103 / 42 | 8 / 10 |

Ở Galaxy Collapse, chênh lệch 147 phím bấm gồm 57 thời điểm bấm và 90 phím chord bổ sung. V3 phát hiện 278 lần tấn công âm thanh. Trong 169 lần không được chọn, 137 thấp hơn ngưỡng tin cậy mặc định và không lần nào đạt đồng thời ngưỡng salience 0.35 và confidence 0.25 của benchmark. V2 đặt 141 trên 166 thời điểm bấm trong phạm vi 35 ms của một onset do V3 dò được. Đây là phép so khoảng cách với bộ dò, chưa có nhãn âm nhạc độc lập để kết luận chart nào đúng hoặc hay hơn. V3 có nhiều phím chord hơn V2 trong đoạn Unity, nên riêng Galaxy không đủ căn cứ để chỉnh mật độ chung.

Điểm vướng có thể sửa ngay là luồng import. Chart Generator nay mở được JSON sau khi nạp audio, kể cả khi dự án chưa từng generate chart. Import hợp lệ hủy generation đang chạy và mở editor. Luồng cũ trong editor vẫn dùng cùng trình import. Mỗi cặp thử dùng chung một WAV, với đầu nốt và đuôi hold được dịch cùng một lượng từ timeline gốc.

[Audit 32 chart và kết quả từng đoạn](exports/results.json) · [Benchmark xử lý audio dài và bộ nhớ của cùng engine](../v3-sustain-hardening/performance.json)

Chạy lại từ thư mục gốc với Node và FFmpeg. Dùng thư mục audio tham chiếu như trong đợt sustain-hardening, tập trung các file OGG vào một thư mục và chọn hai đường dẫn đầu ra mới.

```sh
node scripts/verify-v3-release-candidate.mjs REFERENCE_AUDIO_DIR NEW_REPORT_DIR NEW_LOCAL_WAV_DIR
```
