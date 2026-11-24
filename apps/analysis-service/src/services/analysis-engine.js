
const SKILL_KEYWORDS = [
  'javascript', 'typescript', 'node.js', 'express',
  'react', 'angular', 'vue', 'python', 'java',
  'c#', 'c++', 'php', 'go', 'rust',
  'postgresql', 'mysql', 'mongodb', 'redis', 'sql',
  'rest api', 'graphql', 'docker', 'kubernetes',
  'git', 'github', 'linux', 'html', 'css',
  'tailwind', 'bootstrap', 'aws', 'azure',
  'firebase', 'machine learning', 'data analysis',
  'communication', 'problem solving'
];

const REQUIRED_MARKERS =
  /\b(required|mandatory|must[- ]have|essential)\b|bắt buộc|cần có|yêu cầu bắt buộc/i;

const PREFERRED_MARKERS =
  /\b(preferred|nice[- ]to[- ]have|desirable)\b|ưu tiên|khuyến khích/i;

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsSkill(text, skill) {
  const escaped = escapeRegex(skill);

  const pattern = new RegExp(
    `(^|[^a-z0-9+#])${escaped}($|[^a-z0-9+#])`,
    'i'
  );

  return pattern.test(String(text || '').toLowerCase());
}

function extractTerms(text) {
  return SKILL_KEYWORDS.filter(skill =>
    containsSkill(text, skill)
  );
}

// Determine the importance of a skill based on nearby JD wording.

function getSkillPriority(text, skill) {
  const normalized = String(text || '').toLowerCase();
  const normalizedSkill = String(skill || '').toLowerCase();

  if (!normalizedSkill) {
    return { priority: 'NORMAL', weight: 1 };
  }

  const markers = [
    { regex: REQUIRED_MARKERS, priority: 'REQUIRED', weight: 2 },
    { regex: PREFERRED_MARKERS, priority: 'PREFERRED', weight: 1.5 }
  ];

  let skillIndex = normalized.indexOf(normalizedSkill);

  if (skillIndex === -1) {
    return { priority: 'NORMAL', weight: 1 };
  }

  let closest = null;
  let closestDistance = Infinity;

  while (skillIndex !== -1) {
    for (const marker of markers) {
      const regex = new RegExp(marker.regex.source, 'gi');
      let match;

      while ((match = regex.exec(normalized)) !== null) {
        const markerEnd = match.index + match[0].length;
        const skillEnd = skillIndex + normalizedSkill.length;

        const distance = markerEnd <= skillIndex
          ? skillIndex - markerEnd
          : match.index >= skillEnd
            ? match.index - skillEnd
            : 0;

        if (distance <= 80 && distance < closestDistance) {
          closestDistance = distance;
          closest = marker;
        }
      }
    }

    skillIndex = normalized.indexOf(
      normalizedSkill,
      skillIndex + normalizedSkill.length
    );
  }

  return closest
    ? {
        priority: closest.priority,
        weight: closest.weight
      }
    : { priority: 'NORMAL', weight: 1 };
}


function buildAnalysis(cv, jd) {
  const cvText = String(cv?.content || '');
  const jdText = String(jd?.content || '');

  const requiredSkills = extractTerms(jdText);

  const matchedSkills = requiredSkills.filter(skill =>
    containsSkill(cvText, skill)
  );

  const missingSkills = requiredSkills.filter(skill =>
    !matchedSkills.includes(skill)
  );

  const skillDetails = requiredSkills.map(skill => {
    const importance = getSkillPriority(jdText, skill);
    const matched = matchedSkills.includes(skill);

    return {
      skill,
      status: matched ? 'MATCHED' : 'MISSING',
      priority: importance.priority,
      weight: importance.weight
    };
  });

  const totalWeight = skillDetails.reduce(
    (sum, item) => sum + item.weight,
    0
  );

  const matchedWeight = skillDetails
    .filter(item => item.status === 'MATCHED')
    .reduce((sum, item) => sum + item.weight, 0);

  const matchScore = totalWeight > 0
    ? Math.round((matchedWeight / totalWeight) * 100)
    : 0;
  // Analyze matching results by priority
  const priorityBreakdown = {};

  for (const priority of ['REQUIRED', 'PREFERRED', 'NORMAL']) {
    const skills = skillDetails.filter(
      item => item.priority === priority
    );

    const matched = skills.filter(
      item => item.status === 'MATCHED'
    ).length;

    const total = skills.length;

    priorityBreakdown[priority.toLowerCase()] = {
      matched,
      total,
      score: total > 0
        ? Math.round((matched / total) * 100)
        : 0
    };
  }

  // Explain strengths based on skills found in the CV
  const strengths = matchedSkills.map(skill =>
    `CV có đề cập đến kỹ năng ${skill}, phù hợp với yêu cầu trong JD.`
  );

  // Explain weaknesses based on missing skills
  const weaknesses = missingSkills.map(skill => {
    const detail = skillDetails.find(
      item => item.skill === skill
    );

    return {
      skill,
      priority: detail.priority,
      explanation: detail.priority === 'REQUIRED'
        ? `CV chưa thể hiện kỹ năng ${skill}, trong khi đây là yêu cầu bắt buộc.`
        : detail.priority === 'PREFERRED'
          ? `CV chưa thể hiện kỹ năng ${skill}, đây là kỹ năng được ưu tiên.`
          : `CV chưa thể hiện kỹ năng ${skill} được đề cập trong JD.`
    };
  });
  const recommendations = missingSkills.slice(0, 5).map(skill => {
    const detail = skillDetails.find(item => item.skill === skill);

    if (detail.priority === 'REQUIRED') {
      return `Kỹ năng ${skill} là yêu cầu bắt buộc. Hãy bổ sung kiến thức và dự án thực hành phù hợp trước khi ứng tuyển.`;
    }

    if (detail.priority === 'PREFERRED') {
      return `Kỹ năng ${skill} được ưu tiên trong JD. Bạn có thể cải thiện lợi thế ứng tuyển bằng cách học và thực hành kỹ năng này.`;
    }

    return `Nếu bạn thực sự có kỹ năng ${skill}, hãy bổ sung minh chứng cụ thể vào CV; nếu chưa có, cân nhắc học và thực hành kỹ năng này.`;
  });

  return {
    matchScore,
    matchedSkills,
    missingSkills,
    strengths,
    weaknesses,
    requiredSkills: skillDetails
      .filter(item => item.priority === 'REQUIRED')
      .map(item => item.skill),
    preferredSkills: skillDetails
      .filter(item => item.priority === 'PREFERRED')
      .map(item => item.skill),
    skillDetails,
    scoreBreakdown: {
        matchedWeight,
        totalWeight,
        formula: 'matchedWeight / totalWeight * 100',
        byPriority: priorityBreakdown
    },
    recommendations,
    note: 'Match Score sử dụng phương pháp so khớp kỹ năng có trọng số dựa trên mức độ ưu tiên được nhận diện trong JD. Đây là thuật toán MVP dựa trên từ khóa, không phải đánh giá AI chuyên sâu.'
  };
}

module.exports = {
  SKILL_KEYWORDS,
  extractTerms,
  containsSkill,
  getSkillPriority,
  buildAnalysis
};
