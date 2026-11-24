import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CallSummary } from '../../../shared/protocol';
import { ChannelCard } from '../components/ChannelCard';
import { CALLFLOW_LABEL, clock, duration } from '../components/format';
import { IconHeadphones, IconPhone } from '../components/Icons';
import { TranscriptPanel } from '../components/TranscriptPanel';
import { live, useLive } from '../hooks/useLive';

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function DashboardPage() {
  const s = useLive();
  const now = useNow();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [pbxFilter, setPbxFilter] = useState('all');

  const profiles = s.pbx.profiles;
  const multi = profiles.length > 1;
  const calls = pbxFilter === 'all' ? s.calls : s.calls.filter((c) => c.pbxId === pbxFilter);
  const active = calls.filter((c) => !c.endedAt);
  const ended = calls.filter((c) => c.endedAt);

  // Follow the newest active call unless the user picked one that is still listed.
  const selected = calls.find((c) => c.key === selectedKey) ?? active[0] ?? ended[0];
  const sttReady = s.stt.configured;
  const totalChannels = active.reduce((n, c) => n + c.channels.filter((ch) => !ch.endedAt).length, 0);
  const enabledPbx = profiles.filter((p) => p.enabled);
  const connectedPbx = enabledPbx.filter((p) => p.connections.length);
  const rejected = enabledPbx.filter((p) => p.lastAttempt && !p.lastAttempt.accepted && !p.connections.length);

  return (
    <div className="dashboard">
      <section className="kpis">
        <div className="card kpi">
          <div className="kpi-label">Yeastar PBX</div>
          <div className="kpi-value">
            <span className={`dot ${rejected.length ? 'dot-warn' : connectedPbx.length ? 'dot-ok' : 'dot-off'}`} />
            {enabledPbx.length ? `${connectedPbx.length}/${enabledPbx.length} เชื่อมต่อ` : 'ยังไม่มี PBX'}
          </div>
          <div className="kpi-sub">
            {rejected.length
              ? `ถูกปฏิเสธ: ${rejected.map((p) => p.name).join(', ')}`
              : connectedPbx.length
                ? connectedPbx.map((p) => p.name).join(', ')
                : enabledPbx.length
                  ? 'รอ PBX เชื่อมเข้ามา'
                  : <Link to="/settings/pbx">เพิ่ม PBX →</Link>}
          </div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">สายที่กำลังสตรีม</div>
          <div className="kpi-value num">{active.length}</div>
          <div className="kpi-sub">{totalChannels} channel เสียง</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">ถอดเสียง (Deepgram)</div>
          <div className="kpi-value">
            <span className={`dot ${!s.stt.configured ? 'dot-warn' : s.stt.activeStreams ? 'dot-ok' : 'dot-off'}`} />
            {!s.stt.configured ? 'ยังไม่ตั้งค่า' : `${s.stt.activeStreams} stream`}
          </div>
          <div className="kpi-sub">
            {s.stt.configured ? (s.stt.enabled ? 'เริ่มอัตโนมัติกับสายใหม่' : 'เริ่มเองรายสาย') : <Link to="/settings/ai">ไปตั้งค่า →</Link>}
          </div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">สายที่จบแล้ว</div>
          <div className="kpi-value num">{ended.length}</div>
          <div className="kpi-sub">เก็บไว้ในหน่วยความจำ 20 สายล่าสุด</div>
        </div>
      </section>

      <section className="dash-grid">
        <div className="card call-list">
          <div className="card-title row-between">
            <span>สายสนทนา</span>
            {multi && (
              <select className="select-sm" value={pbxFilter} onChange={(e) => setPbxFilter(e.target.value)} aria-label="กรองตาม PBX">
                <option value="all">PBX ทั้งหมด</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {calls.length === 0 && (
            <div className="empty">
              ยังไม่มีสาย — ตั้งค่า PBX ให้ส่งเสียงมาที่แอปนี้ (<Link to="/settings/pbx">ดูวิธีตั้งค่า</Link>)
              หรือรัน <code>npm run mock-pbx</code> เพื่อทดสอบ
            </div>
          )}
          {active.length > 0 && <div className="list-label">กำลังคุย</div>}
          {active.map((c) => (
            <CallRow key={c.key} call={c} now={now} showPbx={multi} selected={c.key === selected?.key} onSelect={setSelectedKey} />
          ))}
          {ended.length > 0 && <div className="list-label">จบแล้ว</div>}
          {ended.map((c) => (
            <CallRow key={c.key} call={c} now={now} showPbx={multi} selected={c.key === selected?.key} onSelect={setSelectedKey} />
          ))}
        </div>

        <div className="call-detail">
          {selected ? (
            <>
              <div className="card call-head">
                <div>
                  <div className="call-title">
                    {selected.channels.map((c) => c.number || '?').join(' ↔ ')}
                    <span className="pill pill-pbx">{selected.pbxName}</span>
                    {selected.callflow && <span className="pill">{CALLFLOW_LABEL[selected.callflow] ?? selected.callflow}</span>}
                    <span className={`pill ${selected.endedAt ? '' : 'pill-open'}`}>{selected.endedAt ? 'จบแล้ว' : 'กำลังคุย'}</span>
                  </div>
                  <div className="muted small mono">
                    callid {selected.callId} · {selected.sampleRate / 1000} kHz · {duration((selected.endedAt ?? now) - selected.startedAt)}
                  </div>
                </div>
                <div className="call-actions">
                  {!selected.endedAt && (
                    <>
                      <button className="btn" onClick={() => live.toggleListen(selected.channels.filter((c) => !c.endedAt).map((c) => c.key))}>
                        <IconHeadphones width={16} height={16} />
                        {selected.channels.every((c) => c.endedAt || s.listening.includes(c.key)) ? 'หยุดฟัง' : 'ฟังทั้งสองฝั่ง (ซ้าย/ขวา)'}
                      </button>
                      <button
                        className={`btn ${selected.sttEnabled ? '' : 'btn-primary'}`}
                        disabled={!sttReady}
                        title={sttReady ? '' : 'ยังไม่ได้ใส่ Deepgram API key'}
                        onClick={() => live.setCallStt(selected.key, !selected.sttEnabled)}
                      >
                        {selected.sttEnabled ? 'หยุดถอดเสียง' : 'เริ่มถอดเสียง'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="channels">
                {selected.channels.map((ch) => (
                  <ChannelCard key={ch.key} ch={ch} now={now} />
                ))}
              </div>
              <TranscriptPanel call={selected} entries={s.transcripts[selected.key] ?? []} sttReady={sttReady} />
            </>
          ) : (
            <div className="card empty-state">
              <IconPhone width={32} height={32} />
              <div>เลือกสายจากรายการ หรือรอสายใหม่เข้ามา</div>
            </div>
          )}
        </div>
      </section>

      <details className="card inspector">
        <summary className="card-title">Message inspector ({s.inspector.length})</summary>
        <p className="muted small">ข้อความ JSON ดิบจาก PBX (ตัดฟิลด์ audio ให้สั้น, แสดงเฟรมเสียงสูงสุดทุก 0.5 วินาที แต่แสดงข้อความ end ทุกครั้ง)</p>
        <div className="inspector-body mono">
          {s.inspector.length === 0 && <div className="muted">ยังไม่มีข้อความ</div>}
          {s.inspector.map((m, i) => (
            <div key={`${m.at}-${i}`} className="inspector-row">
              <span className="muted">
                {clock(m.at)} {m.pbxName} · {m.connId}
              </span>{' '}
              {m.raw}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function CallRow({
  call,
  now,
  selected,
  showPbx,
  onSelect,
}: {
  call: CallSummary;
  now: number;
  selected: boolean;
  showPbx: boolean;
  onSelect: (key: string) => void;
}) {
  return (
    <button className={`call-row ${selected ? 'selected' : ''}`} onClick={() => onSelect(call.key)}>
      <span className={`dot ${call.endedAt ? 'dot-off' : 'dot-ok pulse'}`} />
      <span className="call-row-main">
        <span className="call-row-title">{call.channels.map((c) => c.number || '?').join(' ↔ ')}</span>
        <span className="muted small">
          {showPbx && <span className="pill pill-pbx">{call.pbxName}</span>} {clock(call.startedAt)}
          {call.callflow ? ` · ${CALLFLOW_LABEL[call.callflow] ?? call.callflow}` : ''}
          {` · ${call.channels.length} ch`}
        </span>
      </span>
      <span className="mono small">{duration((call.endedAt ?? now) - call.startedAt)}</span>
    </button>
  );
}
