const express = require('express');

const { pool, initDatabase } = require('./db');
const analysisRoutes = require('./routes/analysis-routes');

const app = express();
const port = process.env.PORT || 3003;

app.use(express.json({ limit: '1mb' }));

// Health check.
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');

    return res.json({
      service: 'analysis-service',
      status: 'ok',
      database: 'ok'
    });

  } catch {
    return res.status(503).json({
      service: 'analysis-service',
      status: 'degraded',
      database: 'unavailable'
    });
  }
});

// Analysis APIs.
app.use('/analyses', analysisRoutes);

// Khởi động service.
async function startServer() {
  try {
    await initDatabase();

    app.listen(port, () => {
      console.log(`Analysis Service listening on ${port}`);
    });

  } catch (error) {
    console.error('Analysis DB init failed:', error);
    process.exit(1);
  }
}

startServer();