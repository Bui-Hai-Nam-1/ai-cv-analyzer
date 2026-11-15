const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '1mb' }));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = process.env.PORT || 3002;

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS job_descriptions (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, company TEXT,
    content TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}
app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({service:'jd-service', status:'ok', database:'ok'}); }
  catch { res.status(503).json({service:'jd-service', status:'degraded', database:'unavailable'}); }
});
app.post('/jds', async (req, res) => {
  const { title, company, content } = req.body || {};
  if (!title || !content || String(content).trim().length < 20) {
    return res.status(400).json({ error:'INVALID_JD', message:'title và content là bắt buộc; content phải có ít nhất 20 ký tự' });
  }
  try {
    const result = await pool.query('INSERT INTO job_descriptions(title,company,content) VALUES($1,$2,$3) RETURNING *', [title,company || null,content]);
    res.status(201).json(result.rows[0]);
  } catch { res.status(500).json({error:'INTERNAL_ERROR'}); }
});
app.get('/jds', async (_req, res) => {
  try { const r = await pool.query('SELECT * FROM job_descriptions ORDER BY id DESC'); res.json(r.rows); }
  catch { res.status(500).json({error:'INTERNAL_ERROR'}); }
});
app.get('/jds/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM job_descriptions WHERE id=$1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({error:'JD_NOT_FOUND'});
    res.json(r.rows[0]);
  } catch { res.status(500).json({error:'INTERNAL_ERROR'}); }
});
app.delete('/jds/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM job_descriptions WHERE id=$1 RETURNING id', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({error:'JD_NOT_FOUND'});
    res.status(204).send();
  } catch { res.status(500).json({error:'INTERNAL_ERROR'}); }
});
init().then(() => app.listen(port, () => console.log(`JD Service listening on ${port}`)))
  .catch(e => { console.error('JD DB init failed', e); process.exit(1); });
