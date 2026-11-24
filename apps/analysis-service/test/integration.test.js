
const test = require('node:test');
const assert = require('node:assert/strict');

const BASE_URL = 'http://localhost:8080';

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await response.json();

  return {
    status: response.status,
    data,
  };
}

test('Integration: Gateway → CV → JD → Analysis', async () => {
  // 1. Kiểm tra API Gateway
  const health = await request('/health');

  assert.equal(health.status, 200);
  assert.equal(health.data.service, 'api-gateway');
  assert.equal(health.data.status, 'ok');

  // 2. Tạo CV
  const cv = await request('/api/cvs', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Integration Test User',
      email: `integration-${Date.now()}@example.com`,
      content:
        'Node.js Express PostgreSQL REST API Git JavaScript',
    }),
  });

  assert.equal(cv.status, 201);
  assert.ok(cv.data.id);

  // 3. Tạo Job Description
  const jd = await request('/api/jds', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Integration Backend Intern',
      company: 'Test Company',
      content:
        'Node.js Express PostgreSQL REST API Git Docker',
    }),
  });

  assert.equal(jd.status, 201);
  assert.ok(jd.data.id);

  // 4. Gửi yêu cầu phân tích qua API Gateway
  const analysis = await request('/api/analyses', {
    method: 'POST',
    body: JSON.stringify({
      cvId: cv.data.id,
      jdId: jd.data.id,
    }),
  });

  assert.equal(analysis.status, 201);
  assert.equal(analysis.data.status, 'COMPLETED');

  // 5. Kiểm tra kết quả phân tích
  assert.ok(analysis.data.id);
  assert.ok(analysis.data.result);

  const result = analysis.data.result;

  assert.ok(
    typeof result.matchScore === 'number',
    'Match score must be a number'
  );

  assert.ok(result.matchScore >= 0);
  assert.ok(result.matchScore <= 100);

  assert.ok(Array.isArray(result.matchedSkills));
  assert.ok(Array.isArray(result.missingSkills));
  assert.ok(Array.isArray(result.recommendations));

  // 6. Lấy lại kết quả bằng Analysis ID
  const savedAnalysis = await request(
    `/api/analyses/${analysis.data.id}`
  );

  assert.equal(savedAnalysis.status, 200);
  assert.equal(savedAnalysis.data.status, 'COMPLETED');
  assert.equal(savedAnalysis.data.id, analysis.data.id);

  assert.equal(
    savedAnalysis.data.result.matchScore,
    result.matchScore
  );
});
