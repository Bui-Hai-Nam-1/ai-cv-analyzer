const categories = ['technical_skills', 'soft_skills', 'experience', 'education', 'language', 'other'];
const genericSkillWords = new Set([
  'a', 'an', 'the', 'and', 'or', 'with', 'for', 'from', 'in', 'of', 'to',
  'required', 'requirement', 'requirements', 'experience', 'expertise', 'expert',
  'proficiency', 'proficient', 'knowledge', 'understanding', 'strong', 'good',
  'excellent', 'working', 'familiar', 'familiarity', 'skill', 'skills', 'related',
  'relevant', 'database', 'development', 'developer', 'framework', 'frameworks',
  'technology', 'technologies', 'containerization'
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(token => token.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
    .join(' ');
}

function normalizeRequirements(items) {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    const source = typeof item === 'string' ? { name: item } : item && typeof item === 'object' ? item : {};
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    if (!name) return null;
    return {
      name,
      category: categories.includes(source.category) ? source.category : 'other',
      priority: source.priority === 'nice_to_have' ? 'nice_to_have' : 'must_have',
      type: source.type === 'skill' ? 'skill' : 'requirement',
      description: typeof source.description === 'string' ? source.description : null
    };
  }).filter(Boolean);
}

function extractRequirements(content) {
  const stopWords = new Set([
    'and', 'or', 'the', 'with', 'for', 'from', 'have', 'has', 'will', 'you', 'your',
    'this', 'that', 'are', 'our', 'who', 'can', 'such', 'all', 'job', 'role', 'work',
    'years', 'year', 'experience', 'required', 'requirements', 'skills', 'skill', 'must'
  ]);
  const terms = String(content || '').match(/[a-z][a-z0-9+#.-]{1,}/gi) || [];
  return [...new Set(terms.map(term => term.trim()).filter(term => term.length > 2 && !stopWords.has(term.toLowerCase())))]
    .map(name => ({
      name,
      category: 'technical_skills',
      priority: 'must_have',
      type: 'skill',
      description: null
    }));
}

function requirementMatches(cvText, requirement) {
  const normalizedRequirement = normalizeText(requirement.name);
  if (!normalizedRequirement) return false;
  const normalizedCv = ` ${normalizeText(cvText)} `;
  if (normalizedCv.includes(` ${normalizedRequirement} `)) return true;
  if (requirement.type !== 'skill') return false;
  const keyTerms = normalizedRequirement.split(' ').filter(token => !genericSkillWords.has(token));
  if (!keyTerms.length) return false;
  const matchedTerms = keyTerms.filter(token => normalizedCv.includes(` ${token} `)).length;
  return matchedTerms >= Math.ceil(keyTerms.length / 2);
}

function buildAnalysis(cv, jd) {
  const requirements = normalizeRequirements(jd.extracted_requirements);
  const activeRequirements = requirements.length ? requirements : extractRequirements(jd.content);
  const cvText = [
    cv.content,
    JSON.stringify(cv.parsed_data || {})
  ].join(' ');
  const matchedRequirements = [];
  const missingRequirements = [];
  for (const requirement of activeRequirements) {
    (requirementMatches(cvText, requirement) ? matchedRequirements : missingRequirements).push(requirement);
  }
  const weight = requirement => requirement.priority === 'nice_to_have' ? 1 : 2;
  const totalWeight = activeRequirements.reduce((sum, item) => sum + weight(item), 0);
  const matchedWeight = matchedRequirements.reduce((sum, item) => sum + weight(item), 0);
  const breakdown = Object.fromEntries(categories.map(category => {
    const categoryRequirements = activeRequirements.filter(item => item.category === category);
    const categoryMatched = categoryRequirements.filter(item => requirementMatches(cvText, item));
    return [category, {
      total: categoryRequirements.length,
      matched: categoryMatched.length,
      score: categoryRequirements.length ? Math.round(categoryMatched.length / categoryRequirements.length * 100) : null
    }];
  }));
  return {
    matchScore: totalWeight ? Math.round(matchedWeight / totalWeight * 100) : 0,
    matchedSkills: matchedRequirements.filter(item => item.type === 'skill').map(item => item.name),
    missingSkills: missingRequirements.filter(item => item.type === 'skill').map(item => item.name),
    matchedRequirements,
    missingRequirements,
    breakdown,
    recommendations: missingRequirements.slice(0, 5).map(item =>
      item.description
        ? `Bổ sung minh chứng cho "${item.name}": ${item.description}`
        : `Bổ sung minh chứng phù hợp cho "${item.name}" trong CV hoặc rèn luyện yêu cầu này.`
    ),
    recommendationProvider: 'rule-based',
    note: requirements.length
      ? 'Điểm số tính theo các yêu cầu được trích xuất; must-have có trọng số cao gấp đôi nice-to-have.'
      : 'JD cũ chưa có dữ liệu yêu cầu cấu trúc; điểm số tạm tính bằng đối chiếu từ khóa trong nội dung.'
  };
}

module.exports = { buildAnalysis, extractRequirements, normalizeRequirements, normalizeText, requirementMatches };
