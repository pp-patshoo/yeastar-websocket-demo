import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { config } from './config.ts';
import { settings, ValidationError } from './settingsStore.ts';
import { tunnel } from './tunnel.ts';
import type { AccessStatus, AccessUpdate } from '../shared/protocol.ts';

/** Request came in through the Cloudflare tunnel (Caddy :81 sets this; Caddy :80 strips it). */
export function viaTunnel(req: IncomingMessage): boolean {
  return config.trustProxy && req.headers['x-via-tunnel'] === '1';
}

/** Client IP: from Caddy's X-Forwarded-For when behind our proxy, else the socket. */
export function clientIp(req: IncomingMessage): string {
  const xff = config.trustProxy ? req.headers['x-forwarded-for'] : undefined;
  const ip = (typeof xff === 'string' && xff.split(',')[0].trim()) || req.socket.remoteAddress || '';
  return ip.replace(/^::ffff:/, '');
}

/**
 * Is the dashboard open to LAN visitors right now? Fails open: when the tunnel is not online
 * (or FORCE_LAN_DASHBOARD is set), LAN access is allowed so nobody gets locked out.
 */
export function lanEffective(): boolean {
  return config.forceLanDashboard || settings.access.lanDashboard || !tunnel.isOnline();
}

export function dashboardAllowed(req: IncomingMessage): boolean {
  return viaTunnel(req) || lanEffective();
}

export function accessStatus(): AccessStatus {
  const t = tunnel.status();
  return {
    tunnel: { ...t, enabled: settings.access.tunnelEnabled && t.available },
    lanDashboard: settings.access.lanDashboard,
    lanEffective: lanEffective(),
    forceLan: config.forceLanDashboard,
  };
}

/** Apply a change from the settings page, enforcing the anti-lockout rules on the server. */
export async function updateAccess(req: IncomingMessage, u: AccessUpdate): Promise<string | undefined> {
  if (u.tunnelEnabled && !tunnel.available)
    throw new ValidationError('Cloudflare Tunnel ใช้ได้เมื่อรันด้วย Docker (มี Caddy ทำหน้าที่ login) เท่านั้น');
  let note: string | undefined;
  let lan = u.lanDashboard;
  // Turning the tunnel off always reopens the LAN, otherwise nobody could reach the dashboard.
  if (!u.tunnelEnabled && !lan) {
    lan = true;
    note = 'เปิดการเข้าผ่าน LAN ให้อัตโนมัติ เพราะปิด Tunnel แล้ว';
  }
  // Closing the LAN only while the tunnel works, and only from a page that came through it.
  if (!lan && settings.access.lanDashboard) {
    if (!tunnel.isOnline()) throw new ValidationError('ปิดการเข้าผ่าน LAN ได้เฉพาะตอนที่ Tunnel ออนไลน์อยู่');
    if (!viaTunnel(req)) throw new ValidationError('ต้องเปิดหน้านี้ผ่าน URL ของ Tunnel ก่อน จึงจะปิดการเข้าผ่าน LAN ได้ (กันล็อกตัวเองออก)');
  }
  settings.updateAccess({ tunnelEnabled: u.tunnelEnabled, lanDashboard: lan });
  if (u.tunnelEnabled) tunnel.start();
  else await tunnel.stop();
  return note;
}

/** Events: status(AccessStatus) */
export const accessEvents = new EventEmitter();
tunnel.on('status', () => accessEvents.emit('status', accessStatus()));
settings.on('change', (what: string) => what === 'access' && accessEvents.emit('status', accessStatus()));

/** Called once at startup. */
export function initAccess() {
  if (settings.access.tunnelEnabled && tunnel.available) tunnel.start();
  if (config.forceLanDashboard) console.log('[access] FORCE_LAN_DASHBOARD is set: dashboard always reachable from the LAN');
}
