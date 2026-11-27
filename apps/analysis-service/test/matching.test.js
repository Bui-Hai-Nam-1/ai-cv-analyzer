const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnalysis, buildMoreRecommendations, buildRuleBasedRecommendations, requirementMatches } = require('../src/matching');

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
  assert.equal(result.mustHaveScore, 100);
  assert.deepEqual(result.matchedSkills, ['Node.js', 'PostgreSQL']);
  assert.deepEqual(result.missingSkills, ['Docker']);
  assert.match(result.matchedRequirements[0].evidence, /Node\.js/i);
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

test('matching recognizes a canonical skill inside an AI-expanded skill name', () => {
  const result = buildAnalysis({ content: 'I build APIs with Node.js and PostgreSQL.' }, {
    content: 'Node.js expertise and PostgreSQL database knowledge are required.',
    extracted_requirements: [
      { name: 'Node.js expertise', category: 'technical_skills', priority: 'must_have', type: 'skill' },
      { name: 'PostgreSQL database knowledge', category: 'technical_skills', priority: 'must_have', type: 'skill' }
    ]
  });

  assert.equal(result.matchScore, 100);
  assert.deepEqual(result.matchedSkills, ['Node.js expertise', 'PostgreSQL database knowledge']);
});

test('multi-skill requirements need evidence for every meaningful skill token', () => {
  assert.equal(requirementMatches('Built a service with Node.js.', {
    name: 'Node.js and React',
    category: 'technical_skills',
    priority: 'must_have',
    type: 'skill'
  }), false);
});

test('matching recognizes common plural forms without matching partial technology names', () => {
  assert.equal(requirementMatches('Designed and implemented REST APIs.', {
    name: 'REST API',
    category: 'technical_skills',
    priority: 'must_have',
    type: 'skill'
  }), true);
});

test('matching tolerates generic skill wording around a specific required technology', () => {
  assert.equal(requirementMatches('Python', {
    name: 'Programming skills in Python',
    category: 'technical_skills',
    priority: 'must_have',
    type: 'skill'
  }), true);
});

test('recommendation links prioritize local searches before international courses', () => {
  const recommendations = buildRuleBasedRecommendations([
    { name: 'Docker', category: 'technical_skills', priority: 'must_have', type: 'skill' },
    { name: 'English', category: 'language', priority: 'nice_to_have', type: 'skill' }
  ]);

  assert.equal(recommendations.length, 2);
  assert.equal(recommendations[0].requirement, 'Docker');
  assert.equal(recommendations[0].resources.length, 3);
  assert.equal(recommendations[0].resources[0].region, 'local');
  assert.match(new URL(recommendations[0].resources[0].url).searchParams.get('q'), /Việt Nam/);
  assert.equal(recommendations[0].resources[1].region, 'local');
  assert.match(recommendations[0].resources[1].url, /youtube\.com\/results/);
  assert.equal(recommendations[0].resources[2].region, 'international');
  assert.doesNotMatch(recommendations[0].resources.map(resource => resource.label).join(' '), /tiếng Việt/i);
  assert.match(recommendations[0].resources[0].url, /google\.com\/search/);
});

test('more recommendations avoid topics already suggested', () => {
  const gaps = [{ name: 'Docker', category: 'technical_skills', priority: 'must_have', type: 'skill' }];
  const initial = buildRuleBasedRecommendations(gaps);
  const more = buildMoreRecommendations(gaps, initial);

  assert.equal(more.length, 1);
  assert.notEqual(more[0].title, initial[0].title);
});
