const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('node:path');

const sectionNames = {
  personalInformation: ['personal information', 'contact', 'profile', 'about me', 'thong tin ca nhan'],
  education: ['education', 'academic background', 'hoc van'],
  technicalSkills: ['technical skills', 'skills', 'technical stack', 'ky nang', 'ky nang chuyen mon'],
  projects: ['projects', 'personal projects', 'du an'],
  experience: ['experience', 'work experience', 'employment', 'kinh nghiem'],
  certifications: ['certifications', 'certificates', 'chung chi'],
  languages: ['languages', 'ngon ngu']
};

function emptyCv() {
  return {
    personalInformation: { fullName: null, email: null, phone: null, location: null, linkedin: null, website: null },
    education: [],
    technicalSkills: [],
    projects: [],
    experience: [],
    certifications: [],
    languages: []
  };
}

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeCv(value) {
  const source = value && typeof value === 'object' ? value : {};
  const personal = source.personalInformation && typeof source.personalInformation === 'object'
    ? source.personalInformation
    : {};
  const data = emptyCv();
  for (const key of Object.keys(data.personalInformation)) {
    data.personalInformation[key] = cleanString(personal[key]);
  }

  data.education = normalizeItems(source.education, ['institution', 'degree', 'fieldOfStudy', 'startDate', 'endDate', 'details']);
  data.technicalSkills = (Array.isArray(source.technicalSkills) ? source.technicalSkills : [])
    .map(item => {
      if (typeof item === 'string') return { category: 'Other', skills: [item] };
      return {
        category: cleanString(item?.category) || 'Other',
        skills: normalizeStrings(item?.skills)
      };
    }).filter(item => item.skills.length);
  data.projects = normalizeItems(source.projects, ['name', 'description', 'url'], ['technologies']);
  data.experience = normalizeItems(source.experience, ['company', 'position', 'startDate', 'endDate', 'description'], ['technologies']);
  data.certifications = normalizeItems(source.certifications, ['name', 'issuer', 'date']);
  data.languages = normalizeItems(source.languages, ['language', 'proficiency']);
  return data;
}

function normalizeStrings(items) {
  return (Array.isArray(items) ? items : []).map(cleanString).filter(Boolean);
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
    const header = line.match(/^([^:]{2,50}):(?:\s*(.*))?$/);
    const normalizedHeader = (header ? header[1] : line).toLowerCase().replace(/[^a-z ]/g, '').trim();
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
  if (skills.length) result.technicalSkills = [{ category: 'Other', skills }];
  result.education = sections.education.map(details => ({ institution: details, degree: null, fieldOfStudy: null, startDate: null, endDate: null, details }));
  result.projects = sections.projects.map(line => ({ name: line, description: line, url: null, technologies: [] }));
  result.experience = sections.experience.map(description => ({ company: null, position: null, startDate: null, endDate: null, description, technologies: [] }));
  result.certifications = sections.certifications.map(name => ({ name, issuer: null, date: null }));
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
    const normalized = text.replace(/\u0000/g, '').trim();
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
  const timeout = setTimeout(() => controller.abort(), 20000);
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
            content: 'Extract only facts explicitly present in the CV. Never infer or invent information. Respond as JSON with personalInformation {fullName,email,phone,location,linkedin,website}; education array of {institution,degree,fieldOfStudy,startDate,endDate,details}; technicalSkills array of {category,skills}; projects array of {name,description,technologies,url}; experience array of {company,position,startDate,endDate,description,technologies}; certifications array of {name,issuer,date}; languages array of {language,proficiency}. Use null for unknown personal fields and empty arrays for unknown lists.'
          },
          { role: 'user', content: text }
        ]
      })
    });
    if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI provider returned no analysis');
    return normalizeCv(JSON.parse(content));
  } catch (cause) {
    const error = new Error('CV AI analysis failed', { cause });
    error.code = 'AI_ANALYSIS_FAILED';
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeCv(text) {
  if (!process.env.OPENAI_API_KEY) {
    return { data: analyzeHeuristically(text), provider: 'heuristic' };
  }
  return { data: await analyzeWithAi(text), provider: process.env.OPENAI_MODEL || 'gpt-4o-mini' };
}

module.exports = { analyzeCv, analyzeHeuristically, extractText, normalizeCv };
