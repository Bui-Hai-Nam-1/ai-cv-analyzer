const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnalysis } = require('../src/matching');

test('match score weights required skills and uses structured CV data', () => {
  const result = buildAnalysis({
    content: 'Built APIs using Node.js.',
    parsed_data: { technicalSkills: [{ skills: ['PostgreSQL'] }] }
  }, {
    content: 'Node.js PostgreSQL Docker',
    extracted_requirements: [
      { name: 'Node.js', category: 'technical_skills', priority: 'must_have', type: 'skill' },
      { name: 'PostgreSQL', category: 'technical_skills', priority: 'must_have', type: 'skill' },
      { name: 'Docker', category: 'technical_skills', priority: 'nice_to_have', type: 'skill' }
    ]
  });

  assert.equal(result.matchScore, 80);
  assert.deepEqual(result.matchedSkills, ['Node.js', 'PostgreSQL']);
  assert.deepEqual(result.missingSkills, ['Docker']);
});

test('matching does not count a skill that appears only as part of another word', () => {
  const result = buildAnalysis({ content: 'I used JavaScript to build a web client.' }, {
    content: 'Java is required.',
    extracted_requirements: [
      { name: 'Java', category: 'technical_skills', priority: 'must_have', type: 'skill' }
    ]
  });

  assert.deepEqual(result.missingSkills, ['Java']);
});
