const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('node:path');

const sectionNames = {
  personalInformation: ['personal information', 'contact', 'profile', 'about me', 'thong tin ca nhan'],
  education: ['education', 'academic background', 'hoc van'],
  technicalSkills: ['technical skills', 'technical skill', 'skills', 'skill', 'technical stack', 'ky nang', 'ky nang chuyen mon'],
  projects: ['projects', 'personal projects', 'du an'],
  experience: ['experience', 'work experience', 'employment', 'kinh nghiem'],
  certifications: ['certifications', 'certificates', 'certification', 'certificate', 'chung chi'],
  awards: ['awards', 'honors', 'honours', 'achievements', 'danh hieu va giai thuong', 'giai thuong'],
  languages: ['languages', 'ngon ngu']
};
const softSkillNames = [
  'communication', 'negotiation', 'presentation', 'teamwork', 'leadership',
  'problem solving', 'critical thinking', 'time management', 'adaptability',
  'conflict resolution', 'stakeholder management', 'customer service',
  'giao tiep', 'dam phan', 'thuyet trinh', 'lam viec nhom', 'lanh dao',
  'giai quyet van de', 'tu duy phan bien', 'quan ly thoi gian', 'thich nghi'
];

function normalizeLabel(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/đ/g, 'd').replace(/[^a-z0-9+#.]+/g, ' ').trim();
}

function isSoftSkill(skill, category = '') {
  const normalizedCategory = normalizeLabel(category);
  const normalizedSkill = normalizeLabel(skill);
  return normalizedCategory.includes('soft skill') || normalizedCategory.includes('ky nang mem')
    || softSkillNames.some(name => normalizedSkill.includes(name));
}

function emptyCv() {
  return {
    personalInformation: { fullName: null, email: null, phone: null, location: null, linkedin: null, website: null },
    education: [],
    technicalSkills: [],
    softSkills: [],
    projects: [],
    experience: [],
    certifications: [],
    awards: [],
    languages: []
  };
}

function cleanString(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const cleaned = value.trim();
  return /^(unknown|not specified|not provided|n\/?a|none|null)$/i.test(cleaned) ? null : cleaned;
}

function normalizeEvidenceDate(value, sourceText) {
  const date = cleanString(value);
  if (!date || !sourceText) return date;
  const source = normalizeLabel(sourceText);
  const candidate = normalizeLabel(date);
  if (candidate && source.includes(candidate)) return date;
  const evidencedYears = [...new Set((date.match(/(?:19|20)\d{2}/g) || []).filter(year => source.includes(year)))];
  return evidencedYears.length ? evidencedYears.join('–') : null;
}

function awardsFromText(sourceText) {
  const awardCue = /(?:hoc bong|giai thuong|giai nhat|giai nhi|giai ba|dat giai|nhan vien xuat sac|nhan vien cong hien|scholarship|award|employee of the year|honou?r)/i;
  return String(sourceText || '').split(/\r?\n/)
    .map(line => line.trim().replace(/^[-*•●]\s*/, ''))
    .filter(line => {
      const normalized = normalizeLabel(line);
      return awardCue.test(normalized)
        && !/^(?:danh hieu va giai thuong|giai thuong|awards?|honou?rs?|achievements?)$/.test(normalized);
    })
    .map(title => {
      const years = [...new Set(title.match(/(?:19|20)\d{2}/g) || [])];
      const awardTitle = title.replace(/(?:19|20)\d{2}/g, '').replace(/(?:\s+và\s+|\s+and\s+)/gi, ' ').replace(/\s+/g, ' ').replace(/[\s,;:.-]+$/, '');
      return {
        title: cleanString(awardTitle),
        issuer: null,
        date: years.join('–') || null,
        details: null
      };
    }).filter(item => item.title);
}

function normalizeCv(value, sourceText = '') {
  const source = value && typeof value === 'object' ? value : {};
  const personal = source.personalInformation && typeof source.personalInformation === 'object'
    ? source.personalInformation
    : {};
  const data = emptyCv();
  for (const key of Object.keys(data.personalInformation)) {
    data.personalInformation[key] = cleanString(personal[key]);
  }

  data.education = normalizeItems(source.education, ['institution', 'degree', 'fieldOfStudy', 'startDate', 'endDate', 'details']);
  data.projects = normalizeItems(source.projects, ['name', 'description', 'url'], ['technologies']);
  data.experience = normalizeItems(source.experience, ['company', 'position', 'startDate', 'endDate', 'description'], ['technologies']);
  data.certifications = normalizeItems(source.certifications, ['name', 'issuer', 'date']);
  data.awards = normalizeItems(source.awards, ['title', 'issuer', 'date', 'details']);
  data.languages = normalizeItems(source.languages, ['language', 'proficiency']);
  for (const award of awardsFromText(sourceText)) {
    const title = normalizeLabel(award.title);
    const alreadyExtracted = data.awards.some(item => {
      const existingTitle = normalizeLabel(item.title);
      return existingTitle && (title.includes(existingTitle) || existingTitle.includes(title));
    });
    if (!alreadyExtracted) data.awards.push(award);
  }
  for (const education of data.education) {
    education.startDate = normalizeEvidenceDate(education.startDate, sourceText);
    education.endDate = normalizeEvidenceDate(education.endDate, sourceText);
  }
  for (const experience of data.experience) {
    experience.startDate = normalizeEvidenceDate(experience.startDate, sourceText);
    experience.endDate = normalizeEvidenceDate(experience.endDate, sourceText);
  }
  for (const item of [...data.certifications, ...data.awards]) {
    item.date = normalizeEvidenceDate(item.date, sourceText);
    if (!item.date && /^(?:19|20)\d{2}$/.test(item.issuer || '')) {
      item.date = normalizeEvidenceDate(item.issuer, sourceText);
      item.issuer = null;
    }
  }

  const technicalGroups = [];
  const softSkills = normalizeStrings(source.softSkills);
  for (const rawItem of Array.isArray(source.technicalSkills) ? source.technicalSkills : []) {
    const item = typeof rawItem === 'string' ? { category: 'Other', skills: [rawItem] } : rawItem || {};
    const category = cleanString(item.category) || 'Other';
    const skills = normalizeStrings(item.skills);
    const softCategory = isSoftSkill('', category);
    const technical = skills.filter(skill => !softCategory && !isSoftSkill(skill));
    softSkills.push(...skills.filter(skill => softCategory || isSoftSkill(skill)));
    if (technical.length) technicalGroups.push({ category, skills: technical });
  }

  const addEvidenceSkills = (category, skills) => {
    const items = normalizeStrings(skills).filter(skill => !isSoftSkill(skill));
    if (items.length) technicalGroups.push({ category, skills: items });
  };
  for (const item of data.experience) addEvidenceSkills('Kinh nghiệm', item.technologies);
  for (const item of data.projects) addEvidenceSkills('Dự án', item.technologies);
  for (const item of data.certifications) {
    const skills = (item.name || '').split(/[,;|/]/).map(value => value.trim()).filter(value => value && !/^\d{4}$/.test(value));
    addEvidenceSkills('Chứng chỉ', skills);
  }

  const seenTechnical = new Set();
  data.technicalSkills = technicalGroups.map(group => ({
    category: group.category,
    skills: group.skills.filter(skill => {
      const key = normalizeLabel(skill);
      if (!key || seenTechnical.has(key)) return false;
      seenTechnical.add(key);
      return true;
    })
  })).filter(group => group.skills.length);
  data.softSkills = [...new Set(softSkills.map(skill => cleanString(skill)).filter(Boolean))];
  return data;
}

function normalizeStrings(items) {
  const values = Array.isArray(items)
    ? items
    : typeof items === 'string' ? items.split(/[,;|]/) : [];
  return values.map(cleanString).filter(Boolean);
}

function normalizeItems(items, stringFields, arrayFields = []) {
  return (Array.isArray(items) ? items : []).map(item => {
    const source = typeof item === 'string'
      ? { [stringFields[0]]: item }
      : item && typeof item === 'object' ? item : {};
    const result = {};
    for (const field of stringFields) result[field] = cleanString(source[field]);
    for (const field of arrayFields) result[field] = normalizeStrings(source[field]);
    return result;
  }).filter(item => Object.values(item).some(value => Array.isArray(value) ? value.length : value));
}

function splitSections(text) {
  const lines = text.split(/\r?\n/);
  const result = Object.fromEntries(Object.keys(sectionNames).map(key => [key, []]));
  let activeSection = null;
  for (const rawLine of lines) {
    const line = rawLine.trim().replace(/^[-*•]\s*/, '');
    if (!line) continue;
    const header = line.match(/^([^:]{2,80}):(?:\s*(.*))?$/);
    const normalizedHeader = normalizeLabel(header ? header[1] : line);
    const match = Object.entries(sectionNames).find(([, names]) => names.includes(normalizedHeader));
    if (match) {
      activeSection = match[0];
      if (header?.[2]) result[activeSection].push(header[2].trim());
      continue;
    }
    if (header && activeSection) {
      activeSection = null;
    }
    if (activeSection) result[activeSection].push(line);
  }
  return result;
}

function analyzeHeuristically(text) {
  const result = emptyCv();
  const sections = splitSections(text);
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phone = text.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{7,10}/);
  const firstLine = text.split(/\r?\n/).map(line => line.trim()).find(Boolean);
  result.personalInformation.fullName = firstLine && firstLine.length < 100 ? firstLine : null;
  result.personalInformation.email = email ? email[0] : null;
  result.personalInformation.phone = phone ? phone[0].trim() : null;

  const skillLines = sections.technicalSkills.join(', ').split(/[,;|•\n]/).map(value => value.trim()).filter(Boolean);
  const skills = [...new Set(skillLines.flatMap(value => value.split(/\s{2,}/)).filter(value => value.length <= 60))];
  const technicalSkills = skills.filter(skill => !isSoftSkill(skill));
  result.softSkills = skills.filter(skill => isSoftSkill(skill));
  if (technicalSkills.length) result.technicalSkills = [{ category: 'Kỹ năng chuyên môn', skills: technicalSkills }];
  result.education = sections.education.map(details => ({ institution: details, degree: null, fieldOfStudy: null, startDate: null, endDate: null, details }));
  result.projects = sections.projects.map(line => ({ name: line, description: line, url: null, technologies: [] }));
  result.experience = sections.experience.map(description => ({ company: null, position: null, startDate: null, endDate: null, description, technologies: [] }));
  result.certifications = sections.certifications.map(name => ({ name, issuer: null, date: null }));
  result.awards = sections.awards.map(title => ({ title, issuer: null, date: null, details: null }));
  result.languages = sections.languages.map(language => ({ language, proficiency: null }));
  return normalizeCv(result);
}

async function extractText(buffer, fileName) {
  try {
    const extension = path.extname(fileName).toLowerCase();
    let text;
    if (extension === '.pdf') {
      const parsed = await pdfParse(buffer);
      text = parsed.text;
    } else if (extension === '.docx') {
      const parsed = await mammoth.extractRawText({ buffer });
      text = parsed.value;
    } else {
      const error = new Error('Unsupported file extension');
      error.code = 'UNSUPPORTED_FILE_TYPE';
      throw error;
    }
    const normalized = text.replace(/[\u0000\uE000-\uF8FF]/g, '').trim();
    if (!normalized) throw new Error('Document contains no readable text');
    return normalized;
  } catch (cause) {
    const error = new Error('Unable to parse uploaded CV', { cause });
    error.code = 'CV_PARSE_FAILED';
    throw error;
  }
}

async function analyzeWithAi(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.AI_TIMEOUT_MS || 180000));
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Carefully review the ENTIRE CV, not only a section titled Skills. Extract every explicitly stated fact from the profile, skills, work history and its descriptions, projects, education, certificates, awards, activities, and other sections. Never invent, infer, or omit evidence just because it appears outside the Skills section. Put programming languages, frameworks, libraries, databases, tools, platforms, methodologies, and domain-specific technical abilities in technicalSkills, grouped by category. Put communication, negotiation, presentation, teamwork, leadership, and other interpersonal abilities only in softSkills; never put soft skills in technicalSkills. Also identify technologies explicitly mentioned in experience/project descriptions and certificate names. Extract award or honor statements wherever they appear, including inside education or work-history details. Dates must match the CV exactly: do not add a month or day when only a year is given. Return JSON with personalInformation {fullName,email,phone,location,linkedin,website}; education array of {institution,degree,fieldOfStudy,startDate,endDate,details}; technicalSkills array of {category,skills}; softSkills array of strings; projects array of {name,description,technologies,url}; experience array of {company,position,startDate,endDate,description,technologies}; certifications array of {name,issuer,date}; awards array of {title,issuer,date,details}; languages array of {language,proficiency}. Preserve meaningful detail from descriptions. Use null for unknown scalar values and empty arrays for unknown lists. Do not classify awards or certificates as skills unless their names explicitly identify a skill or technology.'
          },
          { role: 'user', content: text }
        ]
      })
    });
    if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI provider returned no analysis');
    return normalizeCv(JSON.parse(content), text);
  } catch (cause) {
    const error = new Error('CV AI analysis failed', { cause });
    error.code = 'AI_ANALYSIS_FAILED';
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeCv(text) {
  const normalizedText = text.replace(/[\u0000\uE000-\uF8FF]/g, '').trim();
  if (!process.env.OPENAI_API_KEY) {
    return { data: analyzeHeuristically(normalizedText), provider: 'heuristic' };
  }
  return { data: await analyzeWithAi(normalizedText), provider: process.env.OPENAI_MODEL || 'gpt-4o-mini' };
}

module.exports = { analyzeCv, analyzeHeuristically, extractText, normalizeCv };
