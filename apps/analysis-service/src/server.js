const express = require('express');
const { Pool } = require('pg');
const {
  buildAnalysis,
  buildMoreRecommendations,
  buildRuleBasedRecommendations,
  learningResources,
  normalizeText
} = require('./matching');

const app = express();
app.use(express.json({ limit: '1mb' }));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = process.env.PORT || 3003;
const timeoutMs = Number(process.env.HTTP_TIMEOUT_MS || 2500);
const retries = Number(process.env.HTTP_RETRIES || 1);
const cvBase = process.env.CV_SERVICE_URL || 'http://localhost:3001';
const jdBase = process.env.JD_SERVICE_URL || 'http://localhost:3002';

function containsVietnamese(value) {
  return /[\u00c0-\u024f\u1e00-\u1eff]/i.test(String(value || ''));
}

function localizeDuration(value) {
  const match = String(value || '').match(/^\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*(day|week|month)s?\s*$/i);
  if (!match) return null;
  const unit = { day: 'ngày', week: 'tuần', month: 'tháng' }[match[3].toLowerCase()];
  return `${match[1]}${match[2] ? `–${match[2]}` : ''} ${unit} (ước tính)`;
}

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS analyses (
    id SERIAL PRIMARY KEY, cv_id INTEGER NOT NULL, jd_id INTEGER NOT NULL,
    status TEXT NOT NULL, result JSONB, error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}

async function getWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.status >= 400 && response.status < 500) {
        const error = new Error(`UPSTREAM_BUSINESS_${response.status}`);
        error.status = response.status;
        throw error;
      }
      if (!response.ok) throw new Error(`UPSTREAM_HTTP_${response.status}`);
      return await response.json();
    } catch (error) {
      if (error.status && error.status < 500) throw error;
      lastError = error;
      if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  const error = new Error(lastError?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE');
  error.status = lastError?.name === 'AbortError' ? 504 : 503;
  throw error;
}

async function createAiRecommendations(result, jd, existingRecommendations = [], additional = false) {
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.AI_TIMEOUT_MS || 180000));
  const missingRequirements = result.missingRequirements.slice(0, 20);
  const gapsByName = new Map(missingRequirements.map(item => [normalizeText(item.name), item]));
  const existingTitles = existingRecommendations.map(item => typeof item === 'string' ? item : item?.title).filter(Boolean);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: additional ? 0.65 : 0.3,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Bạn là cố vấn học tập nghề nghiệp. Viết TOÀN BỘ title, action và duration bằng tiếng Việt tự nhiên; giữ nguyên tên công nghệ bằng tiếng Anh. Chỉ đề xuất lộ trình học và bài tập thực hành thực tế cho các yêu cầu còn thiếu được cung cấp. Không khẳng định ứng viên đã biết kỹ năng đó. Tuyệt đối không bịa tên khóa học, tổ chức, chứng chỉ, nhà cung cấp hoặc URL cụ thể; link khóa học/video sẽ được hệ thống bổ sung riêng. Đưa ra bước học cụ thể và sản phẩm có thể đưa vào portfolio. Mỗi mục phải gắn với đúng một requirement trong danh sách. duration là ước tính thận trọng dạng "2-4 weeks" hoặc null. Chỉ trả JSON theo mẫu: {"recommendations":[{"requirement":"tên yêu cầu","title":"tiêu đề tiếng Việt","action":"các bước thực hiện bằng tiếng Việt","duration":"2-4 weeks hoặc null"}]}.'
          },
          {
            role: 'user',
            content: JSON.stringify({
              request: additional
                ? 'Generate up to five additional, meaningfully different suggestions. Avoid every existing title; prefer uncovered gaps and otherwise propose a different way to learn or demonstrate a listed gap.'
                : 'Generate one useful recommendation for each listed gap.',
              jobTitle: jd.title,
              missingRequirements,
              existingRecommendationTitles: additional ? existingTitles : []
            })
          }
        ]
      })
    });
    if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
    const payload = await response.json();
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}');
    if (!Array.isArray(parsed.recommendations)) {
      throw new Error('AI provider returned an invalid recommendations array');
    }
    const seenTitles = new Set(existingTitles.map(normalizeText));
    const recommendations = [];
    for (const [index, raw] of parsed.recommendations.entries()) {
      const item = typeof raw === 'string' ? { title: raw, action: raw } : raw;
      if (!item || typeof item !== 'object') continue;
      const requirement = gapsByName.get(normalizeText(item.requirement))
        || missingRequirements[index % Math.max(1, missingRequirements.length)];
      if (!requirement) continue;
      const fallback = buildRuleBasedRecommendations([requirement])[0];
      const suggestedTitle = typeof item.title === 'string' ? item.title.trim() : '';
      const suggestedAction = typeof item.action === 'string' ? item.action.trim() : '';
      const title = containsVietnamese(suggestedTitle) ? suggestedTitle : fallback.title;
      const action = containsVietnamese(suggestedAction) ? suggestedAction : fallback.action;
      if (!title || !action || seenTitles.has(normalizeText(title))) continue;
      recommendations.push({
        requirement: requirement.name,
        category: requirement.category,
        priority: requirement.priority,
        title,
        action,
        duration: localizeDuration(item.duration),
        source: process.env.OPENAI_MODEL || 'AI',
        resources: learningResources(requirement)
      });
      seenTitles.add(normalizeText(title));
      if (recommendations.length >= (additional ? 5 : 20)) break;
    }
    if (!recommendations.length) throw new Error('AI provider returned no unique recommendation');
    return recommendations;
  } catch (cause) {
    const error = new Error('AI recommendations could not be generated', { cause });
    error.code = 'AI_RECOMMENDATION_FAILED';
    error.status = 502;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function validId(id) {
  return /^[1-9]\d*$/.test(id);
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ service: 'analysis-service', status: 'ok', database: 'ok' });
  } catch (error) {
    console.error('Analysis health check failed:', error.message);
    res.status(503).json({ service: 'analysis-service', status: 'degraded', database: 'unavailable' });
  }
});

app.post('/analyses', async (req, res) => {
  const cvId = Number(req.body?.cvId);
  const jdId = Number(req.body?.jdId);
  if (!Number.isInteger(cvId) || cvId <= 0 || !Number.isInteger(jdId) || jdId <= 0) {
    return res.status(400).json({ error: 'INVALID_ANALYSIS_INPUT', message: 'cvId và jdId phải là số nguyên dương' });
  }

  let analysisId;
  try {
    const created = await pool.query(
      'INSERT INTO analyses(cv_id,jd_id,status) VALUES($1,$2,$3) RETURNING id',
      [cvId, jdId, 'PENDING']
    );
    analysisId = created.rows[0].id;
    const [cv, jd] = await Promise.all([
      getWithRetry(`${cvBase}/cvs/${cvId}`),
      getWithRetry(`${jdBase}/jds/${jdId}`)
    ]);
    const result = buildAnalysis(cv, jd);
    if (process.env.OPENAI_API_KEY && result.missingRequirements.length) {
      result.recommendations = await createAiRecommendations(result, jd);
      result.recommendationProvider = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    }
    const saved = await pool.query(
      `UPDATE analyses SET status='COMPLETED', result=$1, updated_at=NOW()
       WHERE id=$2 RETURNING *`,
      [JSON.stringify(result), analysisId]
    );
    return res.status(201).json(saved.rows[0]);
  } catch (error) {
    const failed = error.status === 404 || (error.status >= 400 && error.status < 500)
      || error.code === 'AI_RECOMMENDATION_FAILED';
    if (analysisId && failed) {
      try {
        await pool.query(
          `UPDATE analyses SET status='FAILED', error=$1, updated_at=NOW() WHERE id=$2`,
          [error.message, analysisId]
        );
      } catch (updateError) {
        console.error('Failed to persist analysis failure:', updateError);
      }
    }
    console.error('Analysis creation failed:', error.message);
    const status = error.status || 503;
    return res.status(status).json({
      error: error.code === 'AI_RECOMMENDATION_FAILED'
        ? 'AI_RECOMMENDATION_FAILED'
        : status === 504
          ? 'UPSTREAM_TIMEOUT'
          : status === 404
            ? 'RELATED_RESOURCE_NOT_FOUND'
            : 'UPSTREAM_UNAVAILABLE',
      analysisId: analysisId || null,
      status: analysisId ? (failed ? 'FAILED' : 'PENDING') : undefined,
      message: error.code === 'AI_RECOMMENDATION_FAILED'
        ? 'Không thể tạo đề xuất bằng AI. Vui lòng kiểm tra cấu hình AI và thử lại.'
        : 'Không thể hoàn tất phân tích do dữ liệu liên quan hoặc service phụ thuộc không khả dụng.'
    });
  }
});

app.get('/analyses', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM analyses ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Analysis listing failed:', error.message);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

app.get('/analyses/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'INVALID_ANALYSIS_ID' });
  try {
    const result = await pool.query('SELECT * FROM analyses WHERE id=$1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'ANALYSIS_NOT_FOUND' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Analysis lookup failed:', error.message);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

app.get('/analyses/:id/skill-gaps', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'INVALID_ANALYSIS_ID' });
  try {
    const result = await pool.query('SELECT id,status,result FROM analyses WHERE id=$1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'ANALYSIS_NOT_FOUND' });
    if (result.rows[0].status !== 'COMPLETED') {
      return res.status(409).json({ error: 'ANALYSIS_NOT_COMPLETED', status: result.rows[0].status });
    }
    res.json({
      analysisId: result.rows[0].id,
      missingSkills: result.rows[0].result.missingSkills || [],
      missingRequirements: result.rows[0].result.missingRequirements || []
    });
  } catch (error) {
    console.error('Analysis skill gap lookup failed:', error.message);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

app.get('/analyses/:id/recommendations', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'INVALID_ANALYSIS_ID' });
  try {
    const result = await pool.query('SELECT id,status,result FROM analyses WHERE id=$1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'ANALYSIS_NOT_FOUND' });
    if (result.rows[0].status !== 'COMPLETED') {
      return res.status(409).json({ error: 'ANALYSIS_NOT_COMPLETED', status: result.rows[0].status });
    }
    res.json({
      analysisId: result.rows[0].id,
      recommendations: result.rows[0].result.recommendations || [],
      recommendationProvider: result.rows[0].result.recommendationProvider
    });
  } catch (error) {
    console.error('Analysis recommendations lookup failed:', error.message);
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

app.post('/analyses/:id/recommendations/more', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'INVALID_ANALYSIS_ID' });
  try {
    const existing = await pool.query('SELECT id,jd_id,status,result FROM analyses WHERE id=$1', [req.params.id]);
    if (!existing.rowCount) return res.status(404).json({ error: 'ANALYSIS_NOT_FOUND' });
    if (existing.rows[0].status !== 'COMPLETED') {
      return res.status(409).json({ error: 'ANALYSIS_NOT_COMPLETED', status: existing.rows[0].status });
    }
    const result = existing.rows[0].result;
    if (!result.missingRequirements?.length) {
      return res.status(409).json({ error: 'NO_SKILL_GAPS', message: 'CV đã đáp ứng các yêu cầu được trích xuất.' });
    }
    let additions;
    if (process.env.OPENAI_API_KEY) {
      const jd = await getWithRetry(`${jdBase}/jds/${existing.rows[0].jd_id}`);
      additions = await createAiRecommendations(result, jd, result.recommendations || [], true);
    } else {
      additions = buildMoreRecommendations(result.missingRequirements, result.recommendations || []);
    }
    if (!additions.length) {
      return res.status(409).json({
        error: 'NO_MORE_UNIQUE_RECOMMENDATIONS',
        message: 'Đã hiển thị các hướng đề xuất hiện có cho những yêu cầu còn thiếu.'
      });
    }
    result.recommendations = [...(result.recommendations || []), ...additions];
    if (process.env.OPENAI_API_KEY) result.recommendationProvider = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const saved = await pool.query(
      'UPDATE analyses SET result=$1, updated_at=NOW() WHERE id=$2 RETURNING id,result',
      [JSON.stringify(result), req.params.id]
    );
    return res.json({
      analysisId: saved.rows[0].id,
      added: additions,
      recommendations: saved.rows[0].result.recommendations,
      recommendationProvider: result.recommendationProvider
    });
  } catch (error) {
    console.error('Additional recommendation generation failed:', error);
    const status = error.status || (error.code === 'AI_RECOMMENDATION_FAILED' ? 502 : 503);
    return res.status(status).json({
      error: error.code === 'AI_RECOMMENDATION_FAILED'
        ? 'AI_RECOMMENDATION_FAILED'
        : status === 504
          ? 'UPSTREAM_TIMEOUT'
          : 'UPSTREAM_UNAVAILABLE',
      message: error.code === 'AI_RECOMMENDATION_FAILED'
        ? 'Không thể tạo thêm đề xuất bằng AI. Vui lòng thử lại sau.'
        : 'Không thể tải dữ liệu JD hoặc service phụ thuộc đang không khả dụng.'
    });
  }
});

init().then(() => app.listen(port, () => console.log(`Analysis Service listening on ${port}`)))
  .catch(error => {
    console.error('Analysis DB init failed', error);
    process.exit(1);
  });
