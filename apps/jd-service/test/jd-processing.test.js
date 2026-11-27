const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyCategory, extractHeuristically, normalizeRequirements } = require('../src/jd-processing');

test('heuristic extraction separates requirements and classifies categories', () => {
  const requirements = extractHeuristically([
    'Requirements: Node.js, PostgreSQL, Docker',
    'Nice to have: English communication'
  ].join('\n'));

  assert.deepEqual(requirements.slice(0, 3).map(item => item.name), ['Node.js', 'PostgreSQL', 'Docker']);
  assert.equal(requirements[0].category, 'technical_skills');
  assert.equal(requirements[3].category, 'language');
  assert.equal(requirements[3].priority, 'nice_to_have');
});

test('normalization applies supported priority and category defaults', () => {
  assert.deepEqual(normalizeRequirements([
    { name: 'Bachelor degree', priority: 'nice_to_have' },
    { description: 'missing name' }
  ]), [{
    name: 'Bachelor degree',
    category: 'education',
    priority: 'nice_to_have',
    type: 'requirement',
    description: null
  }]);
});

test('heuristic extraction carries a preferred section priority to its bullet list', () => {
  const requirements = extractHeuristically([
    'Requirements:',
    '- 3+ years of backend experience',
    '- Python, PostgreSQL',
    'Nice to have:',
    '- Docker',
    '- English communication'
  ].join('\n'));

  assert.deepEqual(requirements.map(item => [item.name, item.priority, item.category]), [
    ['3+ years of backend experience', 'must_have', 'experience'],
    ['Python', 'must_have', 'technical_skills'],
    ['PostgreSQL', 'must_have', 'technical_skills'],
    ['Docker', 'nice_to_have', 'technical_skills'],
    ['English communication', 'nice_to_have', 'language']
  ]);
});

test('JD category classification recognizes common technical and non-technical requirements', () => {
  assert.equal(classifyCategory('React, TypeScript, REST API'), 'technical_skills');
  assert.equal(classifyCategory('Excellent communication and teamwork'), 'soft_skills');
  assert.equal(classifyCategory('Bachelor degree in Computer Science'), 'education');
  assert.equal(classifyCategory('IELTS 6.5 or equivalent'), 'language');
  const english = normalizeRequirements([
    { name: 'English communication', category: 'other', type: 'requirement' }
  ])[0];
  assert.equal(english.category, 'language');
  assert.equal(english.type, 'skill');
});
