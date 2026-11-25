const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const path = require('node:path');

const categories = ['technical_skills', 'soft_skills', 'experience', 'education', 'language', 'other'];

function classifyCategory(text) {
  const value = text.toLowerCase();
  if (/\b(english|vietnamese|language|ielts|toeic|japanese|korean|chinese)\b/.test(value)) return 'language';
  if (/\b(years?|experience|experienced|senior|junior|internship)\b/.test(value)) return 'experience';
  if (/\b(degree|bachelor|master|university|education|graduate|gpa)\b/.test(value)) return 'education';
  if (/\b(communication|teamwork|leadership|problem.solving|adaptability|collaboration|soft skills)\b/.test(value)) return 'soft_skills';
  if (/\b(skill|developer|programming|python|java|javascript|typescript|node|react|angular|vue|sql|database|docker|kubernetes|aws|azure|git|api|cloud|framework|fastapi|spring|\.net)\b/.test(value)) {
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
    const category = categories.includes(source.category) ? source.category : classifyCategory(name);
    const priority = ['nice_to_have', 'nice-to-have'].includes(String(source.priority).toLowerCase())
      ? 'nice_to_have'
      : 'must_have';
    const type = ['skill', 'requirement'].includes(source.type)
      ? source.type
      : ['technical_skills', 'soft_skills', 'language'].includes(category) ? 'skill' : 'requirement';
    return {
      name,
      category,
      priority,
      type,
      description: typeof source.description === 'string' ? source.description.trim() || null : null
    };
  }).filter(Boolean);
}

function extractHeuristically(content) {
  const lines = content.split(/\r?\n/).flatMap(line => {
    const clean = line.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, '');
    if (!clean) return [];
    const colon = clean.match(/^([^:]{2,40})\s*:\s*(.*)$/);
    const value = colon ? colon[1] : clean;
    const requirementText = colon ? colon[2] : value;
    const priority = colon && /\b(nice.to.have|preferred|bonus|optional)\b/i.test(colon[1])
      ? 'nice_to_have'
      : 'must_have';
    return requirementText.split(/[;,|]/).map(part => part.trim()).filter(Boolean)
      .map(name => ({ name, priority }));
  });
  const requirements = lines.map(({ name, priority }) => ({
    name,
    category: classifyCategory(name),
    priority: priority === 'nice_to_have' || /\b(nice.to.have|preferred|bonus|optional|plus|advantage)\b/i.test(name)
      ? 'nice_to_have'
      : 'must_have'
  }));
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
  const timer = setTimeout(() => controller.abort(), 20000);
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
            content: 'Extract explicit job requirements only. Return JSON: {"requirements":[{"name":"short requirement","category":"technical_skills|soft_skills|experience|education|language|other","priority":"must_have|nice_to_have","type":"skill|requirement","description":"optional detail or null"}]}. Classify explicit preferred/bonus/optional requirements as nice_to_have; classify other requirements as must_have. Do not invent requirements.'
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
