# Triển khai backend LiveMate trên Railway

## Tạo dịch vụ

1. Trong Railway, chọn **New Project → Deploy from GitHub repo**, rồi chọn repo LiveMate và nhánh cần triển khai.
2. Trong **Settings** của dịch vụ backend, đặt **Root Directory** là `/` (gốc repo). Railway tự phát hiện `Dockerfile` ở đó và dùng lệnh khởi động trong image. Kiểm tra build log để xác nhận Railway đã chọn Dockerfile. [Tài liệu Dockerfile của Railway](https://docs.railway.com/builds/dockerfiles)
3. Trong **Settings** của dịch vụ mới, đặt **Healthcheck Path** là `/health`, thời gian chờ là `60` giây và **Restart Policy** là **On Failure** với tối đa `5` lần thử lại. Railway chỉ đọc `railway.json` trên các dịch vụ đã bật Config as Code trước đây, đến ngày 01/12/2026. [Tài liệu Config as Code của Railway](https://docs.railway.com/config-as-code)
4. Mở tab **Variables** của dịch vụ và thêm các biến bên dưới bằng **New Variable**. Nhập khóa API, token và các giá trị bí mật trực tiếp tại đây. Chọn **Deploy** để áp dụng thay đổi. [Tài liệu biến môi trường của Railway](https://docs.railway.com/variables)
5. Sau khi deploy, vào **Settings → Networking → Public Networking → Generate Domain** để lấy URL HTTPS của backend. Railway cấp `PORT` cho ứng dụng và dùng cổng đó để kiểm tra `/health`. [Tài liệu health check của Railway](https://docs.railway.com/deployments/healthchecks)

## Biến môi trường

| Biến | Bắt buộc ở production | Cách đặt |
| --- | --- | --- |
| `PORT` | Railway cấp tự động | Cổng HTTP. Mặc định `4000` khi biến chưa được đặt. |
| `WEB_ORIGIN` | Có, cho Socket.IO trên web | Origin HTTPS của frontend Vercel, ví dụ `https://livemate.vercel.app`, bỏ dấu `/` cuối. |
| `PUBLIC_WEB_URL` | Có, cho liên kết đơn hàng | URL HTTPS công khai của frontend Vercel, bỏ dấu `/` cuối. Backend dùng URL này để tạo liên kết `/o/…`. |
| `LLM_PROVIDER` | Tùy chọn | `gemini` hoặc `openai` để ưu tiên nhà cung cấp tương ứng. `fake` dùng regex cho môi trường thử nghiệm. |
| `GEMINI_API_KEY` | Có nếu dùng Gemini | Khóa API Gemini. Đặt cùng `GEMINI_MODEL`. |
| `GEMINI_MODEL` | Có nếu dùng Gemini | Một hoặc nhiều model, phân cách bằng dấu phẩy. Model đầu được ưu tiên. |
| `GEMINI_RPM` | Tùy chọn | Giới hạn số yêu cầu mỗi phút cho từng model Gemini. Mặc định `15`. |
| `OPENAI_API_KEY` | Có nếu dùng OpenAI | Khóa API OpenAI. Đặt cùng `OPENAI_MODEL`. |
| `OPENAI_MODEL` | Có nếu dùng OpenAI | Một hoặc nhiều model, phân cách bằng dấu phẩy. Model đầu được ưu tiên. |
| `OPENAI_RPM` | Tùy chọn | Giới hạn số yêu cầu mỗi phút cho từng model OpenAI. Mặc định `0` để bỏ giới hạn trong ứng dụng. |
| `VIETQR_BANK_BIN` | Có nếu bật VietQR | Mã BIN ngân hàng. Đặt cùng `VIETQR_ACCOUNT_NUMBER`. |
| `VIETQR_ACCOUNT_NUMBER` | Có nếu bật VietQR | Số tài khoản nhận tiền. Giữ các chữ số `0` ở đầu nếu có. |
| `INGEST_KEY` | Có | Khóa bảo vệ `POST /api/ingest`. Extension phải gửi cùng giá trị trong header `X-Ingest-Key`. |
| `FB_GRAPH_VERSION` | Có nếu bật Facebook | Phiên bản Facebook Graph API mà ứng dụng Meta đang dùng. |
| `FB_PAGE_TOKEN` | Tùy chọn | Page access token cho luồng theo dõi Facebook ở môi trường thử nghiệm. |
| `FB_APP_ID` | Có nếu cấu hình Facebook OAuth | App ID của ứng dụng Meta. Đặt cùng `FB_APP_SECRET` và `FB_REDIRECT_URI`. |
| `FB_APP_SECRET` | Có nếu cấu hình Facebook OAuth | App secret của ứng dụng Meta. |
| `FB_REDIRECT_URI` | Có nếu cấu hình Facebook OAuth | URL HTTPS của backend với đường dẫn `/api/facebook/callback`. Đăng ký đúng URL này trong ứng dụng Meta. |
| `PIPELINE_BATCH_WINDOW_MS` | Tùy chọn | Cửa sổ gom bình luận trước khi gọi LLM. Mặc định `1500`. |
| `PIPELINE_MAX_BATCH` | Tùy chọn | Số bình luận tối đa mỗi lần gọi LLM. Mặc định `40`. |
| `DEV_ROUTES` | Để trống ở production | Route `/api/dev/*` mặc định tắt khi `NODE_ENV=production`. Giá trị `1` bật lại các route này. |
| `NODE_ENV` | `production` do Dockerfile đặt | Giữ giá trị này trong production. |

Backend cần ít nhất một cặp khóa API và model của Gemini hoặc OpenAI để khởi động với LLM thật. Khi dùng Gemini, hãy bật thanh toán cho dự án của khóa API trước khi ban giám khảo chạy thử. LiveMate mặc định dùng `15` yêu cầu/phút cho mỗi model Gemini khi chuẩn bị cấu hình free tier. Kiểm tra hạn mức theo từng model và dự án trong AI Studio rồi đặt `GEMINI_RPM` theo hạn mức thực tế. [Hạn mức Gemini API](https://ai.google.dev/gemini-api/docs/rate-limits)

Đơn hàng hiện được lưu trong bộ nhớ cho đến khi gateway Prisma ở issue #4 và #5 được tích hợp. Mỗi lần khởi động lại hoặc deploy lại sẽ làm mất các đơn hiện có.

## Kiểm tra sau khi deploy

- [ ] Gọi `/health` trên URL production. Kết quả phải là HTTP `200` với `ok: true`.

  ```sh
  curl -fsS 'https://<backend-production>/health'
  ```

- [ ] Kiểm tra frontend Vercel kết nối được qua Socket.IO với `WEB_ORIGIN` đã đặt và xác nhận `/api/dev/state` trả HTTP `404` trên production.
- [ ] Trên dịch vụ staging riêng, tạm đặt `DEV_ROUTES=1` và deploy lại để chạy smoke test. Từ gốc repo trên máy đã cài dependencies, chạy lệnh bên dưới với URL staging. Kiểm tra sự kiện đơn hàng và phản hồi QR nếu staging có cấu hình VietQR.

  ```sh
  pnpm --filter @livemate/server exec tsx scripts/smoke.ts 'https://<backend-staging>'
  ```

- [ ] Xóa `DEV_ROUTES` khỏi staging ngay sau khi chạy xong, deploy lại và xác nhận `/api/dev/state` trả HTTP `404`.

## Kết quả load test (27/11/2026)

`scripts/load.ts`: 30 người mua, khoảng 120 bình luận/phút trong 60 giây, khoảng 25% là câu khen/chào.

| Cấu hình | Xử lý xong | `unparsed` | Sai lệch dữ liệu | Trễ p50 | Trễ p95 |
|---|---|---|---|---|---|
| `LLM_PROVIDER=fake` | 92/92 | 0 | 0 | 1,0 giây | 1,5 giây |
| Gemini gói miễn phí (15 request/phút) | 133/133 | 0 | 0 | ~7,7 giây | ~17 giây |

- Ở gói miễn phí, độ trễ bị giới hạn bởi quota, không phải bởi code: mỗi 4 giây chỉ được gọi LLM một lần, nên bình luận phải chờ gom lô (trung bình ~10, tối đa ~27 bình luận/lô). Khi quota chưa chạm trần (đầu mỗi lần test), trễ chỉ khoảng 2–3 giây.
- `gemini-3.5-flash` thường trả 503 (quá tải) và chỉ có 20 request/ngày ở gói miễn phí. Hệ thống tự cho model này nghỉ lâu dần (30 giây, 60 giây, 120 giây… tối đa 10 phút).
- **Trước khi giám khảo test: bật billing**, rồi tăng `GEMINI_RPM` theo hạn mức mới.

Chạy lại: `pnpm --filter @livemate/server exec tsx scripts/load.ts --url <server> --buyers 30 --duration 60 --rate 120` (server cần bật `DEV_ROUTES=1`).

