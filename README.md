# Chốt — Copilot AI chốt đơn livestream cho người bán nhỏ

> **Khách gõ, Chốt ghi.**
>
> Dự thi **MoMo Tech Contest 2026 — Imagine the Future Workspace (Human Centered. AI Powered)**
> Chủ đề: **Trợ lý AI (Trợ lý bán hàng, Trợ lý thanh toán)** + **Chống lừa đảo**

---

## 1. Vấn đề

Bán hàng qua livestream (TikTok, Facebook) là kênh bán chính của rất nhiều người bán nhỏ ở Việt Nam. Nhưng phần lớn họ làm một mình hoặc chỉ có thêm một người phụ, và một buổi live trông như thế này:

- Hàng trăm bình luận trôi qua rất nhanh, lẫn giữa khen, hỏi giá và chốt đơn.
- Khách gõ đủ kiểu: *"chốt 2 áo đen L"*, *"em lấy cái váy hồi nãy"*, *"à đổi sang size M nha shop"*, *"thôi hủy nha"*.
- Người bán vừa phải nói, vừa thử đồ, vừa tự ghi đơn → **sót đơn, ghi nhầm size, nhầm người**.
- Sau live còn phải nhắn từng người để gửi số tài khoản, đối chiếu ai đã chuyển tiền.
- Gặp khách **"boom" đơn** (chốt xong không lấy) hoặc gửi **ảnh chuyển khoản giả**.

Người phụ ghi đơn tốn chi phí, và vẫn sai khi live đông.

## 2. Giải pháp

**Chốt** là trợ lý AI ngồi "nghe" bình luận livestream thay người bán:

1. **Hiểu bình luận theo thời gian thực** — kể cả viết tắt, tiếng lóng, câu sửa và hủy đơn.
2. **Tạo đơn có cấu trúc** — người mua, món, size, số lượng — và khớp với danh mục hàng của shop.
3. **Gửi mã QR thanh toán cho từng người** ngay khi chốt, nhắc người chưa trả.
4. **Cảnh báo rủi ro** — khách có lịch sử boom đơn, chốt bất thường, báo "đã chuyển" nhưng chưa thấy tiền.
5. **Tổng kết sau live** — doanh thu, đơn đã trả, đơn treo, món bán chạy.

Người bán chỉ việc bán. AI ghi đơn; người bán xem lại và duyệt.

## 3. Đối tượng người dùng

- **Chính:** người bán nhỏ, hộ kinh doanh bán qua livestream (thời trang, mỹ phẩm, đồ gia dụng, nông sản).
- **Phụ:** người mua — được nhận QR thanh toán đúng đơn, đúng số tiền, không phải chờ shop nhắn.

## 4. Phù hợp với đề bài

| Yêu cầu đề | Chốt đáp ứng |
|---|---|
| Trợ lý bán hàng — tư vấn, chăm sóc khách và bán hàng | Tự ghi đơn, xử lý sửa/hủy, nhắc thanh toán, tổng kết doanh thu |
| Trợ lý thanh toán — thực hiện và quản lý giao dịch | Tạo QR theo từng đơn, theo dõi trạng thái đã trả / chưa trả |
| Chống lừa đảo | Cảnh báo khách boom đơn, ảnh chuyển khoản không khớp giao dịch |
| Future Workspace | AI đảm nhận vai trò "người phụ ghi đơn" của đội bán hàng |
| Human Centered | AI đề xuất đơn, người bán luôn xem lại và có quyền sửa; mọi quyết định có thể đảo ngược |
| AI là cốt lõi | Bỏ AI thì không thể hiểu bình luận tự nhiên, không có sản phẩm |
| Dùng thử trực tuyến | Giám khảo đóng vai người mua, bình luận từ điện thoại của chính mình |

## 5. Cách hoạt động

### 5.1. Lấy bình luận

| Nguồn | Cách làm | Vai trò trong bản thi |
|---|---|---|
| **Facebook Graph API** | Người bán kết nối Fanpage qua Facebook Login; backend lấy bình luận của live video (hoặc bài đăng/video đã ghim) qua API chính thức | **Luồng chính.** App để ở chế độ Development, chạy trên Fanpage của nhóm, chưa cần App Review |
| **Phòng live của Chốt** | Người mua bình luận trên trang của Chốt; dữ liệu đi thẳng vào backend qua Socket.IO | **Dự phòng**, dùng khi Facebook lỗi hoặc không trả về tên người bình luận |
| **Extension đọc live thật** | Người bán mở trang live (TikTok / Facebook) trên Chrome; extension theo dõi khung bình luận bằng `MutationObserver` và gửi bình luận mới về backend | Làm thêm nếu kịp, chủ yếu để quay video với TikTok |

> **Cần kiểm tra ngay từ đầu:** khi người bình luận (giám khảo) không có vai trò trong app, Graph API có trả về tên người bình luận (trường `from`) không. Cũng cần kiểm tra việc đọc bình luận trên bài đăng/video đã ghim khi không có buổi live nào đang phát.

> Không dùng thư viện không chính thức giải mã kết nối live của TikTok vì có thể vi phạm điều khoản và dễ hỏng.

### 5.2. Xử lý bình luận bằng AI

```
Bình luận mới
   │
   ▼
[1] Lọc nhanh — có ý định đặt hàng không?
    (từ khóa: chốt, lấy, size, hủy, đổi… + phân loại nhẹ)
    "đẹp quá shop ơi" → bỏ qua
   │
   ▼
[2] Gom lô 1–2 giây
   │
   ▼
[3] LLM + ngữ cảnh:
    - danh mục hàng (mã, tên, size, giá, tồn kho)
    - món đang được giới thiệu
    - đơn hiện có của từng người mua
   │
   ▼
[4] JSON hành động: create / update / cancel / ask
   │
   ▼
[5] Kiểm tra quy tắc (tồn kho, size hợp lệ) → cập nhật đơn → tạo QR
```

**Ví dụ đầu vào**

```
[20:15] Đang giới thiệu: Váy hoa V03 (S/M/L, 250.000đ)
lan.nguyen: chốt váy này size M
minh_t: e lấy 2 cái áo đen hồi nãy size L
lan.nguyen: à đổi sang L nha shop
hoa.tran: váy này còn size XL ko shop
```

**Đầu ra**

```json
[
  {"action": "create", "buyer": "lan.nguyen", "item": "V03", "size": "M", "qty": 1},
  {"action": "create", "buyer": "minh_t", "item": "A01", "size": "L", "qty": 2},
  {"action": "update", "buyer": "lan.nguyen", "item": "V03", "size": "L"},
  {"action": "ask", "buyer": "hoa.tran", "reply": "V03 chỉ có size S/M/L ạ"}
]
```

Hai ngữ cảnh **"món đang giới thiệu"** và **"đơn hiện có của người mua"** là chìa khóa để AI hiểu những câu như *"cái hồi nãy"*, *"đổi sang L"*, *"thêm 1 cái nữa"*.

### 5.3. Thanh toán

- Mỗi đơn được tạo **mã QR chuyển khoản** đúng số tiền, nội dung chứa mã đơn. Backend tự sinh chuỗi VietQR (EMVCo) và tự vẽ ảnh QR, không phụ thuộc dịch vụ ngoài.
- **Người mua trên Facebook:** Fanpage tự trả lời bình luận, ví dụ *"Đơn #A12 đã ghi, thanh toán tại: <link>"*. Link mở trang đơn hàng có QR.
- **Người mua trong phòng live dự phòng:** QR hiện ngay trên trang của họ.
- Trạng thái đơn: *Chờ thanh toán → Chờ đối soát → Đã thanh toán → Đã giao / Hủy*.
- Bản thi giả lập xác nhận thanh toán: người mua bấm "Đã chuyển", đơn sang *Chờ đối soát*, người bán bấm xác nhận. Bản thật sẽ tích hợp cổng thanh toán (dùng sandbox nếu có).

### 5.4. Cảnh báo rủi ro

| Tín hiệu | Cảnh báo |
|---|---|
| Người mua có đơn bị boom trước đó | "Khách từng không nhận 2 đơn — nên thu tiền trước" |
| Chốt số lượng lớn bất thường | "Chốt 10 món trong 1 phút — cần xác nhận lại" |
| Báo "đã chuyển" nhưng hệ thống chưa ghi nhận | "Chưa thấy giao dịch khớp mã đơn" |
| Chốt món đã hết hàng | Tự trả lời khách, gợi ý món tương tự |

## 6. Trải nghiệm dùng thử cho Ban giám khảo

1. Đăng nhập **màn hình người bán** (laptop) bằng **tài khoản demo** ghi trong hướng dẫn. Fanpage của nhóm đã được kết nối sẵn.
2. Dùng tài khoản Facebook của mình **bình luận vào bài đăng/video đã ghim** trên Fanpage của nhóm, theo bất kỳ cách nào, kể cả cố tình viết khó hiểu, sửa hay hủy.
3. Đơn hiện ngay trên màn hình người bán. Fanpage **trả lời bình luận kèm link thanh toán**, mở link sẽ thấy QR.
4. Bấm "Đã chuyển", rồi xác nhận ở màn hình người bán, để xem trạng thái đơn cập nhật và bảng tổng kết.

**Dự phòng:** nếu không muốn dùng Facebook, giám khảo quét QR để vào **phòng live của Chốt** và bình luận như trên. Không cần cài đặt gì.

## 7. Kiến trúc

```
┌────────────────────┐ Graph API (đọc bình luận, trả lời kèm link đơn)
│ Fanpage Facebook   │<────────────────────┐
└────────────────────┘                     │
┌────────────────────┐      ┌──────────────┴─────────────┐      ┌──────────┐
│ Phòng live (mobile)│─WS──>│                            │      │          │
└────────────────────┘      │          Backend           │─────>│ LLM API  │
┌────────────────────┐      │ - Nhận & lọc bình luận     │<─────│          │
│ Extension đọc live │─WS──>│ - Gom lô, gọi LLM          │      └──────────┘
│ thật (TikTok / FB) │      │ - Quản lý đơn, tồn kho     │
└────────────────────┘      │ - Tạo QR, cảnh báo rủi ro  │
┌────────────────────┐      │                            │      ┌──────────┐
│ Màn hình người bán │<─WS──│                            │<────>│ Database │
└────────────────────┘      └────────────────────────────┘      └──────────┘
```

## 8. Công nghệ dự kiến

| Thành phần | Công nghệ |
|---|---|
| Ngôn ngữ | TypeScript (toàn bộ) |
| Cấu trúc repo | Monorepo, pnpm workspaces |
| Frontend (người bán + phòng live) | Next.js, Tailwind + shadcn/ui |
| Đăng nhập người bán | Email/mật khẩu; nút "Kết nối Fanpage" qua Facebook Login |
| Nguồn bình luận | Facebook Graph API (chính), phòng live Socket.IO (dự phòng) |
| Realtime | Socket.IO (mỗi phiên test một room riêng) |
| Backend | Node.js + Express |
| Database | PostgreSQL trên Railway, truy cập qua Prisma |
| Lọc nhanh bình luận | Từ khóa + regex, nghiêng về cho qua (để lọt còn hơn sót đơn) |
| AI | **Gemini 3.5 Flash-Lite** (đúng 49/50 bình luận mẫu, trễ p50 ~1,2–1,8 giây), dự phòng Gemini 3.5 Flash. Tự giới hạn số request/phút và tự chuyển model khi gặp lỗi 429/503 |
| Extension | Chrome Manifest V3, `MutationObserver` |
| QR thanh toán | Chuẩn VietQR (EMVCo), backend tự sinh chuỗi và ảnh QR |
| Hosting | Vercel (frontend) + Railway (backend + database) |

**Cấu trúc thư mục**

```
apps/
  web/         # Next.js: màn hình người bán + phòng live
  server/      # Express + Socket.IO + Prisma + pipeline AI
  extension/   # Chrome extension đọc bình luận live thật
packages/
  shared/      # Kiểu dữ liệu, JSON schema hành động AI, tên sự kiện Socket.IO
```

## 9. Phạm vi MVP

**Bắt buộc có**
- Đăng nhập người bán, kết nối Fanpage, đọc bình luận qua Graph API
- Fanpage tự trả lời bình luận kèm link đơn có QR
- Phòng live dự phòng + màn hình người bán, realtime
- Quản lý danh mục hàng mẫu, chọn "món đang giới thiệu"
- AI tách đơn: tạo / sửa / hủy / trả lời câu hỏi
- Bảng đơn hàng, người bán sửa và duyệt được
- QR thanh toán theo từng đơn, trạng thái thanh toán
- Tổng kết sau live

**Làm thêm nếu kịp**
- Extension đọc bình luận live thật trên TikTok / Facebook
- Cảnh báo rủi ro (boom đơn, chốt bất thường, chưa thấy tiền)
- Nhắc thanh toán tự động

**Ngoài phạm vi**
- Meta App Review (công khai app cho mọi Fanpage), nhắn riêng qua Messenger
- Tích hợp vận chuyển

## 10. Kịch bản video (≤ 3 phút)

| Thời gian | Nội dung |
|---|---|
| 0:00–0:20 | Vấn đề: cảnh live đông, bình luận trôi, người bán ghi tay sót đơn |
| 0:20–1:30 | Demo: nhiều người bình luận cùng lúc, có sửa và hủy → đơn tự hiện, QR về điện thoại người mua |
| 1:30–2:00 | Cảnh báo: khách từng boom đơn, báo "đã chuyển" nhưng chưa thấy tiền |
| 2:00–2:30 | Extension đọc bình luận trên một buổi live thật |
| 2:30–3:00 | Tổng kết sau live + thông điệp: *"Khách gõ, Chốt ghi."* |

## 11. Kế hoạch triển khai

| Ngày | Việc |
|---|---|
| 27/11 | **Thử Graph API:** tạo app Facebook, đọc bình luận Fanpage bằng tài khoản không có vai trò trong app, kiểm tra trường `from`. Thử Gemini Flash và GPT mini. Dựng khung monorepo + `packages/shared`. |
| 28/11 | Prompt tách đơn + JSON schema + bộ ~50 bình luận test (có sửa, hủy, câu mơ hồ). |
| 29/11 | Quản lý đơn, tồn kho, màn hình người bán duyệt / sửa đơn. |
| 30/11 | QR thanh toán, trạng thái đơn, tổng kết sau live. |
| 01/12 | Cảnh báo rủi ro, extension live thật, deploy. |
| 02/12 | Test toàn luồng với nhiều người cùng lúc, sửa lỗi, tinh chỉnh prompt. |
| 03/12 | Slide (≤ 10 trang), video (≤ 3 phút), hướng dẫn 1 trang A4. **Nộp bài.** |

*Hạn nộp cần xác nhận lại với thể lệ chính thức của ban tổ chức.*

## 12. Rủi ro và cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| AI hiểu sai bình luận | Người bán luôn duyệt / sửa được; với câu mơ hồ AI trả `ask` thay vì đoán |
| Độ trễ khi live đông | Lọc nhanh trước khi gọi LLM, gom lô 1–2 giây, dùng model nhỏ |
| Chi phí gọi LLM | Chỉ gửi bình luận có ý định đặt hàng; ngữ cảnh gọn |
| Quota gói miễn phí Gemini (15 request/phút, Flash chỉ 20 request/ngày) | Lô tự lớn lên khi đông; xoay vòng nhiều model; **bật billing trước khi giám khảo test** |
| AI bịa dữ kiện khi trả lời khách (ví dụ sai size) | Câu trả lời về size / mã món do hệ thống viết từ danh mục, không dùng câu LLM viết |
| Graph API không trả tên người bình luận, hoặc token hết hạn | Kiểm tra ngay ngày đầu; dùng Page token dài hạn; giữ phòng live dự phòng cho giám khảo |
| Không có buổi live nào đang phát khi giám khảo test | Đọc bình luận trên bài đăng/video đã ghim, không chỉ trên live đang phát |
| Extension hỏng khi nền tảng đổi giao diện | Extension chỉ là phần làm thêm, không nằm trong luồng chính |
| Nhiều giám khảo test cùng lúc | Mỗi phiên test có mã phòng riêng, dữ liệu tách biệt |
| Dữ liệu người mua | Chỉ lưu tên hiển thị và đơn hàng; không thu thập thông tin cá nhân khác |

## 13. Cài đặt và chạy

Yêu cầu: Node 24 (`.nvmrc`), pnpm (`corepack enable pnpm`). Chạy các lệnh ở gốc repo.

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local

# Thử phòng DEMO ngay, không cần PostgreSQL hay khóa LLM.
DATABASE_URL= LLM_PROVIDER=fake pnpm dev:server

# Mở terminal khác để chạy web tại http://localhost:3000.
pnpm dev:web

# Kiểm tra
pnpm test                                               # test toàn workspace
pnpm typecheck
pnpm build:web
pnpm --filter @livemate/server exec tsx scripts/smoke.ts  # chạy thử toàn luồng với server đang chạy
pnpm --filter @livemate/server eval                     # so sánh LLM trên 50 bình luận mẫu

# Thử Graph API: Facebook có trả tên người bình luận không?
pnpm --filter @livemate/server exec tsx scripts/fb-spike.ts <post-or-live-video-id>
pnpm --filter @livemate/server exec tsx scripts/fb-spike.ts --live <page-id>
```

Với PostgreSQL, đặt `DATABASE_URL` trong `apps/server/.env`, chạy `pnpm --filter @livemate/server db:migrate` rồi khởi động backend. Backend tự tạo tài khoản và phòng `DEMO` khi cần. Chế độ local dùng được `demo@livemate.vn` và mật khẩu mẫu `livemate-demo` nếu chưa ghi đè qua biến môi trường. Xem cấu hình Railway và Vercel trong [hướng dẫn triển khai](docs/deploy.md).

Mở [bản bàn giao HTML](docs/livemate-implementation-review.html) trong trình duyệt để xem luồng demo, mã liên quan và kết quả nghiệm thu theo từng issue.

API dev của server: `GET /health`, `GET /api/dev/state`, `POST /api/dev/featured {code}`,
`POST /api/dev/facebook/watch {objectId}`, `GET /api/orders/:token/qr.png`.

## 14. Tài sản có sẵn, thư viện và công cụ AI đã dùng

*(Bắt buộc khai báo theo thể lệ — cập nhật khi thêm thư viện/công cụ.)*

| Loại | Tên | Mục đích |
|---|---|---|
| Thư viện mã nguồn mở | `dotenv` (BSD-2-Clause) | Đọc biến môi trường từ file `.env` cho backend |
| Thư viện mã nguồn mở | `express` (MIT) | HTTP server và REST API cho `@livemate/server` |
| Thư viện mã nguồn mở | `openai` (Apache-2.0) | SDK gọi LLM qua endpoint tương thích OpenAI (Gemini, OpenAI) |
| Thư viện mã nguồn mở | `qrcode` (MIT) | Tạo ảnh mã QR thanh toán VietQR phía backend |
| Thư viện mã nguồn mở | Next.js, React, Tailwind CSS và Radix UI (MIT) | Giao diện người bán, phòng live và trang đơn hàng |
| Thư viện mã nguồn mở | Prisma (Apache-2.0), bcrypt.js (MIT) | Lưu dữ liệu PostgreSQL và băm mật khẩu người bán |
| Thư viện mã nguồn mở | qrcode.react (ISC), Lucide (ISC) | QR dẫn vào phòng live và biểu tượng giao diện |
| Thư viện mã nguồn mở | `socket.io` (MIT) | Giao tiếp thời gian thực giữa server, màn hình người bán và phòng live |
| Thư viện mã nguồn mở | `zod` (MIT) | Định nghĩa và kiểm tra schema dữ liệu dùng chung (`@livemate/shared`, `@livemate/server`) |
| Thư viện mã nguồn mở | `TypeScript` (Apache-2.0) | Kiểm tra kiểu tĩnh cho `@livemate/server` và `@livemate/shared` |
| Thư viện mã nguồn mở | `tsx` (MIT) | Chạy trực tiếp mã TypeScript cho dev server, smoke test và eval |
| Thư viện mã nguồn mở | `Vitest` (MIT) | Chạy unit test cho server, shared và extension |
| Thư viện mã nguồn mở | `jsdom` (MIT) | Giả lập DOM để kiểm thử Chrome extension đọc bình luận |
| Thư viện mã nguồn mở | `pnpm` (MIT) | Quản lý gói và monorepo workspace |
| Dịch vụ / API | Google Gemini API | Phân tích bình luận và trích xuất đơn hàng (`gemini-3.5-flash-lite` chính, `gemini-3.5-flash` dự phòng, qua endpoint tương thích OpenAI) |
| Dịch vụ / API | Facebook Graph API | Đọc bình luận Fanpage, trả lời bình luận kèm link đơn và xác thực Facebook Login |
| Dịch vụ / API | Chuẩn VietQR / NAPAS 247 (EMVCo) | Sinh chuỗi QR chuyển khoản theo từng đơn — tự cài đặt ở backend, không dùng dịch vụ ngoài |
| Dịch vụ / API | Railway | Hosting backend và PostgreSQL (dự kiến) |
| Dịch vụ / API | Vercel | Hosting frontend (dự kiến) |
| Dịch vụ / API | GitHub | Lưu trữ mã nguồn và phối hợp nhóm |
| Công cụ AI hỗ trợ phát triển | Claude Code (Anthropic, Claude Opus 5.5) | Thiết kế kiến trúc, pipeline AI và review code |
| Công cụ AI hỗ trợ phát triển | OpenAI Codex CLI (`gpt-6.2-sol`) | Phát triển VietQR, Facebook, cảnh báo rủi ro và extension. Điều phối, tích hợp và nghiệm thu thay đổi #1–#8. |
| Công cụ AI hỗ trợ phát triển | Google Antigravity CLI `agy` (Gemini 4 Hydrogen) | Scaffold monorepo, tạo dữ liệu test và triển khai backend, web cho #1–#8. |
| Tài sản có sẵn | Danh mục hàng mẫu (`apps/server/fixtures/catalog.json`) | Dữ liệu sản phẩm mẫu phục vụ demo và kiểm thử — tự tạo, dữ liệu giả |
| Tài sản có sẵn | Bộ 50 bình luận test (`apps/server/fixtures/eval-cases.json`) | Bộ dữ liệu đánh giá độ chính xác AI — sinh bằng AI, nhóm đã rà soát |

## 15. Thành viên

| Họ tên | Vai trò |
|---|---|
| Nhật | Frontend (màn hình người bán, phòng live) + backend phần phòng/phiên live và API đơn hàng |
| Nghĩa | Backend phần pipeline bình luận (lọc, gom lô, gọi LLM, kiểm tra quy tắc), AI/prompt, QR thanh toán, cảnh báo rủi ro, extension |

Ranh giới giữa hai người là `packages/shared`. Kiểu dữ liệu và sự kiện Socket.IO được thống nhất ở đó trước, sau đó mỗi người làm phần của mình song song.
