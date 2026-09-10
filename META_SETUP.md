# Kết nối Meta và quản lý token nguồn

Ứng dụng chỉ gửi yêu cầu tạo **một Business Manager mỗi lần** qua Meta Graph API chính thức. Token nguồn được người dùng chọn thủ công. Ứng dụng không tự retry khi kết quả không chắc chắn và không tự chuyển sang token khác để vượt giới hạn của Meta.

## 1. Chuẩn bị Meta App và quyền

Luồng tạo Business Manager cần user access token và các quyền/điều kiện mà Meta yêu cầu cho tài khoản, app và Page liên quan. App đọc app-scoped User ID từ `/me`, sau đó gửi yêu cầu tạo bằng token nguồn đã chọn.

Theo Business Management API, thao tác tạo Business Manager bằng `POST /{USER_ID}/businesses` yêu cầu một `primary_page`. Vì vậy app không thể bỏ hoàn toàn Page khỏi request. Giao diện sẽ thử đọc các Page mà token quản lý từ `/me/accounts` và cho chọn bằng tên; để tự liệt kê Page, token cần quyền `pages_show_list`. Nếu không đọc được danh sách, có thể nhập Page ID thủ công.

Nếu Meta từ chối, ứng dụng lưu mã lỗi/message để đối chiếu và phân loại trạng thái token như: hoạt động, hết hạn/không hợp lệ, thiếu quyền, rate limit, bị giới hạn tạo BM hoặc cần kiểm tra.

Lưu ý: trạng thái **Bị giới hạn tạo BM** không đồng nghĩa token đã chết. Token vẫn được giữ trong kho để bạn có thể kiểm tra lại hoặc dùng cho tác vụ hợp lệ khác sau này.

## 2. Cấu hình local

Sao chép `.env.example` thành `.env.local` và tạo khóa mã hóa riêng:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Dán kết quả vào:

```env
TOKEN_ENCRYPTION_KEY=YOUR_LONG_RANDOM_SECRET
META_API_VERSION=v26.0
```

`META_ACCESS_TOKEN` vẫn là biến tùy chọn cho chức năng đồng bộ Meta cũ của toàn workspace. Luồng **Tạo BM thật** dùng token trong mục **Quản lý token**, không lấy token nguồn từ trình duyệt sau khi đã lưu.

Không commit `.env.local`, không commit token và không gửi token vào chat. Nếu thay `TOKEN_ENCRYPTION_KEY` sau khi đã lưu token, các token cũ sẽ không giải mã được; khi đó cần xóa/nạp lại token bằng khóa mới.

Sau khi thay đổi biến môi trường, tắt server dev rồi chạy lại:

```powershell
npm run dev
```

## 3. Quản lý token

Mở mục **Quản lý token** trong menu bên trái của Ads Workspace. Tại đây bạn có thể:

- đặt tên gợi nhớ cho token;
- dán token để Meta kiểm tra `/me` trước khi lưu;
- xem user Meta mà token đại diện;
- xem fingerprint không nhạy cảm thay vì giá trị token;
- kiểm tra lại trạng thái token theo yêu cầu;
- xem lỗi gần nhất và kết quả lần tạo BM gần nhất;
- xóa token khỏi kho.

Token được mã hóa AES-GCM trước khi lưu vào D1. API danh sách token không trả ciphertext hoặc access token về client.

## 4. Tạo Business Manager và mời quản trị viên

Mở trang **Business Manager**, bấm **Tạo tài nguyên** hoặc **Tạo BM thật**. Trong form sẽ có:

- Token nguồn;
- tên Business Manager;
- Page đại diện (app ưu tiên tự đọc từ token);
- email quản trị viên tùy chọn;
- múi giờ;
- lĩnh vực business.

Ứng dụng sẽ:

1. giải mã đúng token đã chọn ở server;
2. kiểm tra token bằng `/me`;
3. lấy app-scoped User ID;
4. gửi một yêu cầu tạo Business Manager;
5. đọc lại thông tin BM gồm ID, tên, trạng thái xác minh, thời gian tạo, Page đại diện, timezone và người tạo;
6. nếu có email quản trị viên, gửi `POST /{BUSINESS_ID}/business_users` với vai trò `ADMIN`;
7. lưu BM và thông tin lời mời vào workspace;
8. cập nhật trạng thái token theo phản hồi Meta;
9. không tự đổi token và không tự retry nếu kết quả không chắc chắn.

Meta không cung cấp luồng chính thức để thêm một tài khoản Facebook cá nhân bất kỳ vào Business Manager chỉ bằng Facebook User ID. Luồng quản lý người dùng chính thức là gửi lời mời tới email; người nhận phải chấp nhận lời mời trước khi trở thành thành viên hoạt động. Vì vậy app dùng email thay cho chức năng “share trực tiếp tới FB ID”.

Nếu Business Manager đã tạo thành công nhưng lời mời admin thất bại, app vẫn lưu BM và hiển thị riêng lỗi lời mời. App không gửi lại request tạo BM.

Nếu request tạo BM timeout sau khi đã gửi, hãy kiểm tra Meta Business Settings trước khi thử lại để tránh tạo trùng.

## 5. Cơ sở dữ liệu local

App tự tạo bảng `records` và index cần thiết khi route server được dùng. Vì vậy lỗi local `D1_ERROR: no such table: records` được xử lý mà không cần chạy migration thủ công cho bảng này.
