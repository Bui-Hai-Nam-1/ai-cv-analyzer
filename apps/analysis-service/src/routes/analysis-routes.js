const express = require('express');
const { pool } = require('../db');

const { buildAnalysis } = require('../services/analysis-engine');
const { getWithRetry } = require('../services/http-client');

const router = express.Router();

const cvBase = (
  process.env.CV_SERVICE_URL || 'http://localhost:3001'
).replace(/\/$/, '');

const jdBase = (
  process.env.JD_SERVICE_URL || 'http://localhost:3002'
).replace(/\/$/, '');

function isValidId(id) {
  return Number.isInteger(Number(id)) && Number(id) > 0;
}

// POST /analyses
router.post('/', async (req, res) => {
  const cvId = Number(req.body?.cvId);
  const jdId = Number(req.body?.jdId);

  if (
    !Number.isInteger(cvId) || cvId <= 0 ||
    !Number.isInteger(jdId) || jdId <= 0
  ) {
    return res.status(400).json({
      error: 'INVALID_ANALYSIS_INPUT',
      message: 'cvId và jdId phải là số nguyên dương'
    });
  }

  let analysisId;

  try {
    // Tạo bản ghi PENDING trước khi gọi service phụ thuộc.
    const created = await pool.query(
      `INSERT INTO analyses (cv_id, jd_id, status)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [cvId, jdId, 'PENDING']
    );

    analysisId = created.rows[0].id;

    // Gọi CV Service và JD Service song song.
    const [cv, jd] = await Promise.all([
      getWithRetry(`${cvBase}/cvs/${cvId}`),
      getWithRetry(`${jdBase}/jds/${jdId}`)
    ]);

    // Chạy thuật toán phân tích.
    const result = buildAnalysis(cv, jd);

    // Lưu kết quả.
    const saved = await pool.query(
      `UPDATE analyses
       SET status = 'COMPLETED',
           result = $1,
           error = NULL,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(result), analysisId]
    );

    return res.status(201).json(saved.rows[0]);

  } catch (error) {
    // Lỗi nghiệp vụ: chuyển sang FAILED.
    if (
      analysisId &&
      error.status >= 400 &&
      error.status < 500
    ) {
      await pool.query(
        `UPDATE analyses
         SET status = 'FAILED',
             error = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [error.message, analysisId]
      ).catch(() => {});
    }

    // Lỗi hạ tầng: giữ PENDING để tránh báo thành công giả.
    const status = error.status || 503;

    let errorCode = 'UPSTREAM_UNAVAILABLE';

    if (status === 504) {
      errorCode = 'UPSTREAM_TIMEOUT';
    } else if (status === 404) {
      errorCode = 'RELATED_RESOURCE_NOT_FOUND';
    } else if (status >= 400 && status < 500) {
      errorCode = 'RELATED_RESOURCE_ERROR';
    }

    return res.status(status).json({
      error: errorCode,
      analysisId: analysisId || null,
      status: analysisId
        ? (status >= 500 ? 'PENDING' : 'FAILED')
        : undefined,
      message: 'Không thể hoàn tất phân tích do dữ liệu liên quan hoặc service phụ thuộc không khả dụng.'
    });
  }
});

// GET /analyses
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM analyses ORDER BY id DESC'
    );

    return res.json(result.rows);
  } catch {
    return res.status(500).json({
      error: 'INTERNAL_ERROR'
    });
  }
});

// GET /analyses/:id
router.get('/:id', async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({
      error: 'INVALID_ANALYSIS_ID'
    });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM analyses WHERE id = $1',
      [Number(req.params.id)]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'ANALYSIS_NOT_FOUND'
      });
    }

    return res.json(result.rows[0]);

  } catch {
    return res.status(500).json({
      error: 'INTERNAL_ERROR'
    });
  }
});

// GET /analyses/:id/skill-gaps
router.get('/:id/skill-gaps', async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({
      error: 'INVALID_ANALYSIS_ID'
    });
  }

  try {
    const result = await pool.query(
      'SELECT id, status, result FROM analyses WHERE id = $1',
      [Number(req.params.id)]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'ANALYSIS_NOT_FOUND'
      });
    }

    const analysis = result.rows[0];

    if (analysis.status !== 'COMPLETED') {
      return res.status(409).json({
        error: 'ANALYSIS_NOT_COMPLETED',
        status: analysis.status
      });
    }

    return res.json({
      analysisId: analysis.id,
      missingSkills: analysis.result?.missingSkills || []
    });

  } catch {
    return res.status(500).json({
      error: 'INTERNAL_ERROR'
    });
  }
});

// GET /analyses/:id/recommendations
router.get('/:id/recommendations', async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({
      error: 'INVALID_ANALYSIS_ID'
    });
  }

  try {
    const result = await pool.query(
      'SELECT id, status, result FROM analyses WHERE id = $1',
      [Number(req.params.id)]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'ANALYSIS_NOT_FOUND'
      });
    }

    const analysis = result.rows[0];

    if (analysis.status !== 'COMPLETED') {
      return res.status(409).json({
        error: 'ANALYSIS_NOT_COMPLETED',
        status: analysis.status
      });
    }

    return res.json({
      analysisId: analysis.id,
      recommendations: analysis.result?.recommendations || []
    });

  } catch {
    return res.status(500).json({
      error: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;