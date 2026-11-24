import net from 'node:net';
import os from 'node:os';
import { config } from './config.ts';
import type { PbxProfile } from '../shared/protocol.ts';

interface Iface {
  address: string;
  netmask: string;
}

/** IPv4 addresses of this machine that a PBX on the LAN could reach. */
export function lanInterfaces(): Iface[] {
  const out: Iface[] = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push({ address: a.address, netmask: a.netmask });
  return out.length ? out : [{ address: '127.0.0.1', netmask: '255.0.0.0' }];
}

const toInt = (ip: string) => ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;

function sameSubnet(a: string, b: string, mask: string) {
  if (!net.isIPv4(a) || !net.isIPv4(b)) return false;
  const m = toInt(mask);
  return (toInt(a) & m) === (toInt(b) & m);
}

/** The PBX's IP as far as we know it: API base URL host, else first allowed IP. */
function pbxAddress(p: PbxProfile): string | undefined {
  if (p.api?.baseUrl) {
    try {
      return new URL(p.api.baseUrl).hostname;
    } catch {
      /* ignore */
    }
  }
  return p.allowedIps[0];
}

/** Address of this app as the PBX should dial it. */
export function appHostFor(p: PbxProfile): string {
  if (p.appHost) return p.appHost;
  const ifaces = lanInterfaces();
  const target = pbxAddress(p);
  if (target === 'localhost' || target === '127.0.0.1') return '127.0.0.1';
  return (target && ifaces.find((i) => sameSubnet(i.address, target, i.netmask))?.address) ?? ifaces[0].address;
}

export function ingestUrlFor(p: PbxProfile): string {
  const host = net.isIPv6(p.appHost) ? `[${p.appHost}]` : appHostFor(p);
  return `ws://${host}:${config.port}${config.ingestPath}/${p.id}`;
}
