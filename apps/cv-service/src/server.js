const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '1mb' }));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = process.env.PORT || 3001;

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS cvs (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT,
    content TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}
app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({service:'cv-service', status:'ok', database:'ok'}); }
  catch { res.status(503).json({service:'cv-service', status:'degraded', database:'unavailable'}); }
});
app.post('/cvs', async (req, res) => {
  const { name, email, content } = req.body || {};
  if (!name || !content || String(content).trim().length < 20) {
    return res.status(400).json({ error:'INVALID_CV', message:'name và content là bắt buộc; content phải có ít nhất 20 ký tự' });
  }
  try {
    const result = await pool.query('INSERT INTO cvs(name,email,content) VALUES($1,$2,$3) RETURNING *', [name,email || null,content]);
    res.status(201).json(result.rows[0]);
  } catch (e) { res.status(500).json({error:'INTERNAL_ERROR'}); }
});
app.get('/cvs', async (_req, res) => {
  try { const r = await pool.query('SELECT * FROM cvs ORDER BY id DESC'); res.json(r.rows); }
  catch { res.status(500).json({error:'INTERNAL_ERROR'}); }
});
app.get('/cvs/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM cvs WHERE id=$1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({error:'CV_NOT_FOUND'});
    res.json(r.rows[0]);
  } catch { res.status(500).json({error:'INTERNAL_ERROR'}); }
});
app.delete('/cvs/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM cvs WHERE id=$1 RETURNING id', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({error:'CV_NOT_FOUND'});
    res.status(204).send();
  } catch { res.status(500).json({error:'INTERNAL_ERROR'}); }
});
init().then(() => app.listen(port, () => console.log(`CV Service listening on ${port}`)))
  .catch(e => { console.error('CV DB init failed', e); process.exit(1); });
