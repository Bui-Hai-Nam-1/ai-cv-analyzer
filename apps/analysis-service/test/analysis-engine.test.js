
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractTerms,
  containsSkill,
  buildAnalysis
} = require('../src/services/analysis-engine');

test('Extracts skills from text', () => {
  const text = 'We need JavaScript, Node.js, Docker and PostgreSQL';

  const skills = extractTerms(text);

  assert.deepEqual(skills, [
    'javascript',
    'node.js',
    'postgresql',
    'docker'
  ]);
});

test('Does not match a skill inside a longer unrelated word', () => {
  assert.equal(containsSkill('I use NoSQL databases', 'sql'), false);
  assert.equal(containsSkill('I use JavaScript', 'java'), false);
});

test('Matches skills separated by punctuation', () => {
  assert.equal(containsSkill('Node.js, Express!', 'node.js'), true);
  assert.equal(containsSkill('Docker; PostgreSQL.', 'docker'), true);
});

test('Calculates match score correctly', () => {
  const cv = {
    content: 'JavaScript Node.js Express PostgreSQL REST API Git'
  };

  const jd = {
    content: 'JavaScript Node.js Express PostgreSQL REST API Git Docker'
  };

  const result = buildAnalysis(cv, jd);

  assert.equal(result.matchScore, 86);
  assert.equal(result.matchedSkills.length, 6);
  assert.deepEqual(result.missingSkills, ['docker']);
});

test('Returns zero score when JD has no recognized skills', () => {
  const cv = {
    content: 'I have experience in software development'
  };

  const jd = {
    content: 'We are looking for a motivated candidate'
  };

  const result = buildAnalysis(cv, jd);

  assert.equal(result.matchScore, 0);
  assert.deepEqual(result.matchedSkills, []);
  assert.deepEqual(result.missingSkills, []);
});

test('Generates recommendations for missing skills', () => {
  const cv = {
    content: 'JavaScript Node.js'
  };

  const jd = {
    content: 'JavaScript Node.js Docker'
  };

  const result = buildAnalysis(cv, jd);

  assert.deepEqual(result.missingSkills, ['docker']);
  assert.equal(result.recommendations.length, 1);
  assert.match(result.recommendations[0], /docker/);
});

test('Does not invent skills that are not in the JD', () => {
  const cv = {
    content: 'JavaScript Python Docker'
  };

  const jd = {
    content: 'JavaScript Node.js'
  };

  const result = buildAnalysis(cv, jd);

  assert.deepEqual(result.matchedSkills, ['javascript']);
  assert.deepEqual(result.missingSkills, ['node.js']);
  assert.equal(result.matchScore, 50);
});
