const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeHeuristically, normalizeCv } = require('../src/cv-processing');

test('heuristic extraction fills contact details and categorized sections', () => {
  const result = analyzeHeuristically([
    'Nguyen Van A',
    'Email: a@example.com',
    'Technical Skills: Node.js, PostgreSQL, Docker',
    'Education:',
    'University of Example - Computer Science',
    'Experience:',
    'Backend Intern at Example Co'
  ].join('\n'));

  assert.equal(result.personalInformation.fullName, 'Nguyen Van A');
  assert.equal(result.personalInformation.email, 'a@example.com');
  assert.deepEqual(result.technicalSkills[0].skills, ['Node.js', 'PostgreSQL', 'Docker']);
  assert.equal(result.education[0].institution, 'University of Example - Computer Science');
  assert.equal(result.experience[0].description, 'Backend Intern at Example Co');
});

test('normalization returns all public sections and discards malformed values', () => {
  const result = normalizeCv({
    personalInformation: { fullName: '  Jane Doe  ' },
    education: [{ institution: 'Unknown', degree: 'Bachelor' }],
    technicalSkills: [
      { category: 'Database', skills: 'PostgreSQL' },
      { category: 'Development Framework', skills: ['Node.js', '  ', 'Docker'] }
    ],
    projects: ['Portfolio']
  });

  assert.equal(result.personalInformation.fullName, 'Jane Doe');
  assert.equal(result.education[0].institution, null);
  assert.deepEqual(result.technicalSkills, [
    { category: 'Database', skills: ['PostgreSQL'] },
    { category: 'Development Framework', skills: ['Node.js', 'Docker'] }
  ]);
  assert.deepEqual(result.projects, [{ name: 'Portfolio', description: null, url: null, technologies: [] }]);
  assert.deepEqual(result.languages, []);
});
