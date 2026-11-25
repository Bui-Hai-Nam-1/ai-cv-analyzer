# AI CV Analyzer — CareerLens

Ứng dụng microservices hỗ trợ lưu CV/JD, trích xuất dữ liệu có cấu trúc và phân tích độ phù hợp giữa hồ sơ ứng viên với vị trí công việc.

## Kiến trúc

- `api-gateway`: cổng vào duy nhất, định tuyến request.
- `cv-service`: quản lý CV, PostgreSQL riêng.
- `jd-service`: quản lý Job Description, PostgreSQL riêng.
- `analysis-service`: lấy dữ liệu CV + JD, tính Match Score, Skill Gap và lưu kết quả; PostgreSQL riêng.

Mỗi service có source code, Dockerfile, OpenAPI và `GET /health`. Giao diện web được phục vụ từ API Gateway.

## Chạy toàn hệ thống

1. Cài Docker Desktop (hoặc Docker Engine + Compose).
2. Tạo `.env` từ `.env.example` nếu chưa có file cấu hình.
3. Tại thư mục gốc, chạy:

```bash
docker compose up --build -d
```

Web app và API Gateway: http://localhost:8080

Health: http://localhost:8080/health

CV Service: http://localhost:3001

JD Service: http://localhost:3002

Analysis Service: http://localhost:3003

Dừng nhưng giữ dữ liệu: `docker compose down`

Dừng và xóa cả dữ liệu DB/uploads: `docker compose down -v` (xóa dữ liệu không thể khôi phục)

## Luồng sử dụng

1. Mở giao diện tại `http://localhost:8080`.
2. Tải CV PDF/DOCX lên trong **Hồ sơ CV**.
3. Dán nội dung JD hoặc tải file TXT/PDF/DOCX trong **Mô tả công việc**.
4. Vào **Phân tích phù hợp**, chọn CV và JD để xem match score, kỹ năng đáp ứng/còn thiếu và khuyến nghị.

OpenAI-compatible AI extraction/recommendations được bật khi cấu hình `OPENAI_API_KEY` trong `.env`. Nếu để trống, service dùng heuristic/rule-based extraction và ghi rõ nguồn trong dữ liệu trả về. Khi bật AI, nội dung CV/JD sẽ được gửi tới provider cấu hình; cần có thông báo và sự đồng ý phù hợp.

## API chính

- `POST /api/cvs` — tạo CV
- `GET /api/cvs` — danh sách CV
- `GET /api/cvs/:id` — xem CV
- `DELETE /api/cvs/:id` — xóa CV
- `POST /api/jds` — tạo JD
- `GET /api/jds` — danh sách JD
- `GET /api/jds/:id` — xem JD
- `DELETE /api/jds/:id` — xóa JD
- `POST /api/analyses` — phân tích CV với JD
- `GET /api/analyses/:id` — xem kết quả
- `GET /api/analyses/:id/skill-gaps` — xem kỹ năng còn thiếu
- `GET /api/analyses/:id/recommendations` — xem đề xuất

### Ví dụ tạo CV

```bash
curl -X POST http://localhost:8080/api/cvs \
  -H "Content-Type: application/json" \
  -d '{"name":"Nguyen Van A","email":"a@example.com","content":"Skills: Node.js, PostgreSQL, Git. Project: REST API"}'
```

### Upload và trích xuất CV PDF/DOCX

CV Service nhận một file PDF hoặc DOCX, tối đa 10 MB. File được lưu trong volume
`cv_uploads`; nội dung trích xuất và dữ liệu có cấu trúc được lưu trong database
CV riêng. Có thể bỏ `name`/`email` nếu thông tin đó có trong CV.

```bash
curl -X POST http://localhost:8080/api/cvs \
  -F "file=@./resume.pdf" \
  -F "name=Nguyen Van A"
```

Phản hồi giữ trường `content` để Analysis Service hiện tại tiếp tục hoạt động,
đồng thời có `parsed_data` gồm `personalInformation`, `education`,
`technicalSkills`, `projects`, `experience`, `certifications` và `languages`.
Trường `analysis_provider` cho biết CV được phân tích bằng model nào hay bằng
`heuristic`.

Để bật trích xuất bằng AI, đặt `OPENAI_API_KEY` trong `.env` (có thể cấu hình
`OPENAI_BASE_URL` và `OPENAI_MODEL`). Nếu không cấu hình key, service vẫn hoạt
động với heuristic và phản hồi ghi rõ nguồn phân tích. Khi bật AI, nội dung CV
sẽ được gửi đến provider đã cấu hình; cần thông báo và có sự đồng ý phù hợp.
Không commit API key.

### Ví dụ tạo JD

```bash
curl -X POST http://localhost:8080/api/jds \
  -H "Content-Type: application/json" \
  -d '{"title":"Backend Intern","company":"Example","content":"Requirements: Node.js, PostgreSQL, Docker, REST API, Git"}'
```

Dùng `id` trả về từ hai request trên để gọi:

```bash
curl -X POST http://localhost:8080/api/analyses \
  -H "Content-Type: application/json" \
  -d '{"cvId":1,"jdId":1}'
```

Match score hiện tính trên các yêu cầu được trích xuất; yêu cầu `must_have` có trọng số cao gấp đôi `nice_to_have`. Không có API key, đề xuất dùng rule-based; khi bật AI, AI tạo khuyến nghị dựa trên khoảng trống đã được xác định.

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
