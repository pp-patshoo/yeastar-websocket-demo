import { useEffect, useRef } from 'react';
import type { CallSummary, TranscriptEntry } from '../../../shared/protocol';
import { clock } from './format';

export function TranscriptPanel({ call, entries, sttReady }: { call: CallSummary; entries: TranscriptEntry[]; sttReady: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const byKey = new Map(call.channels.map((c) => [c.key, c]));
  const shown = entries.filter((e) => e.text.trim());

  // Auto-scroll only while the user is at the bottom.
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown.length, shown[shown.length - 1]?.text]);

  let empty = 'ยังไม่มีข้อความ';
  if (!call.sttEnabled) empty = sttReady ? 'ถอดเสียงปิดอยู่สำหรับสายนี้ — กดปุ่ม "เริ่มถอดเสียง" ด้านบน' : 'ยังไม่ได้ตั้งค่า AI Platform — ไปที่เมนู "ตั้งค่า AI Platform"';
  else if (!call.endedAt) empty = 'กำลังฟัง… ข้อความจะขึ้นเมื่อมีคนพูด';

  return (
    <div className="card transcript">
      <div className="card-title">ถอดเสียงสด</div>
      <div
        className="transcript-body"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {shown.length === 0 && <div className="empty">{empty}</div>}
        {shown.map((e) => {
          const ch = byKey.get(e.channelKey);
          const side = (ch?.index ?? 0) % 2;
          return (
            <div key={e.id} className={`bubble-row side-${side}`}>
              <div className={`bubble ${e.isFinal ? '' : 'interim'}`}>
                <div className="bubble-meta">
                  <span>{ch?.number || (side === 0 ? 'ฝั่ง A' : 'ฝั่ง B')}</span>
                  <span>{clock(e.at)}</span>
                </div>
                {e.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
