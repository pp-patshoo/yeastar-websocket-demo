import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { PbxProfileStatus, PbxProfileView } from '../../../shared/protocol';
import { api } from '../api/settings';
import { CopyButton } from '../components/CopyButton';
import { NoticeBar, type Notice } from '../components/Form';
import { clock } from '../components/format';
import { useLive } from '../hooks/useLive';

export const API_STATE_LABEL: Record<string, string> = {
  none: 'ยังไม่ได้ตั้งค่า',
  unknown: 'ตั้งค่าแล้ว (ยังไม่ได้เรียกใช้)',
  ok: 'พร้อมใช้งาน',
  error: 'ผิดพลาด',
  auth_failed: 'Client ID/Secret ไม่ถูกต้อง',
};

export function connectionTone(st?: PbxProfileStatus): { tone: 'ok' | 'warn' | 'off'; text: string } {
  if (!st) return { tone: 'off', text: '—' };
  if (!st.enabled) return { tone: 'off', text: 'ปิดใช้งาน' };
  if (st.connections.length) return { tone: 'ok', text: `เชื่อมต่ออยู่ (${st.connections.length})` };
  if (st.lastAttempt && !st.lastAttempt.accepted) return { tone: 'warn', text: 'ถูกปฏิเสธล่าสุด' };
  return { tone: 'off', text: 'ยังไม่เชื่อมต่อ' };
}

export function PbxListPage() {
  const s = useLive();
  const navigate = useNavigate();
  const [list, setList] = useState<PbxProfileView[]>();
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listPbx().then(setList, (e) => setNotice({ tone: 'error', text: `โหลดรายการไม่สำเร็จ: ${e.message}` }));
  }, []);

  async function add() {
    setBusy(true);
    try {
      const p = await api.createPbx();
      navigate(`/settings/pbx/${p.id}`);
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message });
      setBusy(false);
    }
  }

  const statusOf = (id: string) => s.pbx.profiles.find((p) => p.id === id);
  const activeCalls = (id: string) => s.calls.filter((c) => c.pbxId === id && !c.endedAt).length;

  return (
    <div className="settings wide">
      <div className="row-between">
        <p className="lead">
          แต่ละ PBX จะ<b>เชื่อมต่อเข้ามา</b>ที่แอปนี้ด้วย URL และ Secret ของตัวเอง และถ้าตั้งค่า Yeastar API ไว้ แอปจะตั้งค่า WebSocket Audio
          Streaming บน PBX ให้ได้
        </p>
        <button className="btn btn-primary" onClick={add} disabled={busy}>
          + เพิ่ม PBX
        </button>
      </div>
      <NoticeBar notice={notice} />
      {!list && !notice && <NoticeBar notice={{ tone: 'info', text: 'กำลังโหลด…' }} />}
      {list?.length === 0 && (
        <div className="card empty-state">
          <div>ยังไม่มี PBX — กด "+ เพิ่ม PBX" เพื่อเริ่ม</div>
        </div>
      )}

      <div className="pbx-grid">
        {list?.map((p) => {
          const st = statusOf(p.id);
          const conn = connectionTone(st);
          const apiState = st?.api.state ?? (p.api ? 'unknown' : 'none');
          const calls = activeCalls(p.id);
          return (
            <div key={p.id} className={`card pbx-card ${p.enabled ? '' : 'disabled'}`}>
              <div className="row-between">
                <div>
                  <div className="pbx-name">{p.name}</div>
                  <div className="muted small mono">{p.id}</div>
                </div>
                <Link className="btn btn-sm" to={`/settings/pbx/${p.id}`}>
                  แก้ไข
                </Link>
              </div>
              <dl className="kv">
                <dt>การเชื่อมต่อ</dt>
                <dd>
                  <span className={`dot dot-${conn.tone}`} /> {conn.text}
                  {calls > 0 && <span className="pill pill-open">{calls} สาย</span>}
                </dd>
                <dt>Yeastar API</dt>
                <dd>
                  <span className={`dot ${apiState === 'ok' ? 'dot-ok' : apiState === 'error' || apiState === 'auth_failed' ? 'dot-warn' : 'dot-off'}`} />{' '}
                  {API_STATE_LABEL[apiState]}
                </dd>
                <dt>Sample rate</dt>
                <dd>{p.sampleRate / 1000} kHz</dd>
                <dt>URL ขาเข้า</dt>
                <dd className="url-cell">
                  <code>{p.ingestUrl}</code>
                  <CopyButton text={p.ingestUrl} />
                </dd>
              </dl>
              {st?.lastAttempt && !st.lastAttempt.accepted && (
                <div className="error-text small">
                  {clock(st.lastAttempt.at)} ถูกปฏิเสธ: {st.lastAttempt.reason}
                </div>
              )}
              {st?.api.message && (apiState === 'error' || apiState === 'auth_failed') && <div className="error-text small">API: {st.api.message}</div>}
            </div>
          );
        })}
      </div>

      {s.pbx.unknownAttempts.length > 0 && (
        <section className="card form-card">
          <div className="card-title">การเชื่อมต่อที่ไม่รู้จัก</div>
          <p className="muted small" style={{ margin: 0 }}>
            มีการเชื่อมต่อที่จับคู่กับ PBX ในรายการไม่ได้ (path ไม่ตรงและ Secret ไม่ตรง) — มักเกิดจาก PBX ที่ยังไม่ได้เพิ่ม หรือใส่ Secret ผิด
          </p>
          {s.pbx.unknownAttempts.map((a, i) => (
            <details key={`${a.at}-${i}`} className="attempt">
              <summary>
                {clock(a.at)} · {a.remoteAddress} · <code>{a.path}</code> — {a.reason}
              </summary>
              <pre className="mono small">{Object.entries(a.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
