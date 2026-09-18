const http = require('node:http');
// Keep this listener private; ngrok supplies the public HTTPS endpoint.
http.createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/gateway-health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"service":"ai-gateway"}'); return;
  }
  if (path.startsWith('/internal/')) {
    res.writeHead(404); res.end(); return;
  }
  const port = path.startsWith('/api/cctv/') ? 8001 : 8000;
  const upstream = http.request({
    hostname: '127.0.0.1', port, path: req.url, method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${port}` },
  }, reply => {
    res.writeHead(reply.statusCode, reply.headers);
    reply.pipe(res);
    reply.on('error', () => res.destroy());
  });
  upstream.on('error', () => {
    if (res.headersSent) return res.destroy();
    const origin = req.headers.origin;
    const allowed = ['https://smart-attendance-web.vercel.app', 'http://localhost:5173', 'http://127.0.0.1:5173'];
    if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: `AI service on port ${port} is unavailable` }));
  });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}).listen(8010, '127.0.0.1', () => console.log('AI gateway ready on 127.0.0.1:8010'));
