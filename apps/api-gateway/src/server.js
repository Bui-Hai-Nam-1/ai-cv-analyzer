const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const port = process.env.PORT || 8080;

app.get('/health', (_req, res) => res.json({ service: 'api-gateway', status: 'ok' }));

function route(path, target, upstreamBasePath) {
  app.use(path, createProxyMiddleware({
    target,
    changeOrigin: true,
    // Express removes the mounted prefix before proxy middleware receives req.url.
    pathRewrite: (requestPath) => `${upstreamBasePath}${requestPath === '/' ? '' : requestPath}`, 
    proxyTimeout: 5000,
    timeout: 5000,
    on: {
      error: (_err, _req, res) => {
        if (!res.headersSent) res.status(503).json({ error: 'UPSTREAM_UNAVAILABLE', message: 'Dịch vụ phía sau hiện không khả dụng' });
      }
    }
  }));
}

route('/api/cvs', process.env.CV_SERVICE_URL || 'http://localhost:3001', '/cvs');
route('/api/jds', process.env.JD_SERVICE_URL || 'http://localhost:3002', '/jds');
route('/api/analyses', process.env.ANALYSIS_SERVICE_URL || 'http://localhost:3003', '/analyses');

app.listen(port, () => console.log(`API Gateway listening on ${port}`));
