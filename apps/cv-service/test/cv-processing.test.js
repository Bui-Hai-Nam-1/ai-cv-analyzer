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

test('normalization separates soft skills and finds technical skills across CV evidence', () => {
  const result = normalizeCv({
    technicalSkills: [
      { category: 'Kỹ năng', skills: ['Kỹ năng giao tiếp', 'Python', 'Kỹ năng đàm phán'] },
      { category: 'Soft skills', skills: ['Teamwork'] }
    ],
    experience: [{ position: 'Developer', technologies: ['React', 'PostgreSQL'] }],
    projects: [{ name: 'API', technologies: ['Docker'] }],
    certifications: [{ name: 'AWS, SQL', issuer: 'Example', date: '2024' }],
    awards: [{ title: 'Nhân viên xuất sắc', issuer: 'Example', date: '2023' }]
  });

  assert.deepEqual(result.softSkills, ['Kỹ năng giao tiếp', 'Kỹ năng đàm phán', 'Teamwork']);
  assert.deepEqual(result.technicalSkills, [
    { category: 'Kỹ năng', skills: ['Python'] },
    { category: 'Kinh nghiệm', skills: ['React', 'PostgreSQL'] },
    { category: 'Dự án', skills: ['Docker'] },
    { category: 'Chứng chỉ', skills: ['AWS', 'SQL'] }
  ]);
  assert.equal(result.awards[0].title, 'Nhân viên xuất sắc');
});

test('heuristic extraction recognizes Vietnamese CV section headings', () => {
  const result = analyzeHeuristically([
    'Nguyen Van A',
    'Kỹ năng:',
    'Kỹ năng giao tiếp',
    'Python',
    'Chứng chỉ:',
    'AWS Certified Developer',
    'Danh hiệu và giải thưởng:',
    'Nhân viên xuất sắc năm 2024'
  ].join('\n'));

  assert.deepEqual(result.softSkills, ['Kỹ năng giao tiếp']);
  assert.deepEqual(result.technicalSkills[0].skills, ['Python']);
  assert.equal(result.certifications[0].name, 'AWS Certified Developer');
  assert.equal(result.awards[0].title, 'Nhân viên xuất sắc năm 2024');
});

test('normalization removes unsupported date precision and recovers certificate years', () => {
  const result = normalizeCv({
    education: [{ institution: 'Example University', startDate: '2014-08-24', endDate: '2017-08-24' }],
    experience: [{ company: 'Example Co', startDate: '2021-08-24', endDate: '2024-08-24' }],
    certifications: [{ name: 'AWS', issuer: '2018' }],
    awards: [{ title: 'Top performer', issuer: '2023' }]
  }, 'Education 2014-2017; experience 2021-2024; AWS 2018; Top performer 2023.');

  assert.equal(result.education[0].startDate, '2014');
  assert.equal(result.education[0].endDate, '2017');
  assert.equal(result.experience[0].startDate, '2021');
  assert.equal(result.experience[0].endDate, '2024');
  assert.deepEqual(result.certifications[0], { name: 'AWS', issuer: null, date: '2018' });
  assert.deepEqual(result.awards[0], { title: 'Top performer', issuer: null, date: '2023', details: null });
});

test('normalization captures award evidence found inside education details', () => {
  const result = normalizeCv({
    education: [{ institution: 'Example University', details: 'Đạt học bổng 2016 và 2017; đạt giải nhì nghiên cứu khoa học công nghệ.' }]
  }, 'Học vấn:\nĐạt học bổng 2016 và 2017\nĐạt giải nhì nghiên cứu khoa học công nghệ.');

  assert.deepEqual(result.awards, [
    { title: 'Đạt học bổng', issuer: null, date: '2016–2017', details: null },
    { title: 'Đạt giải nhì nghiên cứu khoa học công nghệ', issuer: null, date: null, details: null }
  ]);
});
