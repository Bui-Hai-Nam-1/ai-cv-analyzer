
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const port = process.env.PORT || 8080;

app.get('/health', (_req, res) => {
  res.json({ service: 'api-gateway', status: 'ok' });
});

function route(path, target, upstreamBasePath) {
  app.use(path, createProxyMiddleware({
    target,
    changeOrigin: true,

    pathRewrite: (requestPath) =>
      `${upstreamBasePath}${requestPath === '/' ? '' : requestPath}`,

    proxyTimeout: 10000,
    timeout: 10000,

    on: {
      error: (err, req, res) => {
        console.error(`[Gateway] Proxy error: ${err.message}`);

        if (res.headersSent) {
          res.destroy();
          return;
        }

        if (res.destroyed) return;

        res.writeHead(503, {
          'Content-Type': 'application/json; charset=utf-8'
        });

        res.end(JSON.stringify({
          error: 'UPSTREAM_UNAVAILABLE',
          message: 'Dịch vụ phía sau hiện không khả dụng'
        }));
      }
    }
  }));
}

route(
  '/api/cvs',
  process.env.CV_SERVICE_URL || 'http://localhost:3001',
  '/cvs'
);

route(
  '/api/jds',
  process.env.JD_SERVICE_URL || 'http://localhost:3002',
  '/jds'
);

route(
  '/api/analyses',
  process.env.ANALYSIS_SERVICE_URL || 'http://localhost:3003',
  '/analyses'
);

app.listen(port, () => {
  console.log(`API Gateway listening on ${port}`);
});
