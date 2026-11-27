const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const { analyzeCv, extractText } = require('./cv-processing');

const app = express();
app.use(express.json({ limit: '1mb' }));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = process.env.PORT || 3001;
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
const maxFileSize = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDir),
    filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: maxFileSize, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const supported = (extension === '.pdf' && ['application/pdf', 'application/octet-stream'].includes(file.mimetype))
      || (extension === '.docx' && [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/octet-stream'
      ].includes(file.mimetype));
    callback(supported ? null : new Error('UNSUPPORTED_FILE_TYPE'), supported);
  }
});

async function init() {
  await fs.mkdir(uploadDir, { recursive: true });
  await pool.query(`CREATE TABLE IF NOT EXISTS cvs (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    content TEXT NOT NULL,
    file_name TEXT,
    file_path TEXT,
    parsed_data JSONB,
    analysis_provider TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`
    ALTER TABLE cvs
      ADD COLUMN IF NOT EXISTS file_name TEXT,
      ADD COLUMN IF NOT EXISTS file_path TEXT,
      ADD COLUMN IF NOT EXISTS parsed_data JSONB,
      ADD COLUMN IF NOT EXISTS analysis_provider TEXT
  `);
}

function publicCv(row) {
  const { file_path: _filePath, ...cv } = row;
  return cv;
}

function validId(id) {
  return /^[1-9]\d*$/.test(id);
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ service: 'cv-service', status: 'ok', database: 'ok' });
  } catch (error) {
    console.error('CV health check failed:', error.message);
    res.status(503).json({ service: 'cv-service', status: 'degraded', database: 'unavailable' });
  }
});

app.post('/cvs', upload.single('file'), async (req, res) => {
  let savedFilePath;
  try {
    const file = req.file;
    let content = req.body?.content;
    let fileName = null;
    if (file) {
      savedFilePath = file.path;
      const buffer = await fs.readFile(file.path);
      const isPdf = path.extname(file.originalname).toLowerCase() === '.pdf';
      const pdfHeaderOffset = buffer.indexOf('%PDF-');
      if ((isPdf && (pdfHeaderOffset < 0 || pdfHeaderOffset >= 1024))
        || (!isPdf && !(buffer[0] === 0x50 && buffer[1] === 0x4b))) {
        return res.status(422).json({ error: 'INVALID_FILE', message: 'Tệp không đúng định dạng PDF hoặc DOCX.' });
      }
      content = await extractText(buffer, file.originalname);
      fileName = path.basename(file.originalname);
    }

    if (typeof content !== 'string' || content.trim().length < 20) {
      return res.status(400).json({
        error: 'INVALID_CV',
        message: 'Cần tải lên file PDF/DOCX có nội dung hoặc cung cấp content tối thiểu 20 ký tự.'
      });
    }
    if (content.length > 100000) {
      return res.status(413).json({ error: 'CV_CONTENT_TOO_LARGE', message: 'Nội dung CV sau trích xuất vượt quá 100.000 ký tự.' });
    }

    const { data, provider } = await analyzeCv(content);
    const name = String(req.body?.name || data.personalInformation.fullName || fileName?.replace(/\.(pdf|docx)$/i, '') || '').trim();
    const email = String(req.body?.email || data.personalInformation.email || '').trim() || null;
    if (!name) {
      return res.status(400).json({ error: 'INVALID_CV', message: 'name là bắt buộc khi không xác định được tên từ CV.' });
    }

    const result = await pool.query(
      `INSERT INTO cvs(name, email, content, file_name, file_path, parsed_data, analysis_provider)
       VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, email, content.trim(), fileName, savedFilePath || null, JSON.stringify(data), provider]
    );
    savedFilePath = null;
    return res.status(201).json(publicCv(result.rows[0]));
  } catch (error) {
    console.error('CV creation failed:', error);
    const status = error.code === 'UNSUPPORTED_FILE_TYPE' ? 415 : error.code === 'CV_PARSE_FAILED' ? 422 : error.code === 'AI_ANALYSIS_FAILED' ? 502 : 500;
    return res.status(status).json({
      error: status === 415 ? 'UNSUPPORTED_FILE_TYPE' : status === 422 ? 'CV_PARSE_FAILED' : status === 502 ? 'CV_ANALYSIS_FAILED' : 'INTERNAL_ERROR',
      message: status === 415
        ? 'Chỉ chấp nhận file PDF hoặc DOCX.'
        : status === 422
          ? 'Không thể đọc nội dung file. Hãy kiểm tra file không bị hỏng hoặc được bảo vệ bằng mật khẩu.'
          : status === 502
            ? 'Không thể phân tích CV bằng AI. Vui lòng thử lại sau.'
            : 'Không thể lưu CV.'
    });
  } finally {
    if (savedFilePath) {
      try {
        await fs.unlink(savedFilePath);
      } catch (error) {
        if (error.code !== 'ENOENT') console.error('Failed to remove rejected CV upload:', error);
      }
    }
  }
});

app.get('/cvs', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM cvs ORDER BY id DESC');
    res.json(result.rows.map(publicCv));
  } catch (error) {
    console.error('CV listing failed:', error.message);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

app.post('/cvs/:id/reanalyze', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'INVALID_CV_ID' });
  try {
    const existing = await pool.query('SELECT content FROM cvs WHERE id=$1', [req.params.id]);
    if (!existing.rowCount) return res.status(404).json({ error: 'CV_NOT_FOUND' });

    const { data, provider } = await analyzeCv(existing.rows[0].content);
    const updated = await pool.query(
      'UPDATE cvs SET parsed_data=$1, analysis_provider=$2 WHERE id=$3 RETURNING *',
      [JSON.stringify(data), provider, req.params.id]
    );
    return res.json(publicCv(updated.rows[0]));
  } catch (error) {
    console.error('CV reanalysis failed:', error);
    const status = error.code === 'AI_ANALYSIS_FAILED' ? 502 : 500;
    return res.status(status).json({
      error: status === 502 ? 'CV_ANALYSIS_FAILED' : 'INTERNAL_ERROR',
      message: status === 502 ? 'Không thể phân tích lại CV bằng AI. Vui lòng thử lại sau.' : 'Không thể phân tích lại CV.'
    });
  }
});

app.get('/cvs/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'INVALID_CV_ID' });
  try {
    const result = await pool.query('SELECT * FROM cvs WHERE id=$1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'CV_NOT_FOUND' });
    res.json(publicCv(result.rows[0]));
  } catch (error) {
    console.error('CV lookup failed:', error.message);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

app.get('/cvs/:id/file', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'INVALID_CV_ID' });
  try {
    const result = await pool.query('SELECT file_path, file_name FROM cvs WHERE id=$1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'CV_NOT_FOUND' });
    const cvFile = result.rows[0];
    if (!cvFile.file_path) return res.status(404).json({ error: 'CV_FILE_NOT_FOUND', message: 'CV này được tạo từ văn bản, không có file gốc.' });
    try {
      await fs.access(cvFile.file_path);
    } catch (error) {
      if (error.code === 'ENOENT') return res.status(404).json({ error: 'CV_FILE_NOT_FOUND' });
      throw error;
    }
    if (req.query.inline === 'true') {
      if (path.extname(cvFile.file_name || '').toLowerCase() !== '.pdf') {
        return res.status(415).json({ error: 'CV_PREVIEW_UNSUPPORTED', message: 'Chỉ hỗ trợ xem trước file PDF.' });
      }
      res.type('application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      return res.sendFile(cvFile.file_path, error => {
        if (error) {
          console.error('CV PDF preview failed:', error.message);
          if (!res.headersSent) res.status(error.statusCode || 500).json({ error: 'INTERNAL_ERROR' });
        }
      });
    }
    return res.download(cvFile.file_path, cvFile.file_name || `cv-${req.params.id}`);
  } catch (error) {
    console.error('CV file download failed:', error.message);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

app.delete('/cvs/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'INVALID_CV_ID' });
  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    const result = await client.query('DELETE FROM cvs WHERE id=$1 RETURNING id, file_path', [req.params.id]);
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ error: 'CV_NOT_FOUND' });
    }
    if (result.rows[0].file_path) {
      try {
        await fs.unlink(result.rows[0].file_path);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          error.code = 'CV_FILE_CLEANUP_FAILED';
          throw error;
        }
      }
    }
    await client.query('COMMIT');
    transactionStarted = false;
    res.status(204).send();
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(rollbackError => console.error('CV deletion rollback failed:', rollbackError));
    }
    console.error('CV deletion failed:', error.message);
    res.status(500).json({
      error: error.code === 'CV_FILE_CLEANUP_FAILED' ? 'CV_FILE_CLEANUP_FAILED' : 'INTERNAL_ERROR',
      message: error.code === 'CV_FILE_CLEANUP_FAILED' ? 'The CV file could not be removed; the CV record was preserved.' : undefined
    });
  } finally {
    if (client) client.release();
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'FILE_TOO_LARGE', message: 'Kích thước file tối đa là 10 MB.' });
  }
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'INVALID_UPLOAD', message: 'Chỉ tải lên một file CV mỗi lần.' });
  }
  if (error.message === 'UNSUPPORTED_FILE_TYPE') {
    return res.status(415).json({ error: 'UNSUPPORTED_FILE_TYPE', message: 'Chỉ chấp nhận file PDF hoặc DOCX.' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'REQUEST_TOO_LARGE', message: 'Kích thước request tối đa là 1 MB.' });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'INVALID_JSON', message: 'Request body phải là JSON hợp lệ.' });
  }
  console.error('Unhandled CV request error:', error);
  return res.status(500).json({ error: 'INTERNAL_ERROR' });
});

init().then(() => app.listen(port, () => console.log(`CV Service listening on ${port}`)))
  .catch(error => {
    console.error('CV DB init failed', error);
    process.exit(1);
  });
