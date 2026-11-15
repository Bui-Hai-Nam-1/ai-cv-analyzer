const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '1mb' }));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = process.env.PORT || 3003;
const timeoutMs = Number(process.env.HTTP_TIMEOUT_MS || 2500);
const retries = Number(process.env.HTTP_RETRIES || 1);
const cvBase = process.env.CV_SERVICE_URL || 'http://localhost:3001';
const jdBase = process.env.JD_SERVICE_URL || 'http://localhost:3002';

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS analyses (
    id SERIAL PRIMARY KEY, cv_id INTEGER NOT NULL, jd_id INTEGER NOT NULL,
    status TEXT NOT NULL, result JSONB, error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}

// Timeout + retry: không retry lỗi nghiệp vụ 4xx; lỗi mạng/5xx được thử lại có giới hạn.
async function getWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (response.status >= 400 && response.status < 500) {
        const err = new Error(`UPSTREAM_BUSINESS_${response.status}`);
        err.status = response.status;
        throw err;
      }
      if (!response.ok) throw new Error(`UPSTREAM_HTTP_${response.status}`);
      return await response.json();
    } catch (err) {
      clearTimeout(timer);
      if (err.status && err.status < 500) throw err;
      lastError = err;
      if (attempt < retries) await new Promise(r => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  const err = new Error(lastError?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE');
  err.status = lastError?.name === 'AbortError' ? 504 : 503;
  throw err;
}

function extractTerms(text) {
  return [...new Set((text.toLowerCase().match(/[a-z][a-z0-9+#.-]{1,}/g) || []))];
}
function buildAnalysis(cv, jd) {
  const cvText = `${cv.content}`.toLowerCase();
  const terms = extractTerms(jd.content).filter(t => t.length > 2);
  const matched = terms.filter(t => cvText.includes(t));
  const missing = terms.filter(t => !cvText.includes(t));
  const score = terms.length ? Math.round(matched.length / terms.length * 100) : 0;
  return {
    matchScore: score,
    matchedSkills: matched,
    missingSkills: missing,
    recommendations: missing.slice(0, 5).map(skill => `Nếu bạn thực sự có kỹ năng ${skill}, hãy bổ sung minh chứng cụ thể vào CV; nếu chưa có, cân nhắc học và thực hành kỹ năng này.`),
    note: 'Điểm số MVP dựa trên so khớp từ khóa, không phải đánh giá AI chuyên sâu.'
  };
}

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({service:'analysis-service',status:'ok',database:'ok'}); }
  catch { res.status(503).json({service:'analysis-service',status:'degraded',database:'unavailable'}); }
});

app.post('/analyses', async (req, res) => {
  const cvId = Number(req.body?.cvId);
  const jdId = Number(req.body?.jdId);
  if (!Number.isInteger(cvId) || cvId <= 0 || !Number.isInteger(jdId) || jdId <= 0) {
    return res.status(400).json({error:'INVALID_ANALYSIS_INPUT',message:'cvId và jdId phải là số nguyên dương'});
  }

  // Lưu PENDING trước khi gọi service khác. Nếu không xác định được kết quả do timeout,
  // giữ PENDING để thể hiện trạng thái chưa xác định thay vì báo thành công giả.
  let analysisId;
  try {
    const created = await pool.query(
      'INSERT INTO analyses(cv_id,jd_id,status) VALUES($1,$2,$3) RETURNING id',
      [cvId,jdId,'PENDING']
    );
    analysisId = created.rows[0].id;

    const [cv, jd] = await Promise.all([
      getWithRetry(`${cvBase}/cvs/${cvId}`),
      getWithRetry(`${jdBase}/jds/${jdId}`)
    ]);
    const result = buildAnalysis(cv, jd);
    const saved = await pool.query(
      `UPDATE analyses SET status='COMPLETED', result=$1, updated_at=NOW()
       WHERE id=$2 RETURNING *`,
      [JSON.stringify(result),analysisId]
    );
    return res.status(201).json(saved.rows[0]);
  } catch (err) {
    if (analysisId) {
      if (err.status === 404 || (err.status >= 400 && err.status < 500)) {
        await pool.query(
          `UPDATE analyses SET status='FAILED', error=$1, updated_at=NOW() WHERE id=$2`,
          [err.message,analysisId]
        ).catch(()=>{});
      }
      // Lỗi timeout/hạ tầng: giữ PENDING để có thể đối soát hoặc chạy lại sau.
    }
    const status = err.status || 503;
    return res.status(status).json({
      error: status === 504 ? 'UPSTREAM_TIMEOUT' : status === 404 ? 'RELATED_RESOURCE_NOT_FOUND' : 'UPSTREAM_UNAVAILABLE',
      analysisId: analysisId || null,
      status: analysisId ? (status >= 500 ? 'PENDING' : 'FAILED') : undefined,
      message: 'Không thể hoàn tất phân tích do dữ liệu liên quan hoặc service phụ thuộc không khả dụng.'
    });
  }
});

app.get('/analyses', async (_req,res) => {
  try { const r=await pool.query('SELECT * FROM analyses ORDER BY id DESC'); res.json(r.rows); }
  catch { res.status(500).json({error:'INTERNAL_ERROR'}); }
});
app.get('/analyses/:id', async (req,res) => {
  try {
    const r=await pool.query('SELECT * FROM analyses WHERE id=$1',[req.params.id]);
    if (!r.rowCount) return res.status(404).json({error:'ANALYSIS_NOT_FOUND'});
    res.json(r.rows[0]);
  } catch { res.status(500).json({error:'INTERNAL_ERROR'}); }
});
app.get('/analyses/:id/skill-gaps', async (req,res) => {
  try {
    const r=await pool.query('SELECT id,status,result FROM analyses WHERE id=$1',[req.params.id]);
    if (!r.rowCount) return res.status(404).json({error:'ANALYSIS_NOT_FOUND'});
    if (r.rows[0].status !== 'COMPLETED') return res.status(409).json({error:'ANALYSIS_NOT_COMPLETED',status:r.rows[0].status});
    res.json({analysisId:r.rows[0].id,missingSkills:r.rows[0].result.missingSkills || []});
  } catch { res.status(500).json({error:'INTERNAL_ERROR'}); }
});
app.get('/analyses/:id/recommendations', async (req,res) => {
  try {
    const r=await pool.query('SELECT id,status,result FROM analyses WHERE id=$1',[req.params.id]);
    if (!r.rowCount) return res.status(404).json({error:'ANALYSIS_NOT_FOUND'});
    if (r.rows[0].status !== 'COMPLETED') return res.status(409).json({error:'ANALYSIS_NOT_COMPLETED',status:r.rows[0].status});
    res.json({analysisId:r.rows[0].id,recommendations:r.rows[0].result.recommendations || []});
  } catch { res.status(500).json({error:'INTERNAL_ERROR'}); }
});

init().then(() => app.listen(port, () => console.log(`Analysis Service listening on ${port}`)))
  .catch(e => { console.error('Analysis DB init failed', e); process.exit(1); });
