# Kịch bản Video Demo — Chốt (≤ 3 phút)

> **Thông điệp chính:** *"Khách gõ, Chốt ghi."*  
> **Tổng thời lượng:** 02:55 (175 giây, ≤ 3 phút)  
> **Tốc độ đọc chuẩn:** ~2,5 từ/giây

---

## Chuẩn bị trước khi quay

### 1. Tài khoản
- **Tài khoản người bán (demo):** `[CẦN ĐIỀN: email/mật khẩu tài khoản demo]` đã kết nối sẵn Fanpage `[CẦN ĐIỀN: tên Fanpage]`.
- **Tài khoản người mua (2–3 tài khoản Facebook):** dùng trên điện thoại để bình luận thật (hoặc 2–3 tab phòng live dự phòng).
- **Tài khoản ngân hàng VietQR test:** đã cấu hình `VIETQR_BANK_BIN` và `VIETQR_ACCOUNT_NUMBER` trên server.
- **Tài khoản khách từng boom đơn (dữ liệu mẫu):** tạo sẵn 1 lịch sử boom đơn cho một tài khoản người mua để kích hoạt cảnh báo rủi ro.

### 2. Thiết bị
- **1 Laptop:** mở màn hình người bán của Chốt + trình duyệt Chrome có cài Extension (cho phân đoạn 2:00–2:30). Cài sẵn phần mềm quay màn hình (OBS / QuickTime).
- **2 Điện thoại:** đăng nhập sẵn tài khoản người mua, mở sẵn bài đăng/video ghim trên Fanpage (hoặc quét QR vào phòng live).
- **1 Micro thu âm** (thu voice-over riêng hoặc quay trực tiếp ở nơi yên tĩnh).

### 3. Dữ liệu mẫu (theo `apps/server/fixtures/catalog.json`)
- **Danh mục sản phẩm hiển thị:**
  - `V03` — **Váy hoa nhí** (Size `S/M/L`, giá `250.000đ`)
  - `A01` — **Áo thun đen basic** (Size `M/L/XL`, giá `150.000đ`)
  - `V05` — **Váy suông trắng** (Size `S/M/L/XL`, giá `320.000đ`)
- **Chuỗi bình luận mẫu cần gõ khi quay:**
  1. Khen/làm nhiễu: *"xinh quá shop ơi"* (AI bỏ qua)
  2. Chốt đơn: *"chốt váy này size M"* (đang giới thiệu `V03`)
  3. Chốt món trước đó: *"e lấy 2 cái áo đen hồi nãy size L"* (`A01`)
  4. Sửa đơn: *"à đổi sang L nha shop"* (cập nhật `V03` từ `M` → `L`)
  5. Hủy đơn: *"thôi em hủy áo đen nha"* (hủy đơn `A01`)
  6. Hỏi size: *"váy này còn size XL ko shop"* (trả lời từ danh mục: `V03` chỉ có `S/M/L`)

---

## Kịch bản chi tiết

| Mốc thời gian | Hình ảnh trên màn hình | Lời thoại / Voice-over | Ghi chú quay |
|---|---|---|---|
| **0:00–0:20** *(20 giây)* | **Cảnh chia đôi hoặc quay thực tế:** Bên trái là clip/ảnh một buổi live đông người, bình luận cuộn liên tục. Bên phải là người bán vừa cầm áo vừa cúi xuống ghi sổ tay, gạch xóa nhầm lẫn. | Bán hàng livestream một mình rất dễ quá tải. Hàng trăm bình luận trôi qua mỗi phút, lẫn giữa khen, hỏi giá và chốt đơn. Người bán vừa nói vừa ghi tay nên rất dễ sót đơn, nhầm size, rồi sau live lại tốn hàng giờ đối chiếu chuyển khoản. *(48 từ)* | Nhịp nhanh, chữ to hiện dòng: *"Sót đơn • Nhầm size • Đối chiếu thủ công"*. |
| **0:20–0:45** *(25 giây)* | **Màn hình laptop (người bán):** Giao diện Chốt, người bán bấm chọn món đang giới thiệu là `V03 - Váy hoa nhí (250.000đ)`. **Góc dưới phải (PIP điện thoại người mua):** gõ *"xinh quá shop ơi"*, *"chốt váy này size M"*, và tài khoản khác gõ *"e lấy 2 cái áo đen hồi nãy size L"*. | Chốt là trợ lý AI ngồi nghe bình luận thay người bán. Khi shop chọn món đang giới thiệu là Váy hoa nhí, khách chỉ cần bình luận tự nhiên. AI lọc bỏ câu khen, hiểu cả câu "cái áo đen hồi nãy", rồi tạo đơn ngay trên màn hình người bán. *(50 từ)* | Zoom nhẹ vào danh sách đơn trên laptop vừa nhảy ra 2 đơn mới `V03` và `A01`. |
| **0:45–1:10** *(25 giây)* | **Góc PIP điện thoại:** Khách vừa chốt `V03` gõ tiếp *"à đổi sang L nha shop"*; khách kia gõ *"thôi em hủy áo đen nha"*; một khách khác hỏi *"váy này còn size XL ko shop"*. **Màn hình laptop:** Đơn `V03` tự đổi từ `M` sang `L`, đơn `A01` chuyển trạng thái Hủy, hệ thống tự trả lời đúng size từ danh mục. | Khách đổi ý giữa chừng cũng không sao. Khi khách nhắn đổi sang size L hay báo hủy đơn, Chốt tự cập nhật lại đơn hiện có theo thời gian thực. Với câu hỏi về size, hệ thống lấy thông tin trực tiếp từ danh mục hàng, đảm bảo không bịa dữ kiện. *(51 từ)* | Highlight khung thay đổi size `M → L` và nhãn `Hủy` trên màn hình laptop. |
| **1:10–1:30** *(20 giây)* | **Điện thoại người mua:** Hiện bình luận trả lời của Fanpage kèm link đơn hàng; người mua bấm vào link, mở trang đơn có **mã VietQR** đúng số tiền `250.000đ`, bấm **"Đã chuyển"**. **Laptop người bán:** Trạng thái đơn nhảy sang *Chờ đối soát*, người bán bấm xác nhận *Đã thanh toán*. | Ngay khi chốt, khách nhận được link chứa mã VietQR đúng số tiền và nội dung đơn, không cần chờ shop nhắn lại. Khách bấm Đã chuyển, người bán kiểm tra và xác nhận ngay trên một màn hình. *(40 từ)* | Quay rõ thao tác bấm trên điện thoại rồi chuyển focus sang nút xác nhận trên laptop. |
| **1:30–2:00** *(30 giây)* | **Laptop người bán:** Một khách có lịch sử boom đơn bình luận chốt -> thẻ đơn hiện cảnh báo vàng/đỏ *"Khách từng không nhận đơn"*. Tiếp theo, một đơn khác bấm *"Đã chuyển"* khi chưa có giao dịch -> hiện cảnh báo *"Chưa thấy giao dịch khớp mã đơn"*. | Không chỉ ghi đơn, Chốt còn giúp giảm rủi ro khi bán live. Nếu khách từng boom đơn trước đó, hay chốt số lượng lớn bất thường, màn hình lập tức hiện cảnh báo để shop cân nhắc thu tiền trước. Tương tự, khi khách báo đã chuyển khoản nhưng hệ thống chưa ghi nhận, Chốt cũng gắn cờ nhắc đối soát. *(61 từ)* | Zoom cận cảnh 2 thẻ cảnh báo màu vàng/đỏ để người xem đọc rõ nội dung cảnh báo. |
| **2:00–2:30** *(30 giây)* | **Màn hình laptop:** Mở một tab buổi live thật trên Facebook/TikTok bên cạnh cửa sổ Chốt, bật **Chrome Extension Chốt** ở góc trình duyệt. Khi bình luận mới chạy trên khung live thật, Extension tự bắt và đẩy sang bảng đơn của Chốt. | Ngoài kết nối chính thức qua Facebook Graph API, nhóm còn làm thêm Chrome Extension. Khi người bán mở trực tiếp một buổi live trên trình duyệt, Extension đọc bình luận mới theo thời gian thực và gửi thẳng về hệ thống xử lý đơn của Chốt, không cần thao tác copy-paste. *(53 từ)* | Đặt 2 cửa sổ cạnh nhau (trái: live thật, phải: dashboard Chốt) để thấy độ trễ thấp. |
| **2:30–3:00** *(30 giây)* | **Màn hình laptop:** Người bán chuyển sang tab **Tổng kết sau live** (hiển thị doanh thu, số đơn đã thanh toán, đơn chờ/hủy, món bán chạy). **Màn hình kết (2:50–3:00):** Logo Chốt + thông điệp *"Khách gõ, Chốt ghi."* | Kết thúc buổi live, mọi con số về doanh thu, đơn đã trả, đơn treo và món bán chạy đều được tổng hợp sẵn, không còn cảnh thức khuya cộng sổ. Người bán chỉ việc bán, phần ghi đơn và đối soát đã có AI lo. Chốt — Khách gõ, Chốt ghi. *(51 từ)* | Chuyển cảnh mượt sang slide cuối có logo và slogan trong 5 giây cuối. |

---

## Phương án dự phòng (khi Facebook không trả tên người bình luận)

Nếu khi quay hoặc demo thực tế, Facebook Graph API ở chế độ Development không trả về trường `from` (tên người bình luận) hoặc gặp giới hạn token:

1. **Phương án 1 (Khuyên dùng khi quay luồng chính):** Chuyển sang **Phòng live dự phòng của Chốt** (Socket.IO).
   - Mở trang phòng live của Chốt trên 2 điện thoại (quét QR từ màn hình người bán).
   - Người mua nhập tên hiển thị và gõ bình luận trực tiếp trên trang này; mã VietQR sẽ hiện ngay trên điện thoại của họ mà không cần chờ bình luận trả lời từ Facebook.
   - Màn hình người bán, AI pipeline, cảnh báo rủi ro và tổng kết sau live hoạt động giống hệt 100%.
2. **Phương án 2:** Dùng **Chrome Extension** mở trực tiếp trên bài đăng/video live Facebook của nhóm để đọc tên và nội dung bình luận từ DOM đẩy về backend.
