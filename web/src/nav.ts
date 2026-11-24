import type { ComponentType, SVGProps } from 'react';
import { IconDashboard, IconGlobe, IconPbx, IconSparkle } from './components/Icons';
import type { LiveState } from './hooks/useLive';

export interface NavItem {
  to: string;
  label: string;
  hint: string;
  /** Optional live sub-label replacing `hint`. */
  hintFor?: (s: LiveState) => string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Small status dot next to the menu item. */
  status?: (s: LiveState) => { tone: 'ok' | 'warn' | 'off'; title: string };
}

/** Sidebar menu. Add a page by adding an entry here and a <Route> in App.tsx. */
export const NAV: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    hint: 'สายสนทนาแบบเรียลไทม์',
    icon: IconDashboard,
    status: (s) => {
      const active = s.calls.filter((c) => !c.endedAt).length;
      return active ? { tone: 'ok', title: `${active} สายกำลังสตรีม` } : { tone: 'off', title: 'ไม่มีสายที่กำลังสตรีม' };
    },
  },
  {
    to: '/settings/ai',
    label: 'ตั้งค่า AI Platform',
    hint: 'ถอดเสียง (Deepgram)',
    icon: IconSparkle,
    status: (s) =>
      !s.stt.configured
        ? { tone: 'warn', title: 'ยังไม่ได้ใส่ API key' }
        : s.stt.enabled
          ? { tone: 'ok', title: 'ถอดเสียงอัตโนมัติเปิดอยู่' }
          : { tone: 'off', title: 'ถอดเสียงอัตโนมัติปิดอยู่' },
  },
  {
    to: '/settings/pbx',
    label: 'ตั้งค่า Yeastar PBX',
    hint: 'การเชื่อมต่อ WebSocket',
    icon: IconPbx,
    hintFor: (s) => {
      const on = s.pbx.profiles.filter((p) => p.enabled);
      return on.length ? `${on.filter((p) => p.connections.length).length}/${on.length} PBX เชื่อมต่อ` : 'ยังไม่มี PBX';
    },
    status: (s) => {
      const on = s.pbx.profiles.filter((p) => p.enabled);
      const connected = on.filter((p) => p.connections.length).length;
      const problem = on.some((p) => (p.lastAttempt && !p.lastAttempt.accepted) || p.api.state === 'error' || p.api.state === 'auth_failed');
      if (on.length && connected === on.length && !problem) return { tone: 'ok', title: 'PBX ทุกตัวเชื่อมต่ออยู่' };
      if (problem) return { tone: 'warn', title: 'มี PBX ที่ถูกปฏิเสธหรือ API ผิดพลาด' };
      return connected ? { tone: 'ok', title: `${connected}/${on.length} PBX เชื่อมต่ออยู่` } : { tone: 'off', title: 'ยังไม่มี PBX เชื่อมต่อ' };
    },
  },
  {
    to: '/settings/access',
    label: 'การเข้าถึง',
    hint: 'LAN / Cloudflare Tunnel',
    icon: IconGlobe,
    hintFor: (s) => {
      const t = s.access.tunnel;
      if (!t.available) return 'LAN เท่านั้น';
      const lan = s.access.lanEffective ? 'LAN' : '';
      const tun = t.state === 'online' ? 'Tunnel' : '';
      return [lan, tun].filter(Boolean).join(' + ') || 'LAN';
    },
    status: (s) => {
      const t = s.access.tunnel;
      if (t.state === 'online') return { tone: 'ok', title: 'Cloudflare Tunnel ออนไลน์' };
      if (t.state === 'error' || t.state === 'starting') return { tone: 'warn', title: t.state === 'error' ? 'Tunnel ผิดพลาด' : 'Tunnel กำลังเปิด' };
      return { tone: 'off', title: 'Tunnel ปิดอยู่' };
    },
  },
];
