# Kết nối Meta để tạo Business Manager thật

Ứng dụng chỉ gửi yêu cầu tạo **một Business Manager mỗi lần** qua Meta Graph API chính thức. Không có cơ chế tự retry khi kết quả không chắc chắn và không có chức năng né giới hạn của Meta.

## 1. Chuẩn bị Meta App và quyền

Theo Business Management API của Meta, luồng tạo Business Manager cần:

- một Meta App có quyền truy cập Business Management API phù hợp;
- user access token có quyền `business_management`;
- app-scoped User ID (ứng dụng tự đọc từ `/me`);
- một Facebook Page ID làm `primary_page`;
- người tạo phải quản lý Page dùng làm primary page;
- một business vertical và Meta timezone ID.

Tùy cấu hình app/tài khoản, Meta có thể yêu cầu App Review, Advanced Access hoặc quyền Page bổ sung. Nếu Meta từ chối, ứng dụng sẽ hiển thị nguyên mã lỗi/message từ Graph API để đối chiếu.

Tài liệu Meta: https://developers.facebook.com/docs/marketing-api/business-manager-api/get-started/

## 2. Cấu hình local

Sao chép file `.env.example` thành `.env.local`:

```env
META_ACCESS_TOKEN=YOUR_USER_ACCESS_TOKEN
META_API_VERSION=v26.0
```

Không commit `.env.local` và không gửi access token vào chat.

Sau khi thay đổi biến môi trường, tắt server dev đang chạy rồi chạy lại:

```powershell
npm run dev
```

## 3. Tạo Business Manager

Mở trang **Business Manager** rồi bấm **Tạo tài nguyên** hoặc nút **Tạo BM thật** ở góc dưới.

Nhập:

- tên Business Manager;
- Primary Facebook Page ID;
- múi giờ;
- lĩnh vực business.

Ứng dụng sẽ:

1. kiểm tra token bằng `/me`;
2. lấy app-scoped User ID;
3. gửi `POST /{USER_ID}/businesses` với `name`, `vertical`, `primary_page`, `timezone_id`;
4. nếu Meta trả Business ID, lưu BM vào workspace;
5. không tự gửi lại request nếu timeout hoặc kết quả không chắc chắn.

Nếu request timeout sau khi đã gửi, hãy kiểm tra Meta Business Settings trước khi thử lại để tránh tạo trùng.

## 4. Cơ sở dữ liệu local

App tự tạo bảng `records` và index cần thiết khi khởi động route server. Vì vậy lỗi local `D1_ERROR: no such table: records` sẽ được xử lý mà không cần chạy migration thủ công cho bảng này.
