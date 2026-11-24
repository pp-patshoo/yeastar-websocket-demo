import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { config } from './config.ts';
import type { TunnelState } from '../shared/protocol.ts';

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const CONNECTED_RE = /Registered tunnel connection/i;
const MAX_LOG = 20;

export interface TunnelStatus {
  available: boolean;
  state: TunnelState;
  url?: string;
  error?: string;
  since?: number;
  log: string[];
}

/**
 * Runs `cloudflared tunnel --url <TUNNEL_TARGET>` (a Cloudflare Quick Tunnel) as a child process.
 * TUNNEL_TARGET points at Caddy's login-protected tunnel port, never at the app directly.
 * Events: status(TunnelStatus)
 */
class TunnelManager extends EventEmitter {
  private proc?: ChildProcess;
  private wanted = false;
  private state: TunnelState = config.tunnelTarget ? 'stopped' : 'unavailable';
  private url?: string;
  private error?: string;
  private since?: number;
  private log: string[] = [];
  private retryMs = 5000;
  private retryTimer?: NodeJS.Timeout;

  get available() {
    return !!config.tunnelTarget;
  }

  status(): TunnelStatus {
    return { available: this.available, state: this.state, url: this.url, error: this.error, since: this.since, log: this.log };
  }

  isOnline() {
    return this.state === 'online';
  }

  start() {
    if (!this.available) return;
    this.wanted = true;
    if (this.proc) return;
    clearTimeout(this.retryTimer);
    this.spawn();
  }

  async stop() {
    this.wanted = false;
    clearTimeout(this.retryTimer);
    const p = this.proc;
    if (p) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          p.kill('SIGKILL');
          resolve();
        }, 5000);
        p.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
        p.kill('SIGTERM');
      });
    }
    this.set({ state: this.available ? 'stopped' : 'unavailable', url: undefined, error: undefined, since: undefined });
  }

  private set(patch: Partial<Pick<TunnelStatus, 'state' | 'url' | 'error' | 'since'>>) {
    Object.assign(this, patch);
    this.emit('status', this.status());
  }

  private addLog(line: string) {
    this.log = [...this.log, line].slice(-MAX_LOG);
  }

  private spawn() {
    this.set({ state: 'starting', url: undefined, error: undefined, since: Date.now() });
    this.addLog(`$ cloudflared tunnel --no-autoupdate --url ${config.tunnelTarget}`);
    const p = spawn(config.cloudflaredBin, ['tunnel', '--no-autoupdate', '--url', config.tunnelTarget], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc = p;

    const onData = (chunk: Buffer) => {
      for (const raw of chunk.toString().split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        // cloudflared prints the URL inside a box of "|" characters; keep the log readable.
        this.addLog(line.replace(/^\|\s*|\s*\|$/g, '').slice(0, 300));
        const m = line.match(URL_RE);
        if (m && !this.url) this.set({ url: m[0] });
        if (CONNECTED_RE.test(line) && this.state !== 'online' && this.url) {
          this.retryMs = 5000;
          console.log(`[tunnel] online: ${this.url}`);
          this.set({ state: 'online', since: Date.now() });
        } else this.emit('status', this.status());
      }
    };
    p.stdout?.on('data', onData);
    p.stderr?.on('data', onData);

    p.on('error', (err: NodeJS.ErrnoException) => {
      const msg = err.code === 'ENOENT' ? `ไม่พบโปรแกรม cloudflared (${config.cloudflaredBin})` : err.message;
      this.addLog(msg);
      this.wanted = false; // missing binary: retrying won't help
      this.proc = undefined;
      this.set({ state: 'error', error: msg, url: undefined });
    });

    p.on('exit', (code, signal) => {
      if (this.proc !== p) return;
      this.proc = undefined;
      if (!this.wanted) return;
      // Died on its own while still wanted: report and retry with backoff.
      const msg = `cloudflared หยุดทำงาน (${signal ?? `exit ${code}`}) — จะลองใหม่ใน ${Math.round(this.retryMs / 1000)} วินาที`;
      console.warn(`[tunnel] ${msg}`);
      this.addLog(msg);
      this.set({ state: 'error', error: msg, url: undefined });
      this.retryTimer = setTimeout(() => this.wanted && this.spawn(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 60_000);
    });
  }
}

export const tunnel = new TunnelManager();
