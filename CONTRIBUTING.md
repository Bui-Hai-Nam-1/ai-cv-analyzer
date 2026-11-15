# Quy trình làm việc nhóm

1. Clone repository và tạo branch: `feature/cv-service`, `feature/jd-service`, ...
2. Chỉ sửa service mình phụ trách, trừ khi đã trao đổi với nhóm.
3. Chạy thử service hoặc toàn hệ thống trước khi push.
4. Commit có nội dung rõ ràng, ví dụ `feat(cv): add CV validation`.
5. Push branch và tạo Pull Request vào `main`.
6. Một thành viên khác review trước khi merge.

## Quy ước response
- 2xx: thành công
- 400: dữ liệu đầu vào vi phạm quy tắc nghiệp vụ
- 404: không tìm thấy tài nguyên
- 409: trạng thái nghiệp vụ chưa cho phép
- 503: service phụ thuộc không khả dụng
- 504: service phụ thuộc timeout
