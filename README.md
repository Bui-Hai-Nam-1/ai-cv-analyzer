# AI CV Analyzer — CareerLens

Ứng dụng microservices hỗ trợ lưu CV/JD, trích xuất dữ liệu có cấu trúc và phân tích độ phù hợp giữa hồ sơ ứng viên với vị trí công việc.

## Kiến trúc

- `api-gateway`: cổng vào duy nhất, định tuyến request.
- `cv-service`: quản lý CV, PostgreSQL riêng.
- `jd-service`: quản lý Job Description, PostgreSQL riêng.
- `analysis-service`: lấy dữ liệu CV + JD, tính Match Score, Skill Gap và lưu kết quả; PostgreSQL riêng.

Mỗi service có source code, Dockerfile, OpenAPI và `GET /health`. Giao diện web được phục vụ từ API Gateway.

## Chạy toàn hệ thống

1. Cài và mở Docker Desktop (hoặc Docker Engine + Compose).
2. Tạo `.env` từ `.env.example` nếu chưa có file cấu hình.
3. Nếu dùng Ollama, mở Ollama trước khi upload CV/JD để AI phân tích. Nếu Ollama chưa tự chạy, mở một terminal riêng và chạy `ollama serve`; giữ terminal này mở. Kiểm tra model đã cài bằng `ollama list`.
4. Mở PowerShell tại thư mục gốc dự án và khởi chạy:

```powershell
docker compose up --build -d
docker compose ps
```

Web app và API Gateway: http://localhost:8080

Health: http://localhost:8080/health

CV Service: http://localhost:3001

JD Service: http://localhost:3002

Analysis Service: http://localhost:3003

Kiểm tra health của Gateway và ba service từ PowerShell:

```powershell
$urls = @(
  "http://localhost:8080/health",
  "http://localhost:3001/health",
  "http://localhost:3002/health",
  "http://localhost:3003/health"
)
foreach ($url in $urls) {
  Invoke-RestMethod $url | ConvertTo-Json -Compress
}
```

Xem log khi cần tìm lỗi:

```powershell
docker compose logs -f api-gateway cv-service jd-service analysis-service
```

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
- `POST /api/cvs/:id/reanalyze` — phân tích lại CV đã lưu bằng cấu hình AI hiện tại
- `GET /api/cvs` — danh sách CV
- `GET /api/cvs/:id` — xem CV
- `DELETE /api/cvs/:id` — xóa CV
- `POST /api/jds` — tạo JD
- `GET /api/jds` — danh sách JD
- `GET /api/jds/:id` — xem JD
- `POST /api/jds/:id/reanalyze` — phân tích lại yêu cầu trong JD đã lưu
- `DELETE /api/jds/:id` — xóa JD
- `POST /api/analyses` — phân tích CV với JD
- `GET /api/analyses/:id` — xem kết quả
- `GET /api/analyses/:id/skill-gaps` — xem kỹ năng còn thiếu
- `GET /api/analyses/:id/recommendations` — xem đề xuất
- `POST /api/analyses/:id/recommendations/more` — tạo và lưu thêm lộ trình học

Match Score dùng trọng số must-have cao gấp đôi nice-to-have; kết quả cũng nêu riêng tỷ lệ đáp ứng yêu cầu bắt buộc và bằng chứng CV cho từng mục đã khớp. Đề xuất học tập có link tìm khóa học tiếng Việt và video hướng dẫn trên YouTube. Các link là trang tìm kiếm theo kỹ năng, không khẳng định một khóa học cụ thể đã được kiểm duyệt.

## Kiểm thử API bằng Postman

Collection kiểm thử nằm tại `postman/AI-CV-Analyzer.postman_collection.json`.
Có thể import file này vào Postman Desktop, đặt **Working Directory** thành thư
mục `postman`, rồi chọn **Run** để chạy collection. Hướng dẫn chi tiết ở
[`postman/README.md`](./postman/README.md).

Để chạy collection từ terminal bằng Newman, mở PowerShell tại thư mục gốc dự án
và chạy:

```powershell
npx --yes newman run .\postman\AI-CV-Analyzer.postman_collection.json `
  --working-dir .\postman --reporters cli `
  --timeout-request 200000 --timeout 400000
```

Lệnh này chạy các health check và luồng CV/JD/analysis; file mẫu được lấy từ
`postman/fixtures/`. Newman cần Node.js/npm và Docker Compose phải đang chạy.
Collection xóa các bản ghi CV/JD kiểm thử sau khi tạo; bản ghi analysis được giữ
lại.

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

### Dùng AI local miễn phí với Ollama

Cài Ollama trên Windows và tải model:

```powershell
ollama pull qwen2.5:3b
```

Trong `.env`, dùng cấu hình Ollama OpenAI-compatible:

```env
OPENAI_API_KEY=ollama
OPENAI_BASE_URL=http://host.docker.internal:11434/v1
OPENAI_MODEL=qwen2.5:3b
```

`ollama` là giá trị giả để tương thích API, không phải secret. Docker Desktop dùng
`host.docker.internal` để các container truy cập Ollama trên Windows. Tạo lại
các service để nạp cấu hình:

```powershell
docker compose up -d --force-recreate cv-service jd-service analysis-service
```

Model local có thể chậm ở lần chạy đầu. `AI_TIMEOUT_MS` và `PROXY_TIMEOUT_MS`
trong `.env` mặc định lần lượt là 180 và 190 giây để cho phép Ollama khởi động
và suy luận.

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
