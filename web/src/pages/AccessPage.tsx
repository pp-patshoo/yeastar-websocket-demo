import { useEffect, useState } from 'react';
import { api } from '../api/settings';
import { CopyButton } from '../components/CopyButton';
import { NoticeBar, Toggle, type Notice } from '../components/Form';
import { clock } from '../components/format';
import { useLive } from '../hooks/useLive';

const STATE_LABEL: Record<string, string> = {
  unavailable: 'ใช้ไม่ได้ในโหมดนี้',
  stopped: 'ปิดอยู่',
  starting: 'กำลังเปิด…',
  online: 'ออนไลน์',
  error: 'ผิดพลาด',
};

export function AccessPage() {
  const s = useLive();
  const a = s.access;
  const t = a.tunnel;
  const [viaTunnel, setViaTunnel] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();

  useEffect(() => {
    api.getAccess().then(
      (v) => setViaTunnel(v.viewerViaTunnel),
      () => setViaTunnel(false),
    );
  }, []);

  async function save(tunnelEnabled: boolean, lanDashboard: boolean) {
    setBusy(true);
    setNotice(undefined);
    try {
      const v = await api.saveAccess({ tunnelEnabled, lanDashboard });
      setViaTunnel(v.viewerViaTunnel);
      setNotice({ tone: 'ok', text: v.note ?? 'บันทึกแล้ว' });
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const canDisableLan = t.state === 'online' && viaTunnel === true;
  const lanHint = !t.available
    ? 'ต้องรันด้วย Docker และเปิด Tunnel ก่อน'
    : canDisableLan
      ? 'ปิดแล้ว คนที่เข้าผ่าน http://IP-ของ-VM จะเห็นหน้า "ปิดการเข้าจาก LAN" (PBX ยังส่งเสียงเข้ามาได้ตามปกติ)'
      : t.state !== 'online'
        ? 'ปิดได้เมื่อ Tunnel ออนไลน์อยู่เท่านั้น'
        : 'ต้องเปิดหน้านี้ผ่าน URL ของ Tunnel ก่อน จึงจะปิดได้ (กันล็อกตัวเองออก)';

  return (
    <div className="settings">
      <p className="lead">
        เลือกช่องทางที่ใช้เปิดหน้า Dashboard ทุกช่องทางต้อง login ก่อน ส่วน <b>PBX ส่งเสียงเข้ามาทาง LAN (พอร์ต PBX) เสมอ</b>{' '}
        ไม่ได้รับผลจากการตั้งค่าในหน้านี้
      </p>

      {!t.available && (
        <NoticeBar
          notice={{
            tone: 'info',
            text: 'Cloudflare Tunnel ใช้ได้เมื่อรันด้วย Docker (docker compose) ซึ่งมี Caddy ทำหน้าที่ login — ตอนนี้แอปรันแบบไม่มี proxy จึงเข้าได้ผ่าน LAN เท่านั้น',
          }}
        />
      )}

      <section className="card form-card">
        <div className="card-title">Cloudflare Quick Tunnel</div>
        <Toggle
          label="เปิดให้เข้าจากนอก LAN ผ่าน Cloudflare"
          hint="ไม่ต้องเปิดพอร์ตหรือมีโดเมน · URL จะเปลี่ยนทุกครั้งที่ปิด/เปิด หรือรีสตาร์ทแอป"
          checked={a.tunnel.enabled}
          onChange={(v) => save(v, v ? a.lanDashboard : true)}
        />
        {busy && <div className="muted small">กำลังบันทึก…</div>}
        {t.available && (
          <>
            <div className="status-line">
              <span className={`dot ${t.state === 'online' ? 'dot-ok' : t.state === 'error' || t.state === 'starting' ? 'dot-warn' : 'dot-off'}`} />
              <b>{STATE_LABEL[t.state]}</b>
              {t.since && t.state !== 'stopped' && <span className="muted small">ตั้งแต่ {clock(t.since)}</span>}
            </div>
            {t.url && (
              <div className="url-row">
                <code>{t.url}</code>
                <CopyButton text={t.url} />
                <a className="btn btn-sm" href={t.url} target="_blank" rel="noreferrer">
                  เปิด
                </a>
              </div>
            )}
            {t.error && <NoticeBar notice={{ tone: 'error', text: t.error }} />}
            {t.log.length > 0 && (
              <details className="attempt">
                <summary className="small">log ของ cloudflared ({t.log.length} บรรทัดล่าสุด)</summary>
                <pre className="mono small">{t.log.join('\n')}</pre>
              </details>
            )}
            <p className="muted small" style={{ margin: 0 }}>
              Cloudflare ระบุว่า Quick Tunnel มีไว้สำหรับทดสอบ ไม่มีการรับประกัน uptime — ถ้าต้องการ URL ถาวร ใช้ Named Tunnel (ต้องมีโดเมนบน
              Cloudflare)
            </p>
          </>
        )}
      </section>

      <section className="card form-card">
        <div className="card-title">Dashboard ผ่าน LAN</div>
        <Toggle
          label="เปิดให้เข้า Dashboard จาก LAN"
          hint={lanHint}
          checked={a.lanDashboard}
          onChange={(v) => {
            if (!v && !canDisableLan) {
              setNotice({ tone: 'error', text: lanHint });
              return;
            }
            if (!v && !window.confirm('ปิดการเข้า Dashboard จาก LAN?\n\nหลังจากนี้เข้าได้เฉพาะผ่าน URL ของ Tunnel (ถ้า Tunnel ล่ม ระบบจะเปิดทาง LAN ให้อัตโนมัติ)')) return;
            save(a.tunnel.enabled, v);
          }}
        />
        {!a.lanDashboard && a.lanEffective && (
          <NoticeBar notice={{ tone: 'info', text: 'ตั้งค่าให้ปิด LAN ไว้ แต่ตอนนี้ Tunnel ไม่ออนไลน์ จึงเปิดทาง LAN ให้ชั่วคราว (กันล็อกตัวเองออก)' }} />
        )}
        {a.forceLan && <NoticeBar notice={{ tone: 'info', text: 'FORCE_LAN_DASHBOARD เปิดอยู่ใน .env — เข้าผ่าน LAN ได้เสมอ' }} />}
        <div className="status-line small">
          <span className={`dot ${a.lanEffective ? 'dot-ok' : 'dot-off'}`} />
          สถานะจริงตอนนี้: LAN {a.lanEffective ? 'เข้าได้' : 'ปิดอยู่'} · หน้านี้เปิดผ่าน{' '}
          {viaTunnel === undefined ? '…' : viaTunnel ? 'Cloudflare Tunnel' : 'LAN'}
        </div>
      </section>

      <NoticeBar notice={notice} />
    </div>
  );
}
