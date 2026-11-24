import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { PbxProfileUpdate, PbxProfileView } from '../../../shared/protocol';
import { api } from '../api/settings';
import { CopyButton } from '../components/CopyButton';
import { Field, NoticeBar, Toggle, type Notice } from '../components/Form';
import { clock } from '../components/format';
import { RemoteStreamTab } from '../components/pbx/RemoteStreamTab';
import { useLive } from '../hooks/useLive';
import { API_STATE_LABEL, connectionTone } from './PbxListPage';

const TABS = [
  { id: 'inbound', label: 'ทั่วไป & ขาเข้า' },
  { id: 'api', label: 'Yeastar API' },
  { id: 'stream', label: 'WebSocket Audio Streaming บน PBX' },
] as const;
type Tab = (typeof TABS)[number]['id'];

interface FormState {
  name: string;
  enabled: boolean;
  authKey: string;
  authValue: string;
  sampleRate: 8000 | 16000;
  ipsText: string;
  appHost: string;
  apiEnabled: boolean;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  insecureTls: boolean;
}

function toForm(p: PbxProfileView): FormState {
  return {
    name: p.name,
    enabled: p.enabled,
    authKey: p.authKey,
    authValue: p.authValue,
    sampleRate: p.sampleRate,
    ipsText: p.allowedIps.join('\n'),
    appHost: p.appHost,
    apiEnabled: !!p.api,
    baseUrl: p.api?.baseUrl ?? '',
    clientId: p.api?.clientId ?? '',
    clientSecret: '',
    insecureTls: p.api?.insecureTls ?? true,
  };
}

function toUpdate(f: FormState): PbxProfileUpdate {
  return {
    name: f.name,
    enabled: f.enabled,
    authKey: f.authKey,
    authValue: f.authValue,
    sampleRate: f.sampleRate,
    allowedIps: f.ipsText.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean),
    appHost: f.appHost,
    api: f.apiEnabled
      ? { baseUrl: f.baseUrl, clientId: f.clientId, clientSecret: f.clientSecret || undefined, insecureTls: f.insecureTls }
      : null,
  };
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 24);
}

export function PbxEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'inbound') as Tab;
  const s = useLive();
  const [view, setView] = useState<PbxProfileView>();
  const [form, setForm] = useState<FormState>();
  const [showSecret, setShowSecret] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [test, setTest] = useState<Notice>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setView(undefined);
    api.getPbx(id).then(
      (v) => {
        setView(v);
        setForm(toForm(v));
      },
      (e) => setNotice({ tone: 'error', text: `โหลดไม่สำเร็จ: ${e.message}` }),
    );
  }, [id]);

  if (!view || !form)
    return (
      <div className="settings">
        <Link to="/settings/pbx" className="back-link">
          ← รายการ PBX
        </Link>
        <NoticeBar notice={notice ?? { tone: 'info', text: 'กำลังโหลด…' }} />
      </div>
    );

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });
  const dirty = JSON.stringify(toForm(view)) !== JSON.stringify(form);
  const st = s.pbx.profiles.find((p) => p.id === id);
  const conn = connectionTone(st);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setNotice(undefined);
    try {
      const v = await api.savePbx(id, toUpdate(form!));
      setView(v);
      setForm(toForm(v));
      setNotice({ tone: 'ok', text: 'บันทึกแล้ว — การเชื่อมต่อครั้งถัดไปจาก PBX จะใช้ค่าใหม่' });
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`ลบ PBX "${view!.name}"?\n\nการเชื่อมต่อจาก PBX นี้จะถูกตัด และแอปจะไม่รับเสียงจาก PBX นี้อีก (ค่าบนตัว PBX จะไม่ถูกเปลี่ยน)`)) return;
    try {
      await api.deletePbx(id);
      navigate('/settings/pbx');
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message });
    }
  }

  async function runTest() {
    setTest({ tone: 'info', text: 'กำลังทดสอบการเชื่อมต่อ Yeastar API…' });
    try {
      const u = toUpdate(form!);
      const r = await api.testPbxApi(id, { ...u.api!, clientSecret: form!.clientSecret || undefined });
      setTest({ tone: r.ok ? 'ok' : 'error', text: r.message });
    } catch (err) {
      setTest({ tone: 'error', text: (err as Error).message });
    }
  }

  const saveBar = (
    <div className="form-actions">
      <NoticeBar notice={notice} />
      {dirty && <span className="muted small">มีการแก้ไขที่ยังไม่บันทึก</span>}
      <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>
        {busy ? 'กำลังบันทึก…' : 'บันทึก'}
      </button>
    </div>
  );

  return (
    <div className="settings">
      <Link to="/settings/pbx" className="back-link">
        ← รายการ PBX
      </Link>
      <div className="row-between">
        <div>
          <div className="page-title">{view.name}</div>
          <div className="status-line small">
            <span className={`dot dot-${conn.tone}`} /> {conn.text}
            <span className="muted">· API: {API_STATE_LABEL[st?.api.state ?? (view.api ? 'unknown' : 'none')]}</span>
          </div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setParams({ tab: t.id }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'inbound' && (
        <form className="settings" onSubmit={save}>
          <section className="card form-card">
            <div className="card-title">ทั่วไป</div>
            <div className="grid-2">
              <Field label="ชื่อ PBX" htmlFor="name">
                <input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="ID" hint="ใช้ใน URL ขาเข้า เปลี่ยนไม่ได้">
                <input value={view.id} disabled />
              </Field>
            </div>
            <Toggle label="เปิดใช้งาน" hint="ปิด = ปฏิเสธการเชื่อมต่อจาก PBX นี้ และตัด connection ที่เชื่อมอยู่" checked={form.enabled} onChange={(v) => set('enabled', v)} />
          </section>

          <section className="card form-card">
            <div className="card-title">ที่อยู่สำหรับนำไปใส่ใน PBX (Server Address)</div>
            <div className="url-row">
              <code>{view.ingestUrl}</code>
              <CopyButton text={view.ingestUrl} />
            </div>
            <Field
              label="IP ของแอปที่ PBX มองเห็น"
              htmlFor="apphost"
              hint="อัตโนมัติ = เลือก IP ที่อยู่วง network เดียวกับ PBX (ดูจาก Base URL ของ API หรือ IP ที่อนุญาต) · ต้องอนุญาตพอร์ตนี้ใน firewall ของ Windows"
            >
              <select id="apphost" value={form.appHost} onChange={(e) => set('appHost', e.target.value)}>
                <option value="">อัตโนมัติ</option>
                {view.hostChoices.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
                {form.appHost && !view.hostChoices.includes(form.appHost) && <option value={form.appHost}>{form.appHost}</option>}
              </select>
            </Field>
          </section>

          <section className="card form-card">
            <div className="card-title">การยืนยันตัวตน</div>
            <div className="grid-2">
              <Field label="ชื่อ field (auth_key)" htmlFor="authkey" hint='ต้องตรงกับชื่อที่ตั้งแทนคำว่า "Secret" ใน PBX'>
                <input id="authkey" value={form.authKey} onChange={(e) => set('authKey', e.target.value)} placeholder="auth_key" />
              </Field>
              <Field label="Secret (auth_value)" htmlFor="authvalue" hint="ต้องไม่ซ้ำกับ PBX อื่น (ใช้ระบุ PBX เมื่อ PBX ไม่ส่ง path มา)">
                <div className="input-group">
                  <input
                    id="authvalue"
                    type={showSecret ? 'text' : 'password'}
                    autoComplete="off"
                    value={form.authValue}
                    onChange={(e) => set('authValue', e.target.value)}
                  />
                  <button type="button" className="btn btn-sm" onClick={() => setShowSecret((v) => !v)}>
                    {showSecret ? 'ซ่อน' : 'แสดง'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      set('authValue', randomSecret());
                      setShowSecret(true);
                    }}
                  >
                    สุ่มใหม่
                  </button>
                  {form.authValue && <CopyButton text={form.authValue} />}
                </div>
              </Field>
            </div>
          </section>

          <section className="card form-card">
            <div className="card-title">เสียงและความปลอดภัย</div>
            <Field label="Sample rate (ต้องตรงกับที่ตั้งใน PBX)" hint="ข้อความจาก PBX ไม่ได้บอก sample rate มาด้วย ถ้าตั้งไม่ตรง เสียงจะช้า/เร็วผิดปกติ">
              <div className="segmented">
                {([8000, 16000] as const).map((r) => (
                  <label key={r} className={form.sampleRate === r ? 'active' : ''}>
                    <input type="radio" name="rate" checked={form.sampleRate === r} onChange={() => set('sampleRate', r)} />
                    {r / 1000} kHz <span className="muted small">({r === 8000 ? 'เฟรม 80 ms' : 'เฟรม 40 ms'})</span>
                  </label>
                ))}
              </div>
            </Field>
            <Field label="IP ของ PBX ที่อนุญาต (ไม่บังคับ)" htmlFor="ips" hint="หนึ่ง IP ต่อบรรทัด · เว้นว่าง = อนุญาตทุก IP">
              <textarea id="ips" rows={2} value={form.ipsText} onChange={(e) => set('ipsText', e.target.value)} placeholder="192.168.1.10" />
            </Field>
          </section>

          {saveBar}

          <section className="card form-card">
            <div className="card-title">สถานะการเชื่อมต่อจาก PBX</div>
            {!st?.connections.length && <div className="muted">ยังไม่มีการเชื่อมต่อจาก PBX นี้ในขณะนี้</div>}
            {st?.connections.map((c) => (
              <div key={c.id} className="status-line">
                <span className="dot dot-ok" />
                {c.id} · {c.remoteAddress} · path <code>{c.path}</code> · ตั้งแต่ {clock(c.connectedAt)} · {c.messages.toLocaleString()} ข้อความ
              </div>
            ))}
            {st?.lastAttempt && (
              <div className="attempt">
                <div className="status-line">
                  <span className={`dot ${st.lastAttempt.accepted ? 'dot-ok' : 'dot-warn'}`} />
                  ล่าสุด {clock(st.lastAttempt.at)} จาก {st.lastAttempt.remoteAddress} — <b>{st.lastAttempt.accepted ? 'สำเร็จ' : 'ถูกปฏิเสธ'}</b>:{' '}
                  {st.lastAttempt.reason}
                </div>
                <details>
                  <summary className="small">HTTP headers ที่ PBX ส่งมา (ค่าลับถูกปิดบัง)</summary>
                  <pre className="mono small">{Object.entries(st.lastAttempt.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
                </details>
              </div>
            )}
          </section>

          <section className="card form-card guide">
            <div className="card-title">ตั้งค่าที่ PBX ด้วยตัวเอง (ถ้าไม่ใช้ Yeastar API)</div>
            <ol>
              <li>
                หน้าเว็บของ PBX → <b>Integrations</b> → <b>WebSocket Audio Streaming</b> → เปิดใช้งาน
              </li>
              <li>
                <b>Server Address</b>: <code>{view.ingestUrl}</code>
              </li>
              <li>
                <b>Secret</b>: เปลี่ยนชื่อ field เป็น <code>{view.authKey || 'auth_key'}</code> และใส่ค่าให้ตรงกับหน้านี้
              </li>
              <li>
                <b>Sample Rate</b>: {view.sampleRate / 1000} kHz
              </li>
              <li>เลือก Extension / Trunk / DID แล้ว Save</li>
            </ol>
          </section>

          <section className="card form-card danger-zone">
            <div className="row-between">
              <div>
                <div className="field-label">ลบ PBX นี้</div>
                <div className="field-hint">ตัดการเชื่อมต่อและลบค่าตั้งของ PBX นี้ออกจากแอป (ค่าบนตัว PBX จะไม่ถูกเปลี่ยน)</div>
              </div>
              <button type="button" className="btn btn-danger" onClick={remove}>
                ลบ PBX
              </button>
            </div>
          </section>
        </form>
      )}

      {tab === 'api' && (
        <form className="settings" onSubmit={save}>
          <section className="card form-card">
            <div className="card-title">Yeastar OpenAPI</div>
            <Toggle
              label="ใช้ Yeastar API กับ PBX นี้"
              hint="ให้แอปอ่าน/ตั้งค่า WebSocket Audio Streaming บน PBX ได้ (P-Series Software Edition)"
              checked={form.apiEnabled}
              onChange={(v) => set('apiEnabled', v)}
            />
            {form.apiEnabled && (
              <>
                <Field label="Base URL" htmlFor="baseurl" hint="ที่อยู่หน้าเว็บของ PBX เช่น https://192.168.1.10:8088 (ไม่ต้องใส่ /openapi/v1.0)">
                  <input id="baseurl" value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder="https://192.168.1.10:8088" />
                </Field>
                <div className="grid-2">
                  <Field label="Client ID" htmlFor="cid">
                    <input id="cid" autoComplete="off" value={form.clientId} onChange={(e) => set('clientId', e.target.value)} />
                  </Field>
                  <Field label="Client Secret" htmlFor="csecret" hint="เก็บไว้ที่ server เท่านั้น">
                    <input
                      id="csecret"
                      type="password"
                      autoComplete="off"
                      value={form.clientSecret}
                      placeholder={view.api?.hasClientSecret ? `บันทึกไว้แล้ว ${view.api.clientSecretMasked} — เว้นว่างเพื่อใช้ค่าเดิม` : ''}
                      onChange={(e) => set('clientSecret', e.target.value)}
                    />
                  </Field>
                </div>
                <label className="inline-check plain">
                  <input type="checkbox" checked={form.insecureTls} onChange={(e) => set('insecureTls', e.target.checked)} /> ยอมรับใบรับรอง HTTPS แบบ
                  self-signed (PBX ส่วนใหญ่ใช้แบบนี้)
                </label>
                <NoticeBar
                  notice={{
                    tone: 'info',
                    text: 'ระวัง: ถ้า Client ID/Secret ผิด 5 ครั้งติดกัน PBX จะบล็อก IP ของเครื่องนี้ — แอปจะไม่ลองซ้ำเองเมื่อรหัสผิด',
                  }}
                />
                <div className="row-gap">
                  <button type="button" className="btn" onClick={runTest}>
                    ทดสอบการเชื่อมต่อ
                  </button>
                </div>
                <NoticeBar notice={test} />
                {st?.api.message && (st.api.state === 'error' || st.api.state === 'auth_failed') && (
                  <NoticeBar notice={{ tone: 'error', text: `สถานะล่าสุด: ${st.api.message}` }} />
                )}
              </>
            )}
          </section>

          {saveBar}

          <section className="card form-card guide">
            <div className="card-title">เปิด Yeastar API ที่ PBX</div>
            <ol>
              <li>
                หน้าเว็บของ PBX → <b>Integrations</b> → <b>API</b> → เปิด <b>Enable API</b>
              </li>
              <li>
                คัดลอก <b>Client ID</b> และ <b>Client Secret</b> มาใส่ด้านบน
              </li>
              <li>
                ถ้าเปิด <b>IP Restriction</b> ให้เพิ่ม IP ของเครื่องที่รันแอปนี้
              </li>
              <li>กด "ทดสอบการเชื่อมต่อ" แล้วบันทึก จากนั้นไปแท็บ "WebSocket Audio Streaming บน PBX"</li>
            </ol>
          </section>
        </form>
      )}

      {tab === 'stream' && <RemoteStreamTab profile={view} unsaved={dirty} />}
    </div>
  );
}
