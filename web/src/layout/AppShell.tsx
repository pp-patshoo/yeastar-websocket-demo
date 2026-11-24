import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { IconMenu, IconWave } from '../components/Icons';
import { useLive } from '../hooks/useLive';
import { NAV } from '../nav';

export function AppShell() {
  const live = useLive();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const current = NAV.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)));

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <IconWave width={20} height={20} />
          </span>
          <div>
            <div className="brand-name">Audio Monitor</div>
            <div className="brand-sub">Yeastar WebSocket</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((item) => {
            const st = item.status?.(live);
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav-item">
                <Icon />
                <span className="nav-text">
                  <span className="nav-label">{item.label}</span>
                  <span className="nav-hint">{item.hintFor?.(live) ?? item.hint}</span>
                </span>
                {st && <span className={`dot dot-${st.tone}`} title={st.title} aria-label={st.title} />}
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span className={`dot ${live.connected ? 'dot-ok' : 'dot-warn'}`} />
          {live.connected ? 'เชื่อมต่อ server แล้ว' : 'กำลังเชื่อมต่อ server…'}
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen((o) => !o)} aria-label="เปิดเมนู">
            <IconMenu />
          </button>
          <h1>{current?.label ?? ''}</h1>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
