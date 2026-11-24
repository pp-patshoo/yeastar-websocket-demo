import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { accessStatus, dashboardAllowed, initAccess, updateAccess, viaTunnel } from './access.ts';
import { config } from './config.ts';
import { dashboardHub } from './dashboardHub.ts';
import { ingest } from './ingest.ts';
import { ingestUrlFor } from './network.ts';
import { sendError } from './routes/pbx.ts';
import { apiRouter } from './routes/settings.ts';
import { AccessUpdateSchema, settings } from './settingsStore.ts';
import { tunnel } from './tunnel.ts';
import { apiRegistry } from './yeastarApi.ts';

const LAN_BLOCKED_HTML = `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>ปิดการเข้าจาก LAN</title><body style="font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px;line-height:1.6">
<h1 style="font-size:20px">ปิดการเข้า Dashboard ผ่าน LAN อยู่</h1>
<p>ผู้ดูแลตั้งให้เข้าได้เฉพาะผ่าน Cloudflare Tunnel — ใช้ URL ของ Tunnel แทน</p>
<p style="color:#666;font-size:14px">กู้คืน: ตั้ง <code>FORCE_LAN_DASHBOARD=1</code> ใน .env แล้วรัน <code>docker compose up -d</code></p></body></html>`;

const app = express();
app.disable('x-powered-by');

// Health check for Docker: never blocked, no details.
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// LAN dashboard switch (see server/access.ts). The PBX uses WebSocket upgrades, which don't pass here.
app.use((req, res, next) => {
  if (dashboardAllowed(req)) return next();
  res.status(403).type('html').send(LAN_BLOCKED_HTML);
});

app.use(express.json({ limit: '100kb' }));

app.get('/api/access', (req, res) => res.json({ ...accessStatus(), viewerViaTunnel: viaTunnel(req) }));
app.put('/api/access', async (req, res) => {
  try {
    const note = await updateAccess(req, AccessUpdateSchema.parse(req.body));
    res.json({ ...accessStatus(), viewerViaTunnel: viaTunnel(req), note });
  } catch (err) {
    sendError(res, err);
  }
});

app.use('/api', apiRouter);

// Serve the built dashboard (npm run build). In dev, Vite serves it on :5173 instead.
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  // SPA fallback so /settings/pbx etc. survive a page refresh.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(config.webDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) =>
    res.type('text').send('ยังไม่ได้ build หน้าเว็บ — รัน "npm run build" หรือใช้ "npm run dev" แล้วเปิด http://localhost:5173'),
  );
}

const server = http.createServer(app);

// One port, two WebSocket endpoints: /ui for the browser, everything else is the PBX.
// (The PBX may or may not keep the path from its configured URL, so we don't insist on /yeastar.)
server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname;
  if (pathname === config.dashboardPath) {
    if (!dashboardAllowed(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    dashboardHub.handleUpgrade(req, socket, head);
  } else ingest.handleUpgrade(req, socket, head);
});

// PBX-only port: plain HTTP gets 404, WebSocket upgrades go to the ingest only (never /ui).
if (config.ingestPort) {
  const ingestServer = http.createServer((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  });
  ingestServer.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname === config.dashboardPath) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    ingest.handleUpgrade(req, socket, head, true);
  });
  ingestServer.listen(config.ingestPort, () => console.log(`[server] PBX-only port :${config.ingestPort}`));
}

server.listen(config.port, () => {
  console.log(`[server] http://localhost:${config.port}${config.trustProxy ? ' (behind proxy)' : ''}`);
  for (const p of settings.pbxList)
    console.log(`[server] PBX "${p.name}" ${p.enabled ? '' : '(disabled) '}→ ${ingestUrlFor(p)} · ${p.sampleRate} Hz · API ${p.api ? 'set' : 'not set'}`);
  console.log(`[server] STT ${settings.ai.enabled ? 'on' : 'off'} · tunnel ${tunnel.available ? (settings.access.tunnelEnabled ? 'on' : 'off') : 'unavailable'}`);
  initAccess();
});

// On stop (docker stop sends SIGTERM): give Yeastar API tokens back (a PBX allows only 8 valid
// tokens per application) and stop cloudflared.
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`[server] ${sig}: shutting down`);
    await Promise.race([Promise.all([apiRegistry.revokeAll(), tunnel.stop()]), new Promise((r) => setTimeout(r, 8000))]);
    process.exit(0);
  });
