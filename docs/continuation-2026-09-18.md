# Tiếp tục công việc Zcode — 18/09/2026

Phạm vi lượt này: tiếp tục tại điểm dừng trong ảnh, sửa các lỗi còn tìm thấy ở ADS và xác minh source local. Giữ nguyên các thay đổi trước đó của Zcode. Người dùng tự review giao diện; không thực hiện thao tác Meta/CRM thật để thử nghiệm.

## Các file sửa trong lượt tiếp tục

- `lib/ad-status.ts`: bản ghi discovery cũ thiếu accessStatus có thể dùng assetSources để hiển thị quyền truy cập; không ghi đè UNKNOWN/ACCESS_LOST của lần check sau. Nhãn “Truy cập được” không còn suy ra delivery LIVE.
- `app/resource-console-v5.tsx`: dùng resolver quyền truy cập; ưu tiên readSource của lần check trực tiếp thay vì luôn dùng nguồn discovery cũ.
- `lib/crm-gateway.ts`: ACCESSIBLE + delivery UNKNOWN xuất technical_status UNKNOWN, không tự gán LIVE.
- `app/api/resource-health/route.ts`: dùng helper fallback; giảm field đến id,name,account_status rồi id,name khi field/permission lỗi.
- `lib/graph-field-fallback.ts`: helper thử lần lượt field và dừng ngay khi lỗi không được phép retry.
- `app/api/token-runtime/route.ts`: các bucket ADS khi scan thất bại là null thay vì số 0 giả.
- `app/api/business-manager/route.ts`: sửa kiểm tra null trong filter kết quả Meta tạo BM nhưng chưa persist được.
- `tests/ad-status.test.ts`: thêm regression cho quyền truy cập và nhãn legacy.
- `tests/crm-gateway.test.ts`: sửa kỳ vọng sai rằng accessible đồng nghĩa LIVE.
- `tests/graph-field-fallback.test.ts`: kiểm tra lỗi billing, fallback identity và dừng retry.

## Nguyên nhân và hành vi

Luồng import hiện có đã ghi ACCESSIBLE, nhưng dữ liệu được lưu từ trước khi thêm model chưa có field này. UI mặc định tất cả thành UNKNOWN. Resolver mới chỉ dùng nguồn discovery được nhận diện khi thiếu field accessStatus. Đây là bằng chứng từ snapshot, không phải kiểm tra quyền trực tiếp mới tại thời điểm mở trang.

Access và delivery độc lập: TKQC có thể truy cập được mà trạng thái quảng cáo chưa xác định. Không suy ra LIVE từ tên trạng thái truy cập. rawAccountStatus vẫn được giữ bởi model hiện có; adBucket tiếp tục phân loại missing/unknown vào unknown. Tổng dashboard vẫn bao gồm tất cả bucket.

Graph fallback không còn phụ thuộc billing ở mọi lần thử. Nếu Graph không thành công, route hiện có dùng session theo đúng account ID; sửa lần này không gọi Meta thật và không xác nhận độ đầy đủ của HTML/session thực tế.

CSS pagination, bảng và responsive của Zcode được giữ nguyên. Không có visual review mới trong lượt này theo yêu cầu người dùng.

## Xác minh

- npm test: 70/70 pass.
- npm run lint: exit 0, còn 7 warning trong các màn hình legacy (eztool-clone-dashboard, resource-console-v4, workspace).
- npx tsc --noEmit: pass sau khi sửa null guard của business-manager.
- npm run build: pass.
- GET http://localhost:5173/new: HTTP 200.

## Giới hạn xác minh

Không chạy lại toàn bộ audit 58 mục từ đầu và không khẳng định tất cả hành vi BM, security, CRM, Shop do lượt trước sửa đã được kiểm thử tích hợp. Không tạo BM, gửi CRM/Shop, dùng credential để gọi Meta hoặc thay đổi dữ liệu thực trong lượt này. Review các viewport và pagination do người dùng thực hiện. Chỉ HTTP 200 không chứng minh layout đúng.

Không commit, pull, push, checkout, reset hay deploy. Không xóa database, env hoặc credential.
