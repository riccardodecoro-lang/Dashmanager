import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export function startServer(cfg, bot) {
  const page = path.join(cfg.root, 'public', 'index.html');
  const token = process.env.DASHBOARD_TOKEN || '';
  const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(cfg.host);
  if (!isLocal && !token) throw new Error('Con HOST pubblico serve DASHBOARD_TOKEN, altrimenti chiunque può vendere le tue posizioni');

  const json = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(page).pipe(res);
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, bot.snapshot());

    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      if (token && req.headers['x-bot-token'] !== token) return json(res, 401, { error: 'token mancante o errato' });
      switch (url.pathname) {
        case '/api/pause': bot.pause(true); break;
        case '/api/resume': bot.pause(false); break;
        case '/api/sell-all': bot.sellAll(); break;
        case '/api/sell': bot.sellOne(url.searchParams.get('mint') || ''); break;
        default: return json(res, 404, { error: 'comando sconosciuto' });
      }
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'non trovato' });
  });
  server.listen(cfg.port, cfg.host, () => console.log(`Dashboard: http://${cfg.host}:${cfg.port}`));
  return server;
}
