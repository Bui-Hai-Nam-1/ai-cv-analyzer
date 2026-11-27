const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const { analyzeJd, extractText } = require('./jd-processing');

const app = express();
app.use(express.json({ limit: '1mb' }));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = process.env.PORT || 3002;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const mimeTypes = {
      '.txt': ['text/plain', 'application/octet-stream'],
      '.pdf': ['application/pdf', 'application/octet-stream'],
      '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream']
    };
    const supported = mimeTypes[extension]?.includes(file.mimetype);
    callback(supported ? null : new Error('UNSUPPORTED_FILE_TYPE'), Boolean(supported));
  }
});

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS job_descriptions (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    company TEXT,
    content TEXT NOT NULL,
    extracted_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
    analysis_provider TEXT NOT NULL DEFAULT 'heuristic',
    file_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`
    ALTER TABLE job_descriptions
      ADD COLUMN IF NOT EXISTS extracted_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS analysis_provider TEXT NOT NULL DEFAULT 'heuristic',
      ADD COLUMN IF NOT EXISTS file_name TEXT
  `);
}

function validId(id) {
  return /^[1-9]\d*$/.test(id);
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ service: 'jd-service', status: 'ok', database: 'ok' });
  } catch (error) {
    console.error('JD health check failed:', error.message);
    res.status(503).json({ service: 'jd-service', status: 'degraded', database: 'unavailable' });
  }
});

app.post('/jds', upload.single('file'), async (req, res) => {
  try {
    let content = req.body?.content;
    let fileName = null;
    if (req.file) {
      content = await extractText(req.file.buffer, req.file.originalname);
      fileName = path.basename(req.file.originalname);
    }
    if (typeof content !== 'string' || content.trim().length < 20) {
      return res.status(400).json({
        error: 'INVALID_JD',
        message: 'Cần cung cấp content tối thiểu 20 ký tự hoặc tải lên file TXT, PDF, DOCX.'
      });
    }
    if (content.length > 100000) {
      return res.status(413).json({ error: 'JD_CONTENT_TOO_LARGE', message: 'Nội dung JD vượt quá 100.000 ký tự.' });
    }
    const title = String(req.body?.title || fileName?.replace(/\.(txt|pdf|docx)$/i, '') || '').trim();
    if (!title) return res.status(400).json({ error: 'INVALID_JD', message: 'title là bắt buộc.' });
    const { requirements, provider } = await analyzeJd(content);
    const result = await pool.query(
      `INSERT INTO job_descriptions(title, company, content, extracted_requirements, analysis_provider, file_name)
       VALUES($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, String(req.body?.company || '').trim() || null, content.trim(), JSON.stringify(requirements), provider, fileName]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('JD creation failed:', error);
    const status = error.code === 'UNSUPPORTED_FILE_TYPE' ? 415 : error.code === 'JD_PARSE_FAILED' ? 422 : error.code === 'JD_AI_ANALYSIS_FAILED' ? 502 : 500;
    return res.status(status).json({
      error: status === 415 ? 'UNSUPPORTED_FILE_TYPE' : status === 422 ? 'JD_PARSE_FAILED' : status === 502 ? 'JD_AI_ANALYSIS_FAILED' : 'INTERNAL_ERROR',
      message: status === 415
        ? 'Chỉ chấp nhận file TXT, PDF hoặc DOCX.'
        : status === 422
          ? 'Không thể trích xuất văn bản từ file JD.'
          : status === 502
            ? 'Không thể phân tích JD bằng AI. Vui lòng thử lại sau.'
            : 'Không thể lưu JD.'
    });
  }
});

app.get('/jds', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM job_descriptions ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('JD listing failed:', error.message);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

app.post('/jds/:id/reanalyze', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'INVALID_JD_ID' });
  try {
    const existing = await pool.query('SELECT content FROM job_descriptions WHERE id=$1', [req.params.id]);
    if (!existing.rowCount) return res.status(404).json({ error: 'JD_NOT_FOUND' });
    const { requirements, provider } = await analyzeJd(existing.rows[0].content);
    const result = await pool.query(
      `UPDATE job_descriptions
       SET extracted_requirements=$1, analysis_provider=$2
       WHERE id=$3 RETURNING *`,
      [JSON.stringify(requirements), provider, req.params.id]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('JD reanalysis failed:', error);
    const status = error.code === 'JD_AI_ANALYSIS_FAILED' ? 502 : 500;
    return res.status(status).json({
      error: status === 502 ? 'JD_AI_ANALYSIS_FAILED' : 'INTERNAL_ERROR',
      message: status === 502
        ? 'Không thể phân tích lại JD bằng AI. Vui lòng kiểm tra cấu hình AI và thử lại.'
        : 'Không thể phân tích lại JD.'
    });
  }
});

app.get('/jds/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'INVALID_JD_ID' });
  try {
    const result = await pool.query('SELECT * FROM job_descriptions WHERE id=$1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'JD_NOT_FOUND' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('JD lookup failed:', error.message);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

app.delete('/jds/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'INVALID_JD_ID' });
  try {
    const result = await pool.query('DELETE FROM job_descriptions WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'JD_NOT_FOUND' });
    res.status(204).send();
  } catch (error) {
    console.error('JD deletion failed:', error.message);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'FILE_TOO_LARGE', message: 'Kích thước file tối đa là 10 MB.' });
  }
  if (error instanceof multer.MulterError) return res.status(400).json({ error: 'INVALID_UPLOAD' });
  if (error.message === 'UNSUPPORTED_FILE_TYPE') {
    return res.status(415).json({ error: 'UNSUPPORTED_FILE_TYPE', message: 'Chỉ chấp nhận file TXT, PDF hoặc DOCX.' });
  }
  console.error('Unhandled JD request error:', error);
  return res.status(500).json({ error: 'INTERNAL_ERROR' });
});

init().then(() => app.listen(port, () => console.log(`JD Service listening on ${port}`)))
  .catch(error => {
    console.error('JD DB init failed', error);
    process.exit(1);
  });
