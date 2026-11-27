# LiveMate – đọc bình luận live

Tiện ích Chrome gửi bình luận từ TikTok Live và Facebook Live về phòng LiveMate của bạn.

## Cài đặt

1. Mở `chrome://extensions` trong Chrome và bật **Chế độ dành cho nhà phát triển**.
2. Chọn **Tải tiện ích đã giải nén (Load unpacked)** rồi chọn thư mục `apps/extension`.
3. Mở LiveMate từ biểu tượng Tiện ích trên thanh công cụ. Nếu đã mở trang live trước khi cài, hãy tải lại trang đó.

## Cấu hình và sử dụng

1. Nhập **Địa chỉ máy chủ** và **Mã phòng**. Mặc định là `http://localhost:4000` và `DEMO`. Nhập **Khóa nhận bình luận** nếu máy chủ yêu cầu.
2. Chọn **Lưu cài đặt** và cấp quyền truy cập khi Chrome hỏi. Máy chủ từ xa cần dùng HTTPS. Chọn **Kiểm tra kết nối** để kiểm tra máy chủ qua `/health`.
3. Mở TikTok Live hoặc Facebook Live, rồi bật **Đang đọc**. Bình luận mới từ các tab live đang mở được gửi về mã phòng đã đặt.
4. Xem số bình luận đã gửi, được tiếp nhận và bị trùng trong popup. Số trên biểu tượng là tổng số bình luận được máy chủ tiếp nhận trong phiên. Tắt **Đang đọc** khi kết thúc live.

## Khi bình luận không xuất hiện

- Kiểm tra mã phòng, khóa nhận bình luận và kết quả **Kiểm tra kết nối**. Nếu vừa cài hoặc tải lại tiện ích, hãy tải lại tab live.
- Bộ chọn CSS mặc định chỉ là phỏng đoán chưa được xác minh. TikTok và Facebook có thể thay đổi giao diện bất kỳ lúc nào.
- Mở tab live có vài bình luận, chọn **Chọn khung bình luận** trong popup rồi bấm vào nội dung của một dòng bình luận trên trang. Tiện ích sẽ đánh dấu vị trí bấm và lưu bộ chọn dòng cho nền tảng đó. Nhấn **Esc** để hủy.
- Nếu bộ chọn dòng đã đúng nhưng tên hoặc nội dung vẫn thiếu, mở **Bộ chọn bình luận nâng cao**, chọn nền tảng rồi sửa bộ chọn tương ứng. Xóa nội dung của ô và lưu để khôi phục bộ chọn mặc định.

## Quyền riêng tư

Tiện ích chỉ gửi tên hiển thị và nội dung của từng bình luận, cùng mã phòng và nền tảng cần để chuyển bình luận đến đúng nơi. Tiện ích chỉ đọc và gửi bình luận khi bật **Đang đọc**.

## Kiểm thử

Chạy `pnpm --filter @livemate/extension test` từ thư mục gốc của dự án.
