import { useCallback, useEffect, useState } from 'react';
import type { PbxProfileView, RemoteApplyRequest, RemoteOptions, RemoteState, SubscribeItem } from '../../../../shared/protocol';
import { api } from '../../api/settings';
import { NoticeBar, Toggle, type Notice } from '../Form';
import { SubscribePicker, TYPE_LABEL } from './SubscribePicker';

const onOff = (b: boolean) => (b ? 'เปิด' : 'ปิด');
const subKey = (s: SubscribeItem) => `${s.type}:${s.id}`;

function formFrom(state: RemoteState): RemoteApplyRequest {
  return { ...state.current, secretMode: state.secretMatches === true ? 'keep' : 'app' };
}

interface Row {
  label: string;
  current: string;
  next: string;
  changed: boolean;
}

function diffRows(state: RemoteState, form: RemoteApplyRequest, options?: RemoteOptions): Row[] {
  const c = state.current;
  const row = (label: string, a: string, b: string): Row => ({ label, current: a, next: b, changed: a !== b });
  const secretNext = form.secretMode === 'app' ? 'Secret ของแอป' : 'คงค่าเดิมบน PBX';
  const secretCurrent =
    state.secretMatches === true ? 'ตรงกับแอป' : state.secretMatches === false ? `ไม่ตรงกับแอป (${state.currentSecretMasked})` : 'ไม่ทราบ (PBX ไม่เปิดเผย)';
  const name = (s: SubscribeItem) => options?.options[s.type].find((o) => o.id === s.id)?.text ?? `ID ${s.id}`;
  const cur = new Set(c.subscribe.map(subKey));
  const nxt = new Set(form.subscribe.map(subKey));
  const added = form.subscribe.filter((s) => !cur.has(subKey(s)));
  const removed = c.subscribe.filter((s) => !nxt.has(subKey(s)));
  const fmtList = (l: SubscribeItem[]) => l.map((s) => `${TYPE_LABEL[s.type]}: ${name(s)}`).join(', ');

  return [
    row('เปิดใช้งาน', onOff(c.enable), onOff(form.enable)),
    row('Server Address', c.websocketUrl || '(ว่าง)', form.websocketUrl || '(ว่าง)'),
    row('ชื่อ field (auth_key)', c.authKey || '(ว่าง)', form.authKey || '(ว่าง)'),
    {
      label: 'Secret (auth_value)',
      current: secretCurrent,
      next: secretNext,
      changed: form.secretMode === 'app' && state.secretMatches !== true,
    },
    row('Sample rate', `${c.sampleRate / 1000} kHz`, `${form.sampleRate / 1000} kHz`),
    row('Extension (enable_ext)', onOff(c.enableExt), onOff(form.enableExt)),
    row('Trunk (enable_trunk)', onOff(c.enableTrunk), onOff(form.enableTrunk)),
    row('DID (enable_did)', onOff(c.enableDid), onOff(form.enableDid)),
    {
      label: 'รายการ Subscribe',
      current: `${c.subscribe.length} รายการ`,
      next:
        added.length || removed.length
          ? [added.length ? `เพิ่ม ${fmtList(added)}` : '', removed.length ? `ลบ ${fmtList(removed)}` : ''].filter(Boolean).join(' · ')
          : `${form.subscribe.length} รายการ (ไม่เปลี่ยน)`,
      changed: added.length > 0 || removed.length > 0,
    },
  ];
}

export function RemoteStreamTab({ profile, unsaved }: { profile: PbxProfileView; unsaved: boolean }) {
  const [state, setState] = useState<RemoteState>();
  const [form, setForm] = useState<RemoteApplyRequest>();
  const [options, setOptions] = useState<RemoteOptions>();
  const [loading, setLoading] = useState(false);
  const [optLoading, setOptLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(undefined);
    try {
      const st = await api.getRemote(profile.id);
      setState(st);
      setForm(formFrom(st));
    } catch (err) {
      setNotice({ tone: 'error', text: `อ่านค่าจาก PBX ไม่สำเร็จ: ${(err as Error).message}` });
    } finally {
      setLoading(false);
    }
  }, [profile.id]);

  const loadOptions = useCallback(
    async (refresh = false) => {
      setOptLoading(true);
      try {
        setOptions(await api.getRemoteOptions(profile.id, refresh));
      } catch (err) {
        setNotice({ tone: 'error', text: `โหลดรายการ subscribe ไม่สำเร็จ: ${(err as Error).message}` });
      } finally {
        setOptLoading(false);
      }
    },
    [profile.id],
  );

  useEffect(() => {
    if (!profile.api) return;
    void load().then(() => loadOptions());
  }, [profile.api, load, loadOptions]);

  if (!profile.api)
    return (
      <section className="card form-card">
        <div className="empty">ยังไม่ได้ตั้งค่า Yeastar API ของ PBX นี้ — ไปที่แท็บ "Yeastar API" ก่อน</div>
      </section>
    );
  if (!state || !form)
    return (
      <section className="card form-card">
        <NoticeBar notice={notice ?? { tone: 'info', text: 'กำลังอ่านค่าจาก PBX…' }} />
        {notice && (
          <div>
            <button className="btn" onClick={load} disabled={loading}>
              ลองใหม่
            </button>
          </div>
        )}
      </section>
    );

  const set = <K extends keyof RemoteApplyRequest>(k: K, v: RemoteApplyRequest[K]) => setForm({ ...form, [k]: v });
  const rows = diffRows(state, form, options);
  const changes = rows.filter((r) => r.changed);
  const pointsHere = form.websocketUrl === state.suggested.websocketUrl;
  const rateMismatch = form.sampleRate !== state.suggested.sampleRate;

  async function apply() {
    setApplying(true);
    setNotice(undefined);
    try {
      const st = await api.applyRemote(profile.id, form!);
      setState(st);
      setForm(formFrom(st));
      setConfirming(false);
      setNotice({ tone: 'ok', text: 'ส่งค่าไปที่ PBX แล้ว — ตารางด้านล่างแสดงค่าที่อ่านกลับมาจาก PBX' });
    } catch (err) {
      setNotice({ tone: 'error', text: `ส่งค่าไม่สำเร็จ: ${(err as Error).message}` });
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      {unsaved && <NoticeBar notice={{ tone: 'info', text: 'มีการแก้ไขที่ยังไม่ได้บันทึกในแท็บอื่น — ค่าที่ส่งไป PBX จะใช้ค่าที่บันทึกแล้ว' }} />}
      <section className="card form-card">
        <div className="row-between">
          <div className="card-title" style={{ margin: 0 }}>
            WebSocket Audio Streaming บน PBX
          </div>
          <button type="button" className="btn btn-sm" onClick={load} disabled={loading}>
            {loading ? 'กำลังอ่าน…' : 'อ่านค่าจาก PBX ใหม่'}
          </button>
        </div>
        <Toggle label="เปิดใช้งานบน PBX" hint="ปิด = PBX หยุดส่งเสียงทุกสาย" checked={form.enable} onChange={(v) => set('enable', v)} />

        <div className="suggest">
          <div>
            <div className="field-label">ค่าสำหรับส่งเสียงมาที่แอปนี้</div>
            <div className="mono small">{state.suggested.websocketUrl}</div>
            <div className="field-hint">
              header <code>{state.suggested.authKey || '(ไม่มี)'}</code> · Secret ของแอป · {state.suggested.sampleRate / 1000} kHz
            </div>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() =>
              setForm({
                ...form,
                enable: true,
                websocketUrl: state.suggested.websocketUrl,
                authKey: state.suggested.authKey,
                sampleRate: state.suggested.sampleRate,
                secretMode: 'app',
              })
            }
          >
            ใช้ค่าของแอป
          </button>
        </div>
        {!pointsHere && form.websocketUrl && (
          <NoticeBar notice={{ tone: 'info', text: 'Server Address ไม่ได้ชี้มาที่แอปนี้ — เสียงจะถูกส่งไปที่อื่น' }} />
        )}
        {rateMismatch && (
          <NoticeBar
            notice={{
              tone: 'error',
              text: `Sample rate (${form.sampleRate / 1000} kHz) ไม่ตรงกับที่ตั้งในแอป (${state.suggested.sampleRate / 1000} kHz) — เสียงจะผิดความเร็ว`,
            }}
          />
        )}

        <details className="advanced">
          <summary className="small">แก้ค่าเอง</summary>
          <div className="grid-2">
            <label className="field">
              <span className="field-label">Server Address</span>
              <input value={form.websocketUrl} onChange={(e) => set('websocketUrl', e.target.value)} placeholder="ws://192.168.1.50:8080/yeastar/..." />
            </label>
            <label className="field">
              <span className="field-label">ชื่อ field (auth_key)</span>
              <input value={form.authKey} onChange={(e) => set('authKey', e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Secret</span>
              <select value={form.secretMode} onChange={(e) => set('secretMode', e.target.value as 'app' | 'keep')}>
                <option value="app">ส่ง Secret ของแอป</option>
                <option value="keep">คงค่าเดิมบน PBX</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Sample rate</span>
              <select value={form.sampleRate} onChange={(e) => set('sampleRate', Number(e.target.value) as 8000 | 16000)}>
                <option value={8000}>8 kHz</option>
                <option value={16000}>16 kHz</option>
              </select>
            </label>
          </div>
        </details>
      </section>

      <section className="card form-card">
        <SubscribePicker
          flags={{ enableExt: form.enableExt, enableTrunk: form.enableTrunk, enableDid: form.enableDid }}
          onFlag={(f, v) => set(f, v)}
          subscribe={form.subscribe}
          onChange={(next) => set('subscribe', next)}
          options={options}
          loading={optLoading}
          onReload={() => loadOptions(true)}
        />
      </section>

      <section className="card form-card">
        <div className="card-title" style={{ margin: 0 }}>
          เทียบค่าบน PBX กับค่าที่จะส่ง
        </div>
        <div className="table-wrap">
          <table className="diff">
            <thead>
              <tr>
                <th>รายการ</th>
                <th>ค่าบน PBX ตอนนี้</th>
                <th>ค่าที่จะส่ง</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className={r.changed ? 'changed' : ''}>
                  <td>{r.label}</td>
                  <td>{r.current}</td>
                  <td>{r.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {confirming ? (
          <div className="confirm-box">
            <div className="field-label">ยืนยันส่งค่าไปที่ PBX "{profile.name}"?</div>
            <ul>
              {changes.map((r) => (
                <li key={r.label}>
                  <b>{r.label}</b>: {r.current} → {r.next}
                </li>
              ))}
            </ul>
            <div className="field-hint">ระบบจะส่งรายการ Subscribe ทั้งชุด แล้วอ่านค่ากลับจาก PBX เพื่อยืนยัน</div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={applying}>
                ยกเลิก
              </button>
              <button type="button" className="btn btn-primary" onClick={apply} disabled={applying}>
                {applying ? 'กำลังส่ง…' : 'ยืนยันส่ง'}
              </button>
            </div>
          </div>
        ) : (
          <div className="form-actions">
            <NoticeBar notice={notice} />
            <button type="button" className="btn" onClick={() => setForm(formFrom(state))} disabled={changes.length === 0}>
              ยกเลิกการแก้ไข
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)} disabled={changes.length === 0}>
              ส่งไปที่ PBX ({changes.length} รายการเปลี่ยน)
            </button>
          </div>
        )}
      </section>
    </>
  );
}
