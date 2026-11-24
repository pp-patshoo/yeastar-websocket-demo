import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { config } from './config.ts';
import { dashboardHub } from './dashboardHub.ts';
import { ingest } from './ingest.ts';
import { apiRouter } from './routes/settings.ts';
import { settings } from './settingsStore.ts';
import { ingestUrlFor } from './network.ts';
import { apiRegistry } from './yeastarApi.ts';

const app = express();
app.use(express.json({ limit: '100kb' }));
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
  if (pathname === config.dashboardPath) dashboardHub.handleUpgrade(req, socket, head);
  else ingest.handleUpgrade(req, socket, head);
});

server.listen(config.port, () => {
  console.log(`[server] http://localhost:${config.port}`);
  for (const p of settings.pbxList)
    console.log(`[server] PBX "${p.name}" ${p.enabled ? '' : '(disabled) '}→ ${ingestUrlFor(p)} · ${p.sampleRate} Hz · API ${p.api ? 'set' : 'not set'}`);
  console.log(`[server] STT ${settings.ai.enabled ? 'on' : 'off'}`);
});

// Give Yeastar API tokens back on exit (a PBX allows only 8 valid tokens per application).
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    if (stopping) process.exit(1);
    stopping = true;
    await Promise.race([apiRegistry.revokeAll(), new Promise((r) => setTimeout(r, 3000))]);
    process.exit(0);
  });
