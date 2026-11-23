const SKILL_KEYWORDS = [
  'javascript',
  'typescript',
  'node.js',
  'express',
  'react',
  'angular',
  'vue',
  'python',
  'java',
  'c#',
  'c++',
  'php',
  'go',
  'rust',
  'postgresql',
  'mysql',
  'mongodb',
  'redis',
  'sql',
  'rest api',
  'graphql',
  'docker',
  'kubernetes',
  'git',
  'github',
  'linux',
  'html',
  'css',
  'tailwind',
  'bootstrap',
  'aws',
  'azure',
  'firebase',
  'machine learning',
  'data analysis',
  'communication',
  'problem solving'
];

// Escape ký tự đặc biệt để tạo regular expression an toàn.
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Kiểm tra kỹ năng có xuất hiện trong văn bản hay không.
function containsSkill(text, skill) {
  const escaped = escapeRegex(skill);

  const pattern = new RegExp(
    `(^|[^a-z0-9+#])${escaped}($|[^a-z0-9+#])`,
    'i'
  );

  return pattern.test(String(text || '').toLowerCase());
}

// Trích xuất danh sách kỹ năng từ văn bản.
function extractTerms(text) {
  return SKILL_KEYWORDS.filter(skill =>
    containsSkill(text, skill)
  );
}

// Phân tích CV so với Job Description.
function buildAnalysis(cv, jd) {
  const cvText = String(cv.content || '');
  const jdText = String(jd.content || '');

  const requiredSkills = extractTerms(jdText);

  const matchedSkills = requiredSkills.filter(skill =>
    containsSkill(cvText, skill)
  );

  const missingSkills = requiredSkills.filter(skill =>
    !matchedSkills.includes(skill)
  );

  const matchScore = requiredSkills.length > 0
    ? Math.round(
        (matchedSkills.length / requiredSkills.length) * 100
      )
    : 0;

  const recommendations = missingSkills.slice(0, 5).map(skill =>
    `Nếu bạn thực sự có kỹ năng ${skill}, hãy bổ sung minh chứng cụ thể vào CV; nếu chưa có, cân nhắc học và thực hành kỹ năng này.`
  );

  return {
    matchScore,
    matchedSkills,
    missingSkills,
    recommendations,
    note: 'Điểm số MVP dựa trên so khớp danh sách kỹ năng và từ khóa, không phải đánh giá AI chuyên sâu.'
  };
}

module.exports = {
  SKILL_KEYWORDS,
  extractTerms,
  containsSkill,
  buildAnalysis
};