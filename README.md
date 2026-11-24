
# AI CV Analyzer — Microservices Starter

Bộ khung khởi tạo cho đồ án Microservices bằng Node.js + Express.

## Kiến trúc

- `api-gateway`: cổng vào duy nhất, định tuyến request.
- `cv-service`: quản lý CV, PostgreSQL riêng.
- `jd-service`: quản lý Job Description, PostgreSQL riêng.
- `analysis-service`: lấy dữ liệu CV + JD, tính Match Score, Skill Gap và lưu kết quả; PostgreSQL riêng.

Mỗi service có source code, Dockerfile, OpenAPI và `GET /health`.

## Chạy toàn hệ thống

1. Cài Docker Desktop (hoặc Docker Engine + Compose).
2. Copy `.env.example` thành `.env` nếu muốn chỉnh cấu hình.
3. Tại thư mục gốc, chạy:

```bash
docker compose up --build
```

Gateway: http://localhost:8080  
Health: http://localhost:8080/health

Dừng: `docker compose down`  
Dừng và xóa cả dữ liệu DB: `docker compose down -v`

## API chính

### CV Service

- `POST /api/cvs` — tạo CV
- `GET /api/cvs` — danh sách CV
- `GET /api/cvs/:id` — xem CV
- `DELETE /api/cvs/:id` — xóa CV

### JD Service

- `POST /api/jds` — tạo JD
- `GET /api/jds` — danh sách JD
- `GET /api/jds/:id` — xem JD
- `DELETE /api/jds/:id` — xóa JD

### Analysis Service

- `POST /api/analyses` — phân tích CV với JD
- `GET /api/analyses` — danh sách phân tích
- `GET /api/analyses/:id` — xem kết quả
- `GET /api/analyses/:id/skill-gaps` — xem kỹ năng còn thiếu
- `GET /api/analyses/:id/recommendations` — xem đề xuất
- `GET /api/analyses/circuit-status` — xem trạng thái Circuit Breaker

## Ví dụ sử dụng API

### Tạo CV

```bash
curl -X POST http://localhost:8080/api/cvs \
  -H "Content-Type: application/json" \
  -d '{"name":"Nguyen Van A","email":"a@example.com","content":"Skills: Node.js, PostgreSQL, Git. Project: REST API"}'
```

### Tạo JD

```bash
curl -X POST http://localhost:8080/api/jds \
  -H "Content-Type: application/json" \
  -d '{"title":"Backend Intern","company":"Example","content":"Requirements: Node.js, PostgreSQL, Docker, REST API, Git"}'
```

### Phân tích CV với JD

Dùng `id` trả về từ hai request trên:

```bash
curl -X POST http://localhost:8080/api/analyses \
  -H "Content-Type: application/json" \
  -d '{"cvId":1,"jdId":1}'
```

### Kiểm tra Circuit Breaker

```bash
curl http://localhost:8080/api/analyses/circuit-status
```

API trả về trạng thái của từng upstream mà Analysis Service đã gọi:

- `CLOSED`: service đang hoạt động bình thường.
- `OPEN`: tạm ngừng gọi upstream do có quá nhiều lỗi.
- `HALF_OPEN`: cho phép một request kiểm tra service đã phục hồi hay chưa.

Ví dụ cấu trúc response:

```json
{
  "service": "analysis-service",
  "circuitBreakers": {
    "cv-service:3001": {
      "state": "CLOSED",
      "failures": 0,
      "openedAt": null
    }
  }
}
```

Lưu ý: danh sách chỉ xuất hiện những upstream đã được gọi trong vòng đời hiện tại của Analysis Service. Trạng thái được lưu trong bộ nhớ, không phải database.

## Timeout, Retry và Circuit Breaker

Analysis Service sử dụng HTTP client để gọi CV Service và JD Service.

Các cơ chế xử lý lỗi:

- **Timeout:** giới hạn thời gian chờ phản hồi từ upstream.
- **Retry:** thử gọi lại khi gặp lỗi hạ tầng.
- **Circuit Breaker:** ngăn tiếp tục gọi upstream khi service liên tục gặp lỗi.
- **Business errors:** lỗi HTTP 4xx không được retry và không tính là lỗi kết nối của Circuit Breaker.
- **Pending:** bản ghi phân tích có thể giữ trạng thái `PENDING` khi không thể hoàn tất do lỗi hạ tầng.

Các biến môi trường trong Docker Compose:

| Biến | Mặc định | Ý nghĩa |
|---|---:|---|
| `HTTP_TIMEOUT_MS` | 2500 | Timeout khi gọi upstream (ms) |
| `HTTP_RETRIES` | 1 | Số lần retry |
| `CB_FAILURE_THRESHOLD` | 3 | Số lỗi liên tiếp để mở Circuit Breaker |
| `CB_RESET_TIMEOUT_MS` | 10000 | Thời gian chờ trước khi chuyển sang HALF_OPEN (ms) |

## Structured Logging

Analysis Service ghi log theo định dạng JSON, gồm:

- `timestamp`: thời điểm ghi log.
- `level`: mức độ INFO, WARN hoặc ERROR.
- `service`: tên service.
- `event`: sự kiện xảy ra.
- Các thông tin bổ sung như `analysisId`, `cvId`, `jdId`, `durationMs` hoặc `error`.

Một số sự kiện:

- `ANALYSIS_REQUEST_RECEIVED`
- `ANALYSIS_CREATED`
- `ANALYSIS_COMPUTED`
- `ANALYSIS_COMPLETED`
- `ANALYSIS_FAILED`
- `CIRCUIT_HALF_OPEN`
- `CIRCUIT_OPEN`
- `CIRCUIT_CLOSED`

Xem log:

```bash
docker compose logs -f analysis-service
```

Chỉ xem các dòng log gần nhất:

```bash
docker compose logs --tail=100 analysis-service
```

## Matching hiện tại

Matching hiện tại là bản MVP minh họa dựa trên từ khóa, chưa tích hợp AI/LLM thật.

Match Score được tính theo trọng số kỹ năng:

- REQUIRED: trọng số 2.
- PREFERRED: trọng số 1.5.
- NORMAL: trọng số 1.

Kết quả có Match Score, kỹ năng đã khớp, kỹ năng còn thiếu và đề xuất cải thiện. Đây là đánh giá dựa trên từ khóa, không chứng minh mức độ thành thạo thực tế của ứng viên.

## Quy ước nhóm

- Không commit `.env`, mật khẩu, API key.
- Mỗi thành viên làm trong service được phân công.
- Không sửa trực tiếp database của service khác; gọi API nội bộ.
- Mọi thay đổi nên tạo branch riêng và Pull Request.
- Cập nhật OpenAPI khi thêm/sửa endpoint.
- Không đưa business logic vào API Gateway.

## Chia việc gợi ý

- Thành viên 1: `cv-service`
- Thành viên 2: `jd-service`
- Thành viên 3: `analysis-service` + tích hợp Gateway/Docker
- Cả nhóm: kiểm thử Postman, báo cáo, demo và review chéo.

## Git lần đầu

Tạo repository rỗng trên GitHub, sau đó tại thư mục này:

```bash
git init
git add .
git commit -m "chore: initialize microservices project"
git branch -M main
git remote add origin https://github.com/<YOUR-ORG-OR-USERNAME>/ai-cv-analyzer.git
git push -u origin main
```

Các thành viên:

```bash
git clone https://github.com/<YOUR-ORG-OR-USERNAME>/ai-cv-analyzer.git
cd ai-cv-analyzer
```
