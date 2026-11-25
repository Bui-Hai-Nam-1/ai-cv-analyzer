const express = require('express');
const path = require('node:path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const port = process.env.PORT || 8080;

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_req, res) => res.json({ service: 'api-gateway', status: 'ok' }));

function route(path, target, upstreamBasePath) {
  app.use(path, createProxyMiddleware({
    target,
    changeOrigin: true,
    // Express removes the mounted prefix before proxy middleware receives req.url.
    pathRewrite: (requestPath) => `${upstreamBasePath}${requestPath === '/' ? '' : requestPath}`, 
    proxyTimeout: 30000,
    timeout: 30000,
    on: {
      error: (error, _req, res) => {
        if (!res.headersSent) {
          const timedOut = ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(error.code)
            || /timed?\s*out|timeout/i.test(error.message || '');
          res.status(timedOut ? 504 : 503).json({
            error: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
            message: timedOut
              ? 'Dịch vụ phía sau phản hồi quá thời gian cho phép.'
              : 'Dịch vụ phía sau hiện không khả dụng'
          });
        }
      }
    }
  }));
}

route('/api/cvs', process.env.CV_SERVICE_URL || 'http://localhost:3001', '/cvs');
route('/api/jds', process.env.JD_SERVICE_URL || 'http://localhost:3002', '/jds');
route('/api/analyses', process.env.ANALYSIS_SERVICE_URL || 'http://localhost:3003', '/analyses');
route('/api/analysis', process.env.ANALYSIS_SERVICE_URL || 'http://localhost:3003', '/analyses');

app.listen(port, () => console.log(`API Gateway listening on ${port}`));
