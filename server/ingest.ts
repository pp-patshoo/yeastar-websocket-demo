import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { clientIp } from './access.ts';
import { callStore } from './callStore.ts';
import { config } from './config.ts';
import { decodeAudio } from './pcm.ts';
import { maskSecret, settings } from './settingsStore.ts';
import { apiRegistry } from './yeastarApi.ts';
import type {
  InspectorMessage,
  PbxAttemptInfo,
  PbxConnectionInfo,
  PbxProfile,
  PbxStatus,
  YeastarAudioMessage,
} from '../shared/protocol.ts';

const MAX_UNKNOWN = 10;

interface Conn {
  ws: WebSocket;
  info: PbxConnectionInfo;
}

/**
 * Receives WebSocket connections *from* Yeastar PBXs (the PBX is the client) and works out
 * which configured PBX each one belongs to.
 * Events: status(PbxStatus) · inspector(InspectorMessage)
 */
class Ingest extends EventEmitter {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  private conns = new Map<string, Conn>();
  private attempts = new Map<string, PbxAttemptInfo>();
  private unknown: PbxAttemptInfo[] = [];
  private seq = 0;

  constructor() {
    super();
    settings.on('change', (what: string, id: string, kind: string) => {
      if (what !== 'pbx') return;
      const p = settings.getPbx(id);
      // Deleted or disabled PBX: drop its live connections. Other edits apply to new connections.
      if (kind === 'deleted' || (p && !p.enabled)) {
        for (const c of this.conns.values()) if (c.info.pbxId === id) c.ws.close(1008, 'PBX removed or disabled');
        if (kind === 'deleted') this.attempts.delete(id);
      }
      this.emitStatus();
    });
    apiRegistry.on('change', () => this.emitStatus());
  }

  status(): PbxStatus {
    const conns = [...this.conns.values()].map((c) => c.info);
    return {
      profiles: settings.pbxList.map((p) => ({
        id: p.id,
        name: p.name,
        enabled: p.enabled,
        connections: conns.filter((c) => c.pbxId === p.id),
        lastAttempt: this.attempts.get(p.id),
        api: apiRegistry.status(p),
      })),
      unknownAttempts: this.unknown,
    };
  }

  /** `direct`: request reached us without our proxy, so X-Forwarded-For must not be trusted. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, direct = false) {
    const remoteAddress = direct ? normalizeIp(req.socket.remoteAddress ?? '') : clientIp(req);
    const path = req.url ?? '/';
    const { profile, ok, reason } = identify(req, remoteAddress);
    const attempt: PbxAttemptInfo = { at: Date.now(), remoteAddress, path, accepted: ok, reason, headers: maskHeaders(req, profile) };
    if (profile) this.attempts.set(profile.id, attempt);
    else this.unknown = [attempt, ...this.unknown].slice(0, MAX_UNKNOWN);
    console.log(`[ingest] ${ok ? 'accepted' : 'REJECTED'} ${remoteAddress} ${path} → ${profile?.name ?? '(unknown)'} — ${reason}`);

    if (!ok || !profile) {
      console.log('[ingest] headers:', attempt.headers);
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      this.emitStatus();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, profile.id, remoteAddress, path));
  }

  private onConnection(ws: WebSocket, pbxId: string, remoteAddress: string, path: string) {
    const id = `conn${++this.seq}`;
    const info: PbxConnectionInfo = { id, pbxId, remoteAddress, path, connectedAt: Date.now(), messages: 0, callIds: [] };
    this.conns.set(id, { ws, info });
    this.emitStatus();

    ws.on('message', (data, isBinary) => {
      info.messages++;
      const text = isBinary ? Buffer.from(data as Buffer).toString('utf8') : data.toString();
      let msg: YeastarAudioMessage;
      try {
        msg = JSON.parse(text);
      } catch {
        console.warn(`[ingest] ${id}: non-JSON message (${text.length} chars)`);
        this.emitInspector(pbxId, id, text);
        return;
      }
      this.emitInspector(pbxId, id, text, msg);
      if (!msg.callid || !msg.channelid) return;
      if (!info.callIds.includes(msg.callid)) {
        info.callIds.push(msg.callid);
        if (info.callIds.length > 20) info.callIds.shift();
        this.emitStatus();
      }

      if (msg.status === 'end') {
        callStore.endChannel(pbxId, msg.callid, msg.channelid);
        return;
      }
      const profile = settings.getPbx(pbxId);
      callStore.frame({
        connId: id,
        pbxId,
        callId: msg.callid,
        channelId: msg.channelid,
        number: msg.number ?? '',
        callflow: msg.callflow ?? '',
        pcm: decodeAudio(msg.audio),
        sampleRate: profile?.sampleRate ?? 8000,
        sttDefault: settings.ai.enabled,
      });
    });

    ws.on('close', (code) => {
      console.log(`[ingest] ${id} (${settings.pbxName(pbxId)}) closed (${code}), ${info.messages} messages`);
      this.conns.delete(id);
      callStore.connectionClosed(id);
      this.emitStatus();
    });
    ws.on('error', (err) => console.warn(`[ingest] ${id} error:`, err.message));
  }

  private lastInspectorAt = 0;
  /** Forward raw messages for debugging; throttled except for first/last frames. */
  private emitInspector(pbxId: string, connId: string, raw: string, msg?: YeastarAudioMessage) {
    const now = Date.now();
    const important = !msg || msg.status !== 'process';
    if (!important && now - this.lastInspectorAt < 500) return;
    this.lastInspectorAt = now;
    const shown = msg ? JSON.stringify({ ...msg, audio: shorten(msg.audio) }) : raw.slice(0, 500);
    const m: InspectorMessage = { at: now, connId, pbxName: settings.pbxName(pbxId), raw: shown };
    this.emit('inspector', m);
  }

  private statusTimer?: NodeJS.Timeout;
  private emitStatus() {
    // Coalesce bursts (e.g. several settings events at once).
    if (this.statusTimer) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = undefined;
      this.emit('status', this.status());
    }, 50);
  }
}

function shorten(audio?: string) {
  if (!audio) return audio ?? '';
  return audio.length > 40 ? `${audio.slice(0, 40)}… (${audio.length} chars)` : audio;
}

export function normalizeIp(ip: string) {
  return ip.replace(/^::ffff:/, '');
}

/** Does the request carry this profile's secret? (header, Authorization or query string) */
function presentsSecret(req: IncomingMessage, p: PbxProfile): string | undefined {
  if (!p.authValue) return undefined;
  const header = p.authKey ? req.headers[p.authKey.toLowerCase()] : undefined;
  if (header === p.authValue) return `header "${p.authKey}"`;
  const authz = req.headers.authorization;
  if (authz && [p.authValue, `Bearer ${p.authValue}`, `Token ${p.authValue}`].includes(authz)) return 'header "Authorization"';
  const query = new URL(req.url ?? '/', 'http://x').searchParams;
  if (p.authKey && query.get(p.authKey) === p.authValue) return `query "${p.authKey}"`;
  return undefined;
}

/**
 * 1. /yeastar/<id> in the path → that profile.
 * 2. Otherwise (the PBX may drop the path) → the profile whose secret the request carries.
 * 3. Otherwise → a single profile without a secret, if there is exactly one.
 */
function identify(req: IncomingMessage, ip: string): { profile?: PbxProfile; ok: boolean; reason: string } {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname.replace(/\/+$/, '');
  const prefix = config.ingestPath;
  let profile: PbxProfile | undefined;
  let how: string | undefined;

  if (pathname.startsWith(`${prefix}/`)) {
    const id = decodeURIComponent(pathname.slice(prefix.length + 1));
    profile = settings.getPbx(id);
    if (!profile) return { ok: false, reason: `ไม่มี PBX id "${id}" ในแอป` };
    if (profile.authValue) {
      how = presentsSecret(req, profile);
      if (!how) {
        const header = profile.authKey ? req.headers[profile.authKey.toLowerCase()] : undefined;
        return {
          profile,
          ok: false,
          reason: header === undefined ? `ไม่พบ header "${profile.authKey}"` : `ค่า header "${profile.authKey}" ไม่ตรงกับ Secret`,
        };
      }
    } else how = 'ไม่ได้ตั้ง Secret (ไม่ตรวจสอบ)';
  } else {
    for (const p of settings.pbxList) {
      how = presentsSecret(req, p);
      if (how) {
        profile = p;
        how += ` (จับคู่จาก Secret เพราะ path ไม่ระบุ PBX)`;
        break;
      }
    }
    if (!profile) {
      const open = settings.pbxList.filter((p) => !p.authValue);
      if (open.length === 1) {
        profile = open[0];
        how = 'ไม่ได้ตั้ง Secret (ไม่ตรวจสอบ)';
      } else return { ok: false, reason: 'path ไม่ระบุ PBX และ Secret ไม่ตรงกับ PBX ใดเลย' };
    }
  }

  if (!profile.enabled) return { profile, ok: false, reason: 'PBX นี้ถูกปิดใช้งานในแอป' };
  if (profile.allowedIps.length > 0 && !profile.allowedIps.includes(ip))
    return { profile, ok: false, reason: `IP ${ip} ไม่อยู่ในรายการที่อนุญาต` };
  return { profile, ok: true, reason: `${how} ถูกต้อง` };
}

function maskHeaders(req: IncomingMessage, profile?: PbxProfile): Record<string, string> {
  const keys = new Set(settings.pbxList.map((p) => p.authKey.toLowerCase()).filter(Boolean));
  const secrets = settings.pbxList.map((p) => p.authValue).filter(Boolean);
  if (profile?.authKey) keys.add(profile.authKey.toLowerCase());
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const value = Array.isArray(v) ? v.join(', ') : (v ?? '');
    const sensitive = k === 'authorization' || keys.has(k) || secrets.some((s) => value.includes(s));
    out[k] = sensitive ? maskSecret(value) || '(ว่าง)' : value;
  }
  return out;
}

export const ingest = new Ingest();
