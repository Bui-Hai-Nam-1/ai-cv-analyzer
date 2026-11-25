const test = require('node:test');
const assert = require('node:assert/strict');
const { extractHeuristically, normalizeRequirements } = require('../src/jd-processing');

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
