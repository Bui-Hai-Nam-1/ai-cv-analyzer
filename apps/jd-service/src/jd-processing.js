const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('node:path');

const categories = ['technical_skills', 'soft_skills', 'experience', 'education', 'language', 'other'];
const preferredPattern = /\b(nice[\s-]*to[\s-]*have|preferred|preferably|bonus|optional|optionally|advantageous|desired)\b/i;
const requirementHeadings = /^(?:requirements?|qualifications?|what you(?:'|’)ll bring|what we(?:'|’)re looking for|skills?|technical skills?|nice[\s-]*to[\s-]*have|must[\s-]*have|preferred qualifications?)$/i;

function classifyCategory(text) {
  const value = text.toLowerCase();
  if (/\b(english|vietnamese|language|ielts|toeic|toefl|japanese|korean|chinese|french|german)\b/.test(value)) return 'language';
  if (/\b(years?|experience|experienced|senior|junior|internship)\b/.test(value)) return 'experience';
  if (/\b(degree|bachelor|master|university|education|graduate|gpa)\b/.test(value)) return 'education';
  if (/\b(communication|teamwork|leadership|problem.solving|adaptability|collaboration|negotiation|critical thinking|time management|soft skills)\b/.test(value)) return 'soft_skills';
  if (/\b(skill|programming|python|java|javascript|typescript|node(?:\.js)?|react|angular|vue|postgres(?:ql)?|mysql|mongodb|sql|database|docker|kubernetes|aws|azure|git|api|cloud|framework|fastapi|spring|\.net|c\+\+|c#|golang|ruby|php|linux|redis|kafka|graphql|terraform|machine learning|data analysis)\b/.test(value)) {
    return 'technical_skills';
  }
  return 'other';
}

function normalizeRequirements(items) {
  if (!Array.isArray(items)) return [];
  const requirements = items.map(item => {
    const source = typeof item === 'string' ? { name: item } : item && typeof item === 'object' ? item : {};
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    if (!name) return null;
    const inferredCategory = classifyCategory(name);
    const category = inferredCategory !== 'other'
      ? inferredCategory
      : categories.includes(source.category) ? source.category : 'other';
    const priorityText = `${source.priority || ''} ${name} ${source.description || ''}`;
    const priority = ['nice_to_have', 'nice-to-have'].includes(String(source.priority).toLowerCase()) || preferredPattern.test(priorityText)
      ? 'nice_to_have'
      : 'must_have';
    const type = ['technical_skills', 'soft_skills', 'language'].includes(category)
      ? 'skill'
      : source.type === 'skill' ? 'skill' : 'requirement';
    return {
      name,
      category,
      priority,
      type,
      description: typeof source.description === 'string' ? source.description.trim() || null : null
    };
  }).filter(Boolean);
  const unique = new Map();
  for (const requirement of requirements) {
    const key = `${requirement.category}:${requirement.name.toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim()}`;
    const previous = unique.get(key);
    if (!previous || (previous.priority === 'nice_to_have' && requirement.priority === 'must_have')) {
      unique.set(key, requirement);
    }
  }
  return [...unique.values()];
}

function extractHeuristically(content) {
  let sectionPriority = 'must_have';
  const requirements = [];
  for (const line of String(content || '').split(/\r?\n/)) {
    const clean = line.trim().replace(/^#+\s*/, '').replace(/^(?:[-*•]|\d+[.)])\s*/, '');
    if (!clean) continue;
    const colon = clean.match(/^([^:]{2,50})\s*:\s*(.*)$/);
    const heading = colon ? colon[1].trim() : clean.replace(/:$/, '').trim();
    const body = colon ? colon[2].trim() : clean;
    if (requirementHeadings.test(heading)) {
      sectionPriority = preferredPattern.test(heading) ? 'nice_to_have' : 'must_have';
      if (!colon || !body) continue;
    } else if (colon && preferredPattern.test(heading)) {
      sectionPriority = 'nice_to_have';
    } else if (colon && /\b(must[\s-]*have|required|requirements?)\b/i.test(heading)) {
      sectionPriority = 'must_have';
    }
    if (/^(?:responsibilities|about the role|job description|what you(?:'|’)ll do|what we offer|benefits?)$/i.test(heading)) continue;
    const linePriority = preferredPattern.test(`${heading} ${body}`) ? 'nice_to_have' : sectionPriority;
    const cleanBody = body.replace(/\(?\b(nice[\s-]*to[\s-]*have|preferred|preferably|bonus|optional|advantageous|desired)\b\)?/ig, '').trim();
    for (const part of cleanBody.split(/[;,|]/).map(value => value.trim()).filter(Boolean)) {
      if (requirementHeadings.test(part) || part.length < 2) continue;
      requirements.push({ name: part, category: classifyCategory(part), priority: linePriority });
    }
  }
  return normalizeRequirements(requirements);
}

async function extractText(buffer, fileName) {
  const extension = path.extname(fileName).toLowerCase();
  try {
    let text;
    if (extension === '.txt') text = buffer.toString('utf8');
    else if (extension === '.pdf') text = (await pdfParse(buffer)).text;
    else if (extension === '.docx') text = (await mammoth.extractRawText({ buffer })).value;
    else {
      const error = new Error('Unsupported file extension');
      error.code = 'UNSUPPORTED_FILE_TYPE';
      throw error;
    }
    const normalized = text.replace(/\u0000/g, '').trim();
    if (!normalized) throw new Error('Document contains no readable text');
    return normalized;
  } catch (cause) {
    const error = new Error('Unable to parse uploaded JD', { cause });
    error.code = cause.code === 'UNSUPPORTED_FILE_TYPE' ? cause.code : 'JD_PARSE_FAILED';
    throw error;
  }
}

async function extractWithAi(content) {
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.AI_TIMEOUT_MS || 180000));
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Analyze the entire job description and extract each distinct, explicit candidate requirement. Ignore company marketing, benefits, responsibilities that are not qualifications, and section headings. Split lists of skills into one item per skill; preserve meaningful experience, education, language, soft-skill, and other constraints as requirements. Classify technical skills, soft skills, experience, education, language, and other requirements accurately. A requirement explicitly labelled preferred, nice-to-have, bonus, optional, or advantageous is nice_to_have; other explicit qualifications are must_have. Include a short verbatim context in description when useful; otherwise null. Do not infer or invent requirements. Return only JSON in this shape: {"requirements":[{"name":"concise requirement","category":"technical_skills|soft_skills|experience|education|language|other","priority":"must_have|nice_to_have","type":"skill|requirement","description":"short evidence from JD or null"}]}.'
          },
          { role: 'user', content }
        ]
      })
    });
    if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
    const payload = await response.json();
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}');
    if (!Array.isArray(parsed.requirements)) throw new Error('AI provider returned no requirements array');
    return normalizeRequirements(parsed.requirements);
  } catch (cause) {
    const error = new Error('JD AI analysis failed', { cause });
    error.code = 'JD_AI_ANALYSIS_FAILED';
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function analyzeJd(content) {
  if (!process.env.OPENAI_API_KEY) {
    return { requirements: extractHeuristically(content), provider: 'heuristic' };
  }
  return {
    requirements: await extractWithAi(content),
    provider: process.env.OPENAI_MODEL || 'gpt-4o-mini'
  };
}

module.exports = { analyzeJd, classifyCategory, extractHeuristically, extractText, normalizeRequirements };
