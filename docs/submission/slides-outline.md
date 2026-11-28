# Dàn ý Slide — Chốt (MoMo Tech Contest 2026)

> **Chốt — Copilot AI chốt đơn livestream cho người bán nhỏ**  
> *Khách gõ, Chốt ghi.*

---

## Slide 1: Vấn đề — Bán livestream một mình rất dễ sót đơn
- Hàng trăm bình luận trôi nhanh, lẫn khen, hỏi, chốt.
- Khách viết tắt, dùng tiếng lóng, đổi size, hủy liên tục.
- Người bán vừa thử đồ vừa ghi tay nên dễ nhầm.
- Sau live phải nhắn từng người, đối chiếu chuyển khoản thủ công.
- Dễ gặp khách boom đơn hoặc gửi ảnh chuyển khoản giả.

**Gợi ý hình ảnh:** Ảnh chụp màn hình một buổi livestream đông bình luận trôi nhanh bên cạnh cảnh người bán ghi chép tay bằng sổ.

**Lời thuyết trình:**  
Với người bán nhỏ trên Facebook hay TikTok, một buổi live đông khiến hàng trăm bình luận trôi qua chỉ trong vài phút. Người bán vừa phải nói và thử đồ, vừa tự ghi đơn nên rất dễ sót khách, nhầm size và mất thêm nhiều giờ đối chiếu chuyển khoản sau live.

---

## Slide 2: Người dùng mục tiêu & Quy mô thị trường
- Người dùng chính: người bán nhỏ, hộ kinh doanh livestream.
- Ngành hàng phù hợp: thời trang, mỹ phẩm, gia dụng, nông sản.
- Người dùng phụ: người mua nhận QR nhanh, không chờ nhắn tin.
- Quy mô thị trường Việt Nam: `[CẦN ĐIỀN: số liệu quy mô thị trường / số người bán livestream]`.

**Gợi ý hình ảnh:** Biểu đồ đơn giản phân chia hai nhóm người dùng (Người bán nhỏ ↔ Người mua) và ô số liệu quy mô thị trường Việt Nam.

**Lời thuyết trình:**  
Chốt phục vụ trực tiếp các hộ kinh doanh và người bán nhỏ thường chỉ có một mình hoặc một người phụ khi lên live. Người mua cũng được hưởng lợi vì nhận ngay mã QR đúng số tiền mà không cần chờ shop nhắn lại sau buổi live. `[CẦN ĐIỀN: 1 câu dẫn số liệu quy mô thị trường nếu có.]`

---

## Slide 3: Giải pháp — Chốt: "Khách gõ, Chốt ghi"
- AI "nghe" bình luận livestream theo thời gian thực.
- Hiểu tiếng lóng, viết tắt, câu sửa và hủy đơn.
- Tự tạo đơn có cấu trúc, khớp danh mục của shop.
- Gửi mã VietQR từng đơn và cảnh báo rủi ro.
- Human-centered: AI đề xuất, người bán luôn duyệt và sửa được.

**Gợi ý hình ảnh:** Sơ đồ 1 dòng từ Bình luận khách → AI Chốt → Đơn hàng + QR + Cảnh báo, kèm ảnh chụp màn hình tổng quan giao diện Chốt.

**Lời thuyết trình:**  
Chốt đóng vai trò như một người phụ ghi đơn AI ngồi cạnh người bán trong suốt buổi live. Hệ thống tự động đọc bình luận, gom thành đơn hàng chuẩn xác, gửi QR cho khách và chỉ cần người bán liếc nhìn để duyệt hoặc chỉnh sửa khi cần.

---

## Slide 4: Demo luồng hoạt động End-to-End
- Người bán đăng nhập, kết nối Fanpage, chọn món đang giới thiệu.
- Khách bình luận chốt, đổi size hoặc hủy ngay trên live.
- Đơn hiện realtime trên màn hình người bán kèm tồn kho.
- Fanpage tự trả lời bình luận kèm link thanh toán VietQR.
- Người bán xác nhận tiền về, xem bảng tổng kết sau live.

**Gợi ý hình ảnh:** Ghép 2 ảnh chụp màn hình cạnh nhau: bên trái là điện thoại người mua (bình luận Facebook + link QR), bên phải là laptop người bán (bảng đơn hàng cập nhật realtime).

**Lời thuyết trình:**  
Chỉ với vài thao tác đơn giản, người bán chọn món đang giới thiệu và bắt đầu live. Ngay khi khách bình luận chốt hoặc đổi size, đơn hàng xuất hiện tức thì trên màn hình người bán, đồng thời khách nhận ngay link VietQR đúng số tiền để thanh toán.

---

## Slide 5: AI Pipeline — Hiểu ngữ cảnh & Chống bịa dữ kiện
- Lọc nhanh từ khóa ý định, bỏ qua câu khen chào.
- Gom lô 1–2 giây để giảm độ trễ và chi phí.
- Đưa ngữ cảnh món đang giới thiệu và đơn hiện có.
- Xuất JSON hành động: `create`, `update`, `cancel`, `ask`.
- Chống bịa: câu trả lời size/giá lấy từ danh mục.

**Gợi ý hình ảnh:** Sơ đồ 5 bước AI pipeline (Lọc nhanh → Gom lô → LLM + Ngữ cảnh → JSON hành động → Kiểm tra quy tắc danh mục) kèm ví dụ input/output thực tế.

**Lời thuyết trình:**  
Điểm cốt lõi của Chốt là kết hợp ngữ cảnh món đang giới thiệu với đơn hiện có của từng người mua để hiểu các câu như "cái hồi nãy" hay "đổi sang size L". Đặc biệt, mọi câu trả lời về size hay tồn kho đều do hệ thống tạo từ danh mục thật, tuyệt đối không để LLM tự bịa dữ kiện.

---

## Slide 6: Thanh toán VietQR & Cảnh báo rủi ro boom đơn
- Backend tự sinh chuỗi VietQR EMVCo và ảnh QR.
- Theo dõi trạng thái: Chờ trả → Đối soát → Đã trả.
- Cảnh báo khách có lịch sử boom đơn trước đó.
- Cảnh báo chốt số lượng lớn bất thường trong 1 phút.
- Cảnh báo khi khách báo "đã chuyển" nhưng chưa khớp giao dịch.

**Gợi ý hình ảnh:** Ảnh chụp thẻ đơn hàng có mã VietQR và các badge cảnh báo rủi ro màu đỏ/vàng (khách từng boom đơn, chốt bất thường, chưa khớp tiền).

**Lời thuyết trình:**  
Mỗi đơn hàng có ngay mã VietQR riêng với số tiền và nội dung chuyển khoản chuẩn xác, tự sinh ở backend không phụ thuộc bên thứ ba. Song song đó, hệ thống gắn cờ ngay những khách từng boom đơn, chốt số lượng bất thường hoặc báo đã chuyển khoản nhưng chưa ghi nhận giao dịch.

---

## Slide 7: Kiến trúc hệ thống & Khả năng chịu tải
- Monorepo TypeScript: Next.js, Express, Socket.IO, PostgreSQL/Prisma.
- Đa nguồn bình luận: Facebook Graph API, phòng live, Extension.
- Gemini 3.5 Flash-Lite: đúng 49/50 mẫu, trễ p50 ~1,2–1,8 giây.
- Tự xoay vòng model khi gặp lỗi 429 hoặc 503.
- Load test (30 người, 120 bình luận/phút): 0 sai lệch dữ liệu.

**Gợi ý hình ảnh:** Sơ đồ kiến trúc (Facebook / Phòng live / Extension → Backend → LLM + DB → Màn hình người bán) và bảng kết quả load test (92/92 bản fake, 133/133 bản Gemini free tier, 0 `unparsed`, 0 sai lệch).

**Lời thuyết trình:**  
Hệ thống được xây dựng gọn nhẹ bằng TypeScript với Socket.IO đảm bảo cập nhật realtime giữa người mua và người bán. Qua kiểm thử trên 50 bình luận mẫu, Gemini 3.5 Flash-Lite đạt độ chính xác 49/50, và trong bài load test 120 bình luận mỗi phút với 30 người mua cùng lúc, hệ thống xử lý trọn vẹn 100% đơn không sai lệch dữ liệu.

---

## Slide 8: Khác biệt so với cách làm hiện tại
- Ghi tay / Excel: tốn sức, dễ sót khi live đông.
- Phần mềm chốt đơn theo cú pháp: ép khách gõ đúng mã.
- Chốt dùng AI: hiểu ngôn ngữ tự nhiên, sửa/hủy linh hoạt.
- Tích hợp VietQR từng đơn và cảnh báo boom đơn tức thì.
- Không cần cài đặt phức tạp, dùng thử ngay trên web.

**Gợi ý hình ảnh:** Bảng so sánh 3 cột (Ghi tay / Phần mềm theo cú pháp / Chốt AI) với dấu tick xanh cho các tiêu chí: Hiểu tiếng lóng & sửa đơn, Không cần nhớ cú pháp, QR từng đơn, Cảnh báo boom đơn.

**Lời thuyết trình:**  
Khác với các công cụ truyền thống vốn ép người mua phải gõ đúng cú pháp mã hàng, Chốt hiểu cách nhắn tự nhiên như ngoài đời thật. Nhờ gom cả xử lý đơn, VietQR và cảnh báo rủi ro vào một màn hình, người bán tiết kiệm đáng kể chi phí thuê người phụ.

---

## Slide 9: Kế hoạch phát triển tiếp theo
- Đối soát giao dịch thật thay bước xác nhận tay.
- Tích hợp cổng thanh toán / webhook ngân hàng tự động.
- Nộp Meta App Review để mở rộng cho mọi Fanpage.
- Bổ sung nhắc thanh toán tự động và kết nối vận chuyển.
- Mở rộng hỗ trợ đa nền tảng livestream ổn định hơn.

**Gợi ý hình ảnh:** Lộ trình 3 giai đoạn ngắn gọn (Hiện tại MVP → Sau cuộc thi → Thương mại hóa).

**Lời thuyết trình:**  
Sau phiên bản MVP dự thi, nhóm sẽ hoàn thiện đối soát chuyển khoản tự động qua webhook ngân hàng thay cho bước xác nhận thủ công hiện tại. Tiếp đó là hoàn tất Meta App Review và kết nối đơn vị vận chuyển để khép kín quy trình từ lúc khách bình luận đến khi giao hàng.

---

## Slide 10: Đội ngũ & Kêu gọi
- Nhật: Frontend người bán, phòng live, quản lý phiên và đơn.
- Nghĩa: Pipeline AI, prompt, VietQR, cảnh báo rủi ro, Extension.
- Hợp tác song song qua schema dùng chung `packages/shared`.
- Trải nghiệm thử ngay bản demo trực tuyến cùng nhóm.
- Chốt — *"Khách gõ, Chốt ghi."*

**Gợi ý hình ảnh:** Ảnh/avatar 2 thành viên kèm vai trò, mã QR dẫn tới trang dùng thử / repo và slogan *"Khách gõ, Chốt ghi."*

**Lời thuyết trình:**  
Nhóm gồm hai thành viên là Nhật và Nghĩa, phân chia rõ phần giao diện realtime và phần lõi AI, VietQR, cảnh báo rủi ro. Kính mời Ban Giám khảo quét mã QR để trực tiếp đóng vai người mua và trải nghiệm Chốt ngay trên điện thoại của mình. Xin cảm ơn!
