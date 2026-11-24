import { useEffect, useState } from 'react';
import type { AiSettingsView } from '../../../shared/protocol';
import { api } from '../api/settings';
import { Field, NoticeBar, Toggle, type Notice } from '../components/Form';
import { useLive } from '../hooks/useLive';

const LANGUAGES = [
  { code: 'th', label: 'ไทย (th)' },
  { code: 'en', label: 'English (en)' },
  { code: 'multi', label: 'หลายภาษาในสายเดียว (multi)' },
  { code: 'zh', label: '中文 (zh)' },
  { code: 'ja', label: '日本語 (ja)' },
];

export function AiSettingsPage() {
  const s = useLive();
  const [saved, setSaved] = useState<AiSettingsView>();
  const [form, setForm] = useState<Omit<AiSettingsView, 'hasApiKey' | 'apiKeyMasked'>>();
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [test, setTest] = useState<Notice>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getAi().then(
      (v) => {
        setSaved(v);
        const { hasApiKey: _h, apiKeyMasked: _m, ...rest } = v;
        setForm(rest);
      },
      (e) => setNotice({ tone: 'error', text: `โหลดค่าไม่สำเร็จ: ${e.message}` }),
    );
  }, []);

  if (!form || !saved) return <NoticeBar notice={notice ?? { tone: 'info', text: 'กำลังโหลด…' }} />;
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm({ ...form, [k]: v });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(undefined);
    try {
      const v = await api.saveAi({ ...form!, apiKey: apiKey || undefined, clearApiKey: clearKey });
      setSaved(v);
      setApiKey('');
      setClearKey(false);
      setNotice({ tone: 'ok', text: 'บันทึกแล้ว — มีผลกับ stream ใหม่ทันที' });
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setTest({ tone: 'info', text: 'กำลังทดสอบการเชื่อมต่อ Deepgram…' });
    try {
      const r = await api.testAi({ ...form!, apiKey: apiKey || undefined, clearApiKey: clearKey });
      setTest({ tone: r.ok ? 'ok' : 'error', text: r.message });
    } catch (err) {
      setTest({ tone: 'error', text: (err as Error).message });
    }
  }

  const keyPlaceholder = saved.hasApiKey && !clearKey ? `บันทึกไว้แล้ว ${saved.apiKeyMasked} — เว้นว่างเพื่อใช้ค่าเดิม` : 'วาง API key ที่นี่';

  return (
    <form className="settings" onSubmit={save}>
      <p className="lead">
        ตั้งค่าบริการถอดเสียง (Speech-to-Text) ที่ใช้แปลงเสียงจากสายเป็นข้อความแบบเรียลไทม์ แอปจะเปิด 1 stream ต่อเสียง 1 ฝั่ง
        (สาย 1:1 ใช้ 2 stream) และคิดค่าบริการตามนาทีของแต่ละ stream
      </p>

      <section className="card form-card">
        <div className="card-title">ผู้ให้บริการ</div>
        <Field label="AI Platform" htmlFor="provider">
          <select id="provider" value={form.provider} onChange={() => set('provider', 'deepgram')}>
            <option value="deepgram">Deepgram (Live Streaming API)</option>
          </select>
        </Field>
        <Field
          label="API Key"
          htmlFor="apikey"
          hint={
            <>
              สร้างได้ที่ console.deepgram.com → API Keys (บัญชีใหม่ได้เครดิตทดลองใช้ฟรี) · key เก็บไว้ที่ server เท่านั้น
              {saved.hasApiKey && (
                <label className="inline-check">
                  <input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} /> ลบ key ที่บันทึกไว้
                </label>
              )}
            </>
          }
        >
          <input
            id="apikey"
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={clearKey}
            placeholder={keyPlaceholder}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Field>
      </section>

      <section className="card form-card">
        <div className="card-title">การถอดเสียง</div>
        <div className="grid-2">
          <Field label="Model" htmlFor="model" hint="แนะนำ nova-3 (รองรับภาษาไทยแบบ streaming)">
            <input id="model" list="models" value={form.model} onChange={(e) => set('model', e.target.value)} />
            <datalist id="models">
              <option value="nova-3" />
              <option value="nova-2" />
            </datalist>
          </Field>
          <Field label="ภาษา" htmlFor="lang">
            <select id="lang" value={form.language} onChange={(e) => set('language', e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
              {!LANGUAGES.some((l) => l.code === form.language) && <option value={form.language}>{form.language}</option>}
            </select>
          </Field>
        </div>
        <Toggle
          label="เริ่มถอดเสียงอัตโนมัติกับทุกสายใหม่"
          hint="ถ้าปิด ยังกดเริ่มถอดเสียงเองรายสายได้จากหน้า Dashboard · ปิดสวิตช์นี้จะหยุด stream ที่กำลังทำงานทั้งหมด"
          checked={form.enabled}
          onChange={(v) => set('enabled', v)}
        />
        <Toggle label="แสดงข้อความระหว่างพูด (interim results)" hint="ข้อความจะขึ้นทันทีแบบจาง ๆ แล้วถูกแทนด้วยผลสุดท้าย" checked={form.interimResults} onChange={(v) => set('interimResults', v)} />
        <Toggle label="จัดรูปแบบอัตโนมัติ (smart format)" hint="ใส่เครื่องหมายวรรคตอน ตัวเลข วันที่ ให้อ่านง่าย" checked={form.smartFormat} onChange={(v) => set('smartFormat', v)} />
      </section>

      <section className="card form-card">
        <div className="card-title">สถานะ</div>
        <div className="status-line">
          <span className={`dot ${!s.stt.configured ? 'dot-warn' : s.stt.activeStreams ? 'dot-ok' : 'dot-off'}`} />
          {s.stt.configured ? `พร้อมใช้งาน · ${s.stt.activeStreams} stream กำลังทำงาน` : 'ยังไม่ได้บันทึก API key'}
        </div>
        <NoticeBar notice={test} />
      </section>

      <div className="form-actions">
        <NoticeBar notice={notice} />
        <button type="button" className="btn" onClick={runTest}>
          ทดสอบการเชื่อมต่อ
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </div>
    </form>
  );
}
