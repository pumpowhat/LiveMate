# Mua Chuẩn — Trợ lý AI chọn đúng hàng, đúng shop trên sàn thương mại điện tử

> Dự thi **MoMo Tech Contest 2026 — Imagine the Future Workspace (Human Centered. AI Powered)**
> Chủ đề: **Trợ lý AI (Trợ lý mua sắm)** + **Chống lừa đảo**
> *(Tên sản phẩm tạm thời, có thể đổi.)*

---

## 1. Vấn đề

Người mua online ở Việt Nam ít khi bí ở câu *"nên mua model nào"* — câu đó ChatGPT trả lời được. Cái khó thật sự là **mua ở đâu cho đúng**:

- Cùng một mẫu tai nghe, trên sàn có hàng chục shop bán với giá chênh nhau rất nhiều.
- Không biết shop nào bán **hàng chính hãng**, shop nào bán **hàng nhái**.
- Review 4,9 sao có thể là **review ảo**.
- "Giảm 60%" có thể là **giá ảo** — nâng giá gốc trước khi sale.
- Giá rẻ bất thường thường đi kèm rủi ro, nhưng người mua khó nhận ra.

Để tự kiểm tra, người dùng phải mở từng sản phẩm, đọc hàng trăm review, so giá thủ công — mất thời gian và vẫn dễ sai.

**Vì sao ChatGPT không giải quyết được?** Chatbot tổng quát không nhìn thấy danh sách shop thật trên sàn, không đọc được review thật và không đánh giá được từng listing cụ thể.

## 2. Giải pháp

**Mua Chuẩn** là tiện ích Chrome có trợ lý AI. Người dùng chỉ cần nói nhu cầu, trợ lý **tự tìm trên sàn, tự mở và đọc từng sản phẩm**, rồi trả lời cả hai câu:

1. **Nên mua gì** — model phù hợp với nhu cầu và ngân sách.
2. **Mua ở shop nào** — shop đáng tin nhất, và shop nào nên tránh, kèm lý do.

Ví dụ:

> **Người dùng:** Tai nghe chống ồn dưới 800k, chủ yếu đi xe buýt.
>
> **Mua Chuẩn:** Nên mua **[Model A] tại Shop X — 742.000đ**: shop chính hãng, review đa dạng và có ảnh thật, giá sát mặt bằng chung.
> ⚠️ Tránh **Shop Y — 450.000đ**: rẻ hơn ~40% so với mặt bằng, nhiều review gần đây phản ánh hàng không giống mô tả.

## 3. Đối tượng người dùng

- **Chính:** người mua sắm online cá nhân (sinh viên, người đi làm) mua đồ điện tử, gia dụng — các ngành hàng dễ gặp hàng giả và chênh giá lớn.
- **Mở rộng sau:** người lớn tuổi ít kinh nghiệm mua online; phụ huynh mua hộ con.

## 4. Phù hợp với đề bài

| Yêu cầu đề | Mua Chuẩn đáp ứng |
|---|---|
| Trợ lý mua sắm — đại diện người dùng trong hành trình mua sắm | Tự tìm kiếm, mở trang, đọc và so sánh thay người dùng |
| Chống lừa đảo — cảnh báo trước khi mất tiền | Cảnh báo hàng giả, review ảo, giá ảo **trước** khi đặt hàng |
| Human Centered | AI chỉ đề xuất và giải thích; người dùng luôn là người quyết định mua |
| AI là thành phần cốt lõi | Bỏ AI thì không còn sản phẩm: hiểu nhu cầu, đọc review, chấm điểm, giải thích đều do AI |
| Dùng được trực tuyến, test trên dữ liệu thật | Chạy trên sàn thật, bằng tài khoản thật của người dùng; không phát sinh giao dịch |

## 5. Cách hoạt động

Sản phẩm dùng **luồng xử lý cố định** (pipeline) thay vì agent tự do, để ổn định và dễ kiểm soát.

```
Người dùng nhập nhu cầu
        │
        ▼
[1] LLM hiểu nhu cầu ──► { từ khóa, khoảng giá, tiêu chí }
        │
        ▼
[2] Extension mở trang tìm kiếm trên sàn, đọc danh sách kết quả
        │
        ▼
[3] LLM lọc 5–8 sản phẩm đáng xem
        │
        ▼
[4] Extension mở ngầm từng trang sản phẩm: giá, shop, lượt bán, review
        │
        ▼
[5] LLM chấm điểm từng shop theo thang cố định
        │
        ▼
[6] LLM viết khuyến nghị: nên mua ở đâu, tránh shop nào, vì sao
```

### Thang chấm điểm (bước 5)

| Tiêu chí | Tín hiệu AI xem xét |
|---|---|
| **Khả năng chính hãng** | Loại shop (Mall/chính hãng), tuổi shop, mô tả sản phẩm, review nhắc đến hàng nhái |
| **Độ tin cậy của review** | Nội dung lặp lại, review ngắn chung chung, dồn dập trong thời gian ngắn, tỉ lệ review có ảnh thật |
| **Giá có bất thường không** | So với mặt bằng giá của cùng model; giá gốc bị đẩy lên trước khi giảm |
| **Mức độ phù hợp nhu cầu** | Đối chiếu tính năng với tiêu chí người dùng nêu |

Mỗi đánh giá đều kèm **lý do ngắn** dẫn từ dữ liệu trên trang, để người dùng tự kiểm chứng.

### Chế độ dự phòng

Nếu việc tự tìm kiếm gặp lỗi (captcha, trang thay đổi), người dùng có thể **tự mở trang** trên sàn và bấm *"Phân tích trang này"* — trợ lý vẫn đọc và chấm điểm bình thường.

## 6. Kiến trúc

```
┌──────────────────────────┐        ┌──────────────────────┐        ┌───────────┐
│   Chrome Extension (MV3) │        │       Backend        │        │  LLM API  │
│ - Side panel: giao diện  │ <────> │ - Giữ API key        │ <────> │ model nhỏ │
│   chat                   │  HTTPS │ - Gọi LLM theo từng  │        │ nhanh, rẻ │
│ - Mở tab ngầm, lấy text  │        │   bước pipeline      │        └───────────┘
│   trang                  │        │ - Trả JSON kết quả   │
└──────────────────────────┘        └──────────────────────┘
```

- **Extension:** `chrome.sidePanel` cho giao diện; `chrome.tabs.create({ active: false })` để mở tab ngầm; `chrome.scripting.executeScript` để lấy nội dung trang; đóng tab sau khi đọc.
- **Backend:** giữ API key (không đặt key trong extension), điều phối các bước gọi LLM, kiểm tra JSON đầu ra.
- **LLM:** model nhỏ, nhanh, giỏi tiếng Việt, hỗ trợ JSON output và context dài (ví dụ dòng Gemini Flash / GPT mini / Claude Haiku — chọn bản phù hợp khi triển khai).

## 7. Công nghệ dự kiến

| Thành phần | Công nghệ |
|---|---|
| Extension | JavaScript/TypeScript, Chrome Manifest V3 |
| Backend | FastAPI (Python) hoặc Node.js |
| Hosting | Render / Railway / Vercel |
| AI | LLM API với structured JSON output |
| Phân phối | Chrome Web Store (kèm bản cài thủ công dự phòng) |

## 8. Nguyên tắc về dữ liệu và đạo đức

- **Không quét dữ liệu từ server.** Extension chỉ đọc các trang trong trình duyệt của chính người dùng, với tốc độ và số lượng tương tự người thật.
- **Không vượt captcha.** Nếu sàn yêu cầu xác minh, trợ lý dừng lại và nhờ người dùng tự xử lý.
- **Không tự đặt hàng, không thanh toán.** Quyết định mua luôn thuộc về người dùng.
- **Không lưu dữ liệu cá nhân.** Chỉ gửi nội dung trang sản phẩm công khai về backend để phân tích.
- **Không kết luận thay người dùng một cách tuyệt đối.** Kết quả là đánh giá rủi ro kèm lý do, không phải phán quyết "shop này lừa đảo".

## 9. Phạm vi MVP

**Bắt buộc có**
- Nhập nhu cầu bằng chat trong side panel
- Tự tìm kiếm và đọc danh sách sản phẩm trên Shopee (web)
- Mở và đọc 5–8 trang sản phẩm
- Chấm điểm theo 4 tiêu chí, khuyến nghị nên mua / nên tránh kèm lý do
- Hiển thị tiến trình ("Đang xem shop 3/8…")
- Chế độ dự phòng "Phân tích trang này"

**Làm thêm nếu kịp**
- Hỗ trợ TikTok Shop (cần kiểm tra luồng trên web)
- Hỏi lại khi nhu cầu chưa rõ ("Bạn ưu tiên pin hay chống ồn?")
- Lưu lịch sử tìm kiếm

**Ngoài phạm vi**
- Tự đặt hàng, thanh toán
- Theo dõi lịch sử giá dài hạn

## 10. Kịch bản demo (≤ 3 phút)

1. Mở Shopee thật, mở side panel Mua Chuẩn.
2. Gõ: *"Tai nghe chống ồn dưới 800k, chủ yếu đi xe buýt."*
3. Trợ lý tự mở trang tìm kiếm, hiển thị tiến trình đọc từng shop.
4. Kết quả: 1 shop nên mua, 1–2 shop nên tránh, mỗi shop có lý do cụ thể.
5. Bấm vào shop được đề xuất → mở đúng trang sản phẩm để người dùng tự quyết.
6. Chuyển sang chế độ dự phòng: mở một trang sản phẩm bất kỳ → *"Phân tích trang này"*.

## 11. Kế hoạch triển khai

| Ngày | Việc |
|---|---|
| 1 | Bản thử: extension mở trang tìm kiếm và trang sản phẩm Shopee, lấy được text. **Không được thì đổi hướng ngay.** |
| 2–3 | Backend + prompt các bước 1, 3, 5, 6. Nộp extension lên Chrome Web Store sớm. |
| 4–5 | Giao diện side panel, hiển thị tiến trình, chế độ dự phòng. |
| 6 | Test với ~10 nhu cầu thật, tinh chỉnh prompt và thang điểm. |
| 7 | Slide (≤ 10 trang), video (≤ 3 phút), hướng dẫn sử dụng (1 trang A4). |

*Hạn nộp cần xác nhận lại với thể lệ chính thức của ban tổ chức.*

## 12. Rủi ro và cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| Không đọc được dữ liệu Shopee (render bằng JS, review tải chậm, cần đăng nhập) | Kiểm tra ngay ngày 1; chờ trang tải xong, cuộn để tải review; đọc nội dung text thay vì phụ thuộc cấu trúc HTML |
| Shopee hiện captcha / chặn | Dừng lại, nhờ người dùng xử lý; chế độ dự phòng tự mở trang |
| Giao diện sàn thay đổi | Để LLM trích thông tin từ text trang, hạn chế selector cứng |
| Chrome Web Store xét duyệt chậm | Nộp sớm (ngày 2–3); chuẩn bị bản cài thủ công + hướng dẫn 3 bước |
| AI đánh giá sai | Luôn kèm lý do dẫn từ dữ liệu; dùng ngôn ngữ "rủi ro", không kết luận tuyệt đối |
| Tốc độ chậm (đọc nhiều trang) | Giới hạn 5–8 sản phẩm, mở song song có kiểm soát, hiển thị tiến trình |

## 13. Cài đặt và chạy

*(Sẽ cập nhật khi có mã nguồn.)*

```bash
# Backend
cd backend
cp .env.example .env   # điền LLM API key
# lệnh cài đặt và chạy

# Extension
# Chrome → chrome://extensions → bật Developer mode → Load unpacked → chọn thư mục extension/
```

## 14. Tài sản có sẵn, thư viện và công cụ AI đã dùng

*(Bắt buộc khai báo theo thể lệ — cập nhật trong quá trình làm.)*

| Loại | Tên | Mục đích |
|---|---|---|
| Thư viện mã nguồn mở | | |
| Dịch vụ / API | | |
| Công cụ AI hỗ trợ phát triển | | |

## 15. Thành viên

| Họ tên | Vai trò |
|---|---|
| | |