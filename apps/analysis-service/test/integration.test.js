
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
         'Node.js Express PostgreSQL REST API Git JavaScript. Built a backend application using Node.js and Express.',
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
      content: `Required: Node.js. ${'x'.repeat(100)} Preferred: Docker. ${'x'.repeat(100)} REST API Git JavaScript`,
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

  // 5. Kiểm tra kết quả Weighted Skill Matching
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
  assert.ok(Array.isArray(result.requiredSkills));
  assert.ok(Array.isArray(result.preferredSkills));
  assert.ok(Array.isArray(result.skillDetails));
  assert.ok(Array.isArray(result.recommendations));

  // Kiểm tra phân loại mức độ ưu tiên
  assert.ok(result.requiredSkills.includes('node.js'));
  assert.ok(result.preferredSkills.includes('docker'));

  const nodeSkill = result.skillDetails.find(
    item => item.skill === 'node.js'
  );

  const dockerSkill = result.skillDetails.find(
    item => item.skill === 'docker'
  );

  assert.ok(nodeSkill);
  assert.equal(nodeSkill.priority, 'REQUIRED');
  assert.equal(nodeSkill.weight, 2);
  assert.equal(nodeSkill.status, 'MATCHED');

  assert.ok(dockerSkill);
  assert.equal(dockerSkill.priority, 'PREFERRED');
  assert.equal(dockerSkill.weight, 1.5);
  assert.equal(dockerSkill.status, 'MISSING');

  // Kiểm tra công thức tính điểm
  assert.ok(result.scoreBreakdown);
  assert.equal(result.scoreBreakdown.matchedWeight, 5);
    assert.equal(result.scoreBreakdown.totalWeight, 6.5);
  assert.equal(
    result.scoreBreakdown.formula,
    'matchedWeight / totalWeight * 100'
  );

  assert.equal(
    result.matchScore,
    Math.round((5 / 6.5) * 100)
    );

  // 6. Lấy lại kết quả từ database
  const savedAnalysis = await request(
    `/api/analyses/${analysis.data.id}`
  );

  assert.equal(savedAnalysis.status, 200);
  assert.equal(savedAnalysis.data.status, 'COMPLETED');
  assert.equal(savedAnalysis.data.id, analysis.data.id);

  assert.deepEqual(
    savedAnalysis.data.result,
    result,
    'Saved analysis must preserve the complete weighted result'
  );
});
