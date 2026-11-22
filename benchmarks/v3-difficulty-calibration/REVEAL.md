# Kết quả hiệu chỉnh độ khó V3

**Trạng thái — NOT RELEASE READY.** Bản hiệu chỉnh đã qua kiểm tra kỹ thuật và có thể chơi thử. Hard và Expert vẫn có cách phân bố tải khác V2 trên một số đoạn, và chưa có phản hồi chấp nhận cho bản mới. V2 vẫn là lựa chọn mặc định.

| Cấp và đoạn | Take 1 | Take 2 | Số phím V2 / V3 cũ / V3 mới |
| --- | --- | --- | --- |
| Easy · Galaxy Collapse 3:20–3:40 | V2 | V3 | 48 / 0 / 27 |
| Normal · Sugar Plum Fairy 0:12–0:32 | V3 | V2 | 67 / 26 / 36 |
| Hard · Unity 0:20–0:40 | V2 | V3 | 102 / 102 / 116 |
| Expert · Galaxy Collapse 3:20–3:40 | V3 | V2 | 260 / 113 / 121 |

## Nguyên nhân và thay đổi

- Ngưỡng salience tuyệt đối làm rỗng Easy và Normal ở các đoạn có nhiều onset tin cậy nhưng tương phản thấp. Ở Galaxy Collapse, salience trung vị của các onset vượt sàn confidence chỉ khoảng 0,178. Ngưỡng cũ là 0,38 ở Easy và 0,30 ở Normal. Bản mới hiệu chỉnh ngưỡng chọn theo phân bố salience trong từng câu đủ hoạt động, có sàn riêng cho mỗi cấp và giữ sàn confidence. Câu nhạc thưa tiếp tục dùng ngưỡng cũ.
- V3 thường chọn thế bấm tránh lặp ngón ngay cả ở một nhịp lặp rõ. Bản mới chỉ thưởng jack có ba onset cùng dải nổi bật, mức lực tương đương và khoảng cách lặp ổn định. Normal có ngoại lệ 195 ms cho jack được xác nhận. Hard/Expert vẫn áp khoảng hồi phím 155/105 ms. Roll dùng bốn onset đều với chuyển động dải tần hoặc độ nổi lên dần. Tính đa dạng được chấm trên hình thực sự bấm ra. Việc chọn chuỗi onset vẫn độc lập với các lần thử thế bấm.
- V2 dùng lưới nhịp và quota theo đoạn, cùng cách phân bổ chord khác V3. V3 mới nhấn thêm các onset nhiều dải nổi bật so với câu nhạc. Chord gần nhịp kế tiếp phải chừa phím còn hồi được. Hold với bằng chứng nhả rõ có thể ưu tiên hơn chord trên cùng onset. Điều này khôi phục Mutilator Expert từ 28 hold ở bản thử nội bộ lên 36, bằng baseline.
- Kiểm tra phần Expert 3:20–3:40 cho thấy năm onset bị bỏ qua có khoảng cách đối xứng hợp lý giữa hai nốt đã chọn, cả năm đều dưới sàn confidence mặc định. Kết quả này hạn chế số onset có thể bổ sung một cách đáng tin cậy.

## Kết quả

Trung bình số nốt mỗi giây, mỗi bản thu có trọng số bằng nhau.

| Cấp | V2 | V3 cũ | V3 mới | Peak một giây V2 / V3 cũ / V3 mới |
| --- | ---: | ---: | ---: | --- |
| Easy | 2,39 | 1,17 | 1,98 | 4,00 / 3,13 / 3,75 |
| Normal | 4,09 | 1,84 | 3,11 | 7,75 / 4,75 / 6,38 |
| Hard | 6,28 | 3,74 | 4,34 | 11,13 / 7,88 / 8,75 |
| Expert | 7,41 | 5,17 | 5,37 | 12,75 / 10,88 / 10,88 |

Trong tám bản thu, cửa sổ bốn head có roll tăng **12 → 14** ở Hard và **20 → 27** ở Expert. Cửa sổ có chord trong chuỗi nhanh tăng **256 → 499** ở Hard và **856 → 1.090** ở Expert. Các cửa sổ có thể chồng nhau. Jack đôi đo dưới 230 ms tăng **0 → 26** ở Normal, **0 → 32** ở Hard và **4 → 29** ở Expert. Số chuyển tiếp cùng tay dưới 110 ms ở Unity Expert là **81 → 92** trên toàn bài. Đoạn Hard Unity của playtest có 116 phím, trong đó 19 là phím chord bổ sung và 14 là hold.

Expert trên Galaxy, bản folk và Vibe Ace vẫn nhẹ hơn rõ về mật độ hoặc tải phím so với V2. Mutilator Expert đi theo hướng ngược lại, ở **7,86 nốt/giây** so với **4,97 của V2**. Các số này giúp khoanh đoạn cần chơi thử. Cảm giác độ khó, chất lượng thế bấm và độ khớp nhạc vẫn do người chơi xác nhận.

32 cặp so sánh dùng tám bản thu trùng SHA, cùng PCM mono 22,05 kHz, mode Balanced, Density 1.00× và seed theo cấp. So sánh DSP dùng onset và tempo của V3 làm mốc chung. Các nhãn subdivision, syncopation và pattern là phép đo gần đúng. Cách tách thời điểm bấm, phím bấm đồng thời và thời điểm nhả hold cũng phù hợp với quy ước chơi 4K. [Tài liệu osu!mania](https://osu.ppy.sh/wiki/en/Game_mode/osu!mania)

## Kiểm chứng và tái lập

- 32 chart mới hợp lệ, tái tạo chính xác và dùng cùng tempo map. Tất cả head trùng timestamp onset đã dò. Bản articulation-3 tái tạo đúng toàn bộ chart V3 đã lưu trước thay đổi.
- Density 0.55× và 1.45× đã được thử trên cả 32 thiết lập. V3 giữ các phím cốt lõi Hard/Expert ở Density trên 1.00×. Cả năm mode được thử trên Galaxy Collapse, Unity và Sugar Plum Fairy.
- Benchmark mới đo tối đa **61,1 ms** để compose một chart sau phân tích. Lượt benchmark giữ tối đa khoảng **314 MiB RSS** ở tiến trình Node, gồm PCM và cả chart đối chứng. Đây là số desktop.
- [Baseline](baseline.json) · [Kết quả từng bài, cấp và đoạn](after.json) · [Playtest](README.md)

Từ thư mục gốc, stage baseline chạy với mã V3 trước thay đổi. Stage candidate dùng cùng thư mục cache. Audio OGG lấy từ cùng bộ tham chiếu ở [đợt sustain-hardening](../v3-sustain-hardening/REVEAL.md).

    node scripts/benchmark-v3-difficulty.mjs baseline REFERENCE_AUDIO_DIR MATCHED_CACHE BASELINE_JSON
    node scripts/benchmark-v3-difficulty.mjs candidate REFERENCE_AUDIO_DIR MATCHED_CACHE CANDIDATE_JSON
    node scripts/build-v3-difficulty-playtest.mjs MATCHED_CACHE NEW_CHART_DIR
