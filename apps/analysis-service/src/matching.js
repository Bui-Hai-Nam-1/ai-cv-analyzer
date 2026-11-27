const categories = ['technical_skills', 'soft_skills', 'experience', 'education', 'language', 'other'];
const genericSkillWords = new Set([
  'a', 'an', 'the', 'and', 'or', 'with', 'for', 'from', 'in', 'of', 'to', 'at', 'by',
  'required', 'requirement', 'requirements', 'experience', 'expertise', 'expert',
  'proficiency', 'proficient', 'knowledge', 'understanding', 'strong', 'good',
  'excellent', 'working', 'familiar', 'familiarity', 'programming', 'skill', 'skills', 'related',
  'relevant', 'database', 'development', 'developer', 'framework', 'frameworks',
  'technology', 'technologies', 'containerization', 'degree', 'years', 'year', 'minimum',
  'least', 'plus', 'preferred', 'nice', 'have', 'must', 'should', 'is', 'are', 's'
]);
const skillAliases = new Map([
  ['nodejs', 'node.js'], ['reactjs', 'react'], ['react.js', 'react'],
  ['postgres', 'postgresql'], ['postgresql', 'postgresql'],
  ['k8s', 'kubernetes'], ['js', 'javascript'], ['ts', 'typescript'],
  ['apis', 'api'], ['microservices', 'microservice']
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(token => token.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
    .map(token => skillAliases.get(token) || token)
    .join(' ');
}

function inferCategory(name) {
  const value = normalizeText(name);
  if (/\b(english|vietnamese|language|ielts|toeic|toefl|japanese|korean|chinese|french|german)\b/.test(value)) return 'language';
  if (/\b(years?|experience|experienced|senior|junior|internship)\b/.test(value)) return 'experience';
  if (/\b(degree|bachelor|master|university|education|graduate|gpa)\b/.test(value)) return 'education';
  if (/\b(communication|teamwork|leadership|problem solving|adaptability|collaboration|negotiation|soft skills)\b/.test(value)) return 'soft_skills';
  if (/\b(python|java|javascript|typescript|node|react|angular|vue|postgresql|mysql|mongodb|sql|docker|kubernetes|aws|azure|git|api|cloud|fastapi|spring|net|c\+\+|golang|ruby|php|linux|redis|kafka|graphql|terraform|machine learning|data analysis)\b/.test(value)) {
    return 'technical_skills';
  }
  return 'other';
}

function normalizeRequirements(items) {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    const source = typeof item === 'string' ? { name: item } : item && typeof item === 'object' ? item : {};
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    if (!name) return null;
    const category = categories.includes(source.category) ? source.category : inferCategory(name);
    const priorityText = `${source.priority || ''} ${name}`;
    return {
      name,
      category,
      priority: source.priority === 'nice_to_have' || /\b(nice[\s-]*to[\s-]*have|preferred|bonus|optional)\b/i.test(priorityText)
        ? 'nice_to_have'
        : 'must_have',
      type: source.type === 'skill' || ['technical_skills', 'soft_skills', 'language'].includes(category)
        ? 'skill'
        : 'requirement',
      description: typeof source.description === 'string' ? source.description : null
    };
  }).filter(Boolean);
}

function extractRequirements(content) {
  const preferred = /\b(nice[\s-]*to[\s-]*have|preferred|bonus|optional|advantageous)\b/i;
  const result = [];
  let sectionPriority = 'must_have';
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, '');
    if (!line) continue;
    const section = line.replace(/:$/, '').trim();
    if (/^(?:requirements?|qualifications?|must[\s-]*have)$/i.test(section)) {
      sectionPriority = 'must_have';
      continue;
    }
    if (/^(?:nice[\s-]*to[\s-]*have|preferred)$/i.test(section)) {
      sectionPriority = 'nice_to_have';
      continue;
    }
    if (/^(?:responsibilities|about the role|what you(?:'|’)ll do|benefits?)$/i.test(section)) continue;
    const priority = preferred.test(line) ? 'nice_to_have' : sectionPriority;
    for (const name of line.replace(preferred, '').split(/[;,|]/).map(value => value.trim()).filter(Boolean)) {
      if (/^(?:requirements?|qualifications?|must[\s-]*have)$/i.test(name)) continue;
      const category = inferCategory(name);
      result.push({
        name,
        category,
        priority,
        type: ['technical_skills', 'soft_skills', 'language'].includes(category) ? 'skill' : 'requirement',
        description: null
      });
    }
  }
  return normalizeRequirements(result);
}

function requirementMatches(cvText, requirement) {
  const normalizedRequirement = normalizeText(requirement.name);
  if (!normalizedRequirement) return false;
  const normalizedCv = normalizeText(cvText);
  if (` ${normalizedCv} `.includes(` ${normalizedRequirement} `)) return true;

  const keyTerms = normalizedRequirement.split(' ').filter(token => !genericSkillWords.has(token));
  if (!keyTerms.length) return false;
  const cvTerms = new Set(normalizedCv.split(' '));
  return keyTerms.every(token => cvTerms.has(token));
}

function findEvidence(cv, requirement) {
  const lines = String(cv.content || '').split(/[\r\n;|]+|(?<=[!?])\s+|(?<=\.)\s+/).map(line => line.trim()).filter(Boolean);
  const line = lines.find(value => requirementMatches(value, requirement));
  if (line) return line.slice(0, 220);
  return 'Được nhận diện trong dữ liệu CV đã phân tích.';
}

function learningResources(requirement) {
  const query = requirement.name;
  return [
    {
      label: 'Khóa học phù hợp',
      type: 'course_search',
      region: 'local',
      url: `https://www.google.com/search?q=${encodeURIComponent(`${query} khóa học Việt Nam`)}`
    },
    {
      label: 'Video hướng dẫn',
      type: 'video_search',
      region: 'local',
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${query} hướng dẫn`)}`
    },
    {
      label: 'Khóa học quốc tế',
      type: 'course_search',
      region: 'international',
      url: `https://www.google.com/search?q=${encodeURIComponent(`${query} online course`)}`
    }
  ];
}

function recommendationFor(requirement, title, action, source = 'rule-based') {
  return {
    requirement: requirement.name,
    category: requirement.category,
    priority: requirement.priority,
    title,
    action,
    source,
    resources: learningResources(requirement)
  };
}

function buildRuleBasedRecommendations(missingRequirements) {
  return missingRequirements.slice(0, 20).map(requirement => {
    const name = requirement.name;
    const action = requirement.category === 'experience'
      ? `Thực hiện một dự án nhỏ có tiêu chí nghiệm thu rõ ràng để tạo bằng chứng thực hành cho yêu cầu "${name}".`
      : requirement.category === 'soft_skills'
        ? `Luyện tập "${name}" qua tình huống công việc thực tế, ghi lại ví dụ cụ thể và chuẩn bị cách trình bày trong phỏng vấn.`
        : requirement.category === 'education'
          ? `Đối chiếu yêu cầu "${name}" với bằng cấp hiện có; nếu còn thiếu kiến thức nền, học theo giáo trình liên quan và bổ sung minh chứng phù hợp.`
          : `Học nền tảng "${name}", sau đó áp dụng vào một bài tập hoặc dự án nhỏ và ghi lại kết quả có thể kiểm chứng.`;
    return recommendationFor(requirement, `Lộ trình học ${name}`, action);
  });
}

function buildMoreRecommendations(missingRequirements, existingRecommendations) {
  const existing = Array.isArray(existingRecommendations) ? existingRecommendations : [];
  const titleSet = new Set(existing.map(item => normalizeText(typeof item === 'string' ? item : item?.title)));
  const countByRequirement = new Map();
  for (const item of existing) {
    const name = typeof item === 'string' ? '' : normalizeText(item?.requirement);
    if (name) countByRequirement.set(name, (countByRequirement.get(name) || 0) + 1);
  }

  const additions = [];
  const variants = [
    (name) => [`Dự án thực hành ${name}`, `Xây dựng một sản phẩm nhỏ sử dụng "${name}", chia thành các bước học, triển khai và tự kiểm thử.`],
    (name) => [`Bài tập ứng dụng ${name}`, `Luyện "${name}" bằng các bài tập tăng dần độ khó; lưu lại lời giải và giải thích lựa chọn kỹ thuật.`],
    (name) => [`Ôn phỏng vấn về ${name}`, `Ôn các khái niệm cốt lõi của "${name}", thực hành câu hỏi tình huống và chuẩn bị ví dụ minh chứng.`],
    (name) => [`Portfolio với ${name}`, `Bổ sung "${name}" vào một dự án portfolio có README, hướng dẫn chạy và kết quả kiểm thử.`]
  ];

  for (const requirement of missingRequirements) {
    const key = normalizeText(requirement.name);
    const variantIndex = countByRequirement.get(key) || 0;
    if (variantIndex >= variants.length) continue;
    const [title, action] = variants[variantIndex](requirement.name);
    if (!titleSet.has(normalizeText(title))) {
      additions.push(recommendationFor(requirement, title, action));
      titleSet.add(normalizeText(title));
    }
    if (additions.length >= 5) break;
  }
  return additions;
}

function buildAnalysis(cv, jd) {
  const requirements = normalizeRequirements(jd.extracted_requirements);
  const activeRequirements = requirements.length ? requirements : extractRequirements(jd.content);
  const cvText = [cv.content, JSON.stringify(cv.parsed_data || {})].join(' ');
  const matchedRequirements = [];
  const missingRequirements = [];
  for (const requirement of activeRequirements) {
    if (requirementMatches(cvText, requirement)) {
      matchedRequirements.push({ ...requirement, evidence: findEvidence(cv, requirement) });
    } else {
      missingRequirements.push(requirement);
    }
  }
  const weight = requirement => requirement.priority === 'nice_to_have' ? 1 : 2;
  const totalWeight = activeRequirements.reduce((sum, item) => sum + weight(item), 0);
  const matchedWeight = matchedRequirements.reduce((sum, item) => sum + weight(item), 0);
  const mustHaveRequirements = activeRequirements.filter(item => item.priority !== 'nice_to_have');
  const matchedMustHaveCount = matchedRequirements.filter(item => item.priority !== 'nice_to_have').length;
  const breakdown = Object.fromEntries(categories.map(category => {
    const categoryRequirements = activeRequirements.filter(item => item.category === category);
    const categoryMatched = matchedRequirements.filter(item => item.category === category);
    const categoryTotalWeight = categoryRequirements.reduce((sum, item) => sum + weight(item), 0);
    const categoryMatchedWeight = categoryMatched.reduce((sum, item) => sum + weight(item), 0);
    return [category, {
      total: categoryRequirements.length,
      matched: categoryMatched.length,
      score: categoryTotalWeight ? Math.round(categoryMatchedWeight / categoryTotalWeight * 100) : null
    }];
  }));
  return {
    matchScore: totalWeight ? Math.round(matchedWeight / totalWeight * 100) : 0,
    mustHaveScore: mustHaveRequirements.length
      ? Math.round(matchedMustHaveCount / mustHaveRequirements.length * 100)
      : null,
    matchedMustHaveCount,
    totalMustHaveCount: mustHaveRequirements.length,
    totalRequirements: activeRequirements.length,
    matchedSkills: matchedRequirements.filter(item => item.type === 'skill').map(item => item.name),
    missingSkills: missingRequirements.filter(item => item.type === 'skill').map(item => item.name),
    matchedRequirements,
    missingRequirements,
    breakdown,
    recommendations: buildRuleBasedRecommendations(missingRequirements),
    recommendationProvider: 'rule-based',
    note: requirements.length
      ? 'Điểm phù hợp có trọng số: must-have gấp đôi nice-to-have. Mỗi mục đã đáp ứng đều có dẫn chứng từ CV.'
      : 'JD chưa có yêu cầu cấu trúc; hệ thống tạm đối chiếu các dòng và cụm yêu cầu đọc được trong nội dung.'
  };
}

module.exports = {
  buildAnalysis,
  buildMoreRecommendations,
  buildRuleBasedRecommendations,
  extractRequirements,
  learningResources,
  normalizeRequirements,
  normalizeText,
  requirementMatches
};
