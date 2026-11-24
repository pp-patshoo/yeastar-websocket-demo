import type { ChannelSummary } from '../../../shared/protocol';
import { live, useLive } from '../hooks/useLive';
import { bytes, duration, STT_LABEL } from './format';
import { IconHeadphones } from './Icons';
import { LevelGraph } from './LevelGraph';

export function ChannelCard({ ch, now }: { ch: ChannelSummary; now: number }) {
  const s = useLive();
  const active = !ch.endedAt;
  const level = active ? (s.levels[ch.key] ?? 0) : 0;
  const listening = s.listening.includes(ch.key);
  const side = (ch.index % 2) as 0 | 1;
  const elapsed = (ch.endedAt ?? ch.lastFrameAt) - ch.startedAt;
  const fps = elapsed > 0 ? (ch.frames / elapsed) * 1000 : 0;

  return (
    <div className={`card channel side-${side} ${active ? '' : 'ended'}`}>
      <div className="channel-head">
        <span className="side-tag">{side === 0 ? 'ฝั่ง A' : 'ฝั่ง B'}</span>
        <div className="channel-id">
          <div className="channel-number">{ch.number || '—'}</div>
          <div className="mono muted small" title={ch.channelId}>
            {ch.channelId}
          </div>
        </div>
        <button
          className={`btn btn-sm ${listening ? 'btn-primary' : ''}`}
          disabled={!active}
          onClick={() => live.toggleListen([ch.key])}
          title={active ? 'ฟังเสียงฝั่งนี้' : 'สายจบแล้ว'}
        >
          <IconHeadphones width={15} height={15} />
          {listening ? 'กำลังฟัง' : 'ฟัง'}
        </button>
      </div>

      <div className="meter" aria-label={`ระดับเสียง ${Math.round(level * 100)}%`}>
        <div className="meter-fill" style={{ width: `${level * 100}%` }} />
      </div>
      <LevelGraph history={s.levelHistory[ch.key] ?? []} active={active} side={side} />

      <dl className="stats">
        <div>
          <dt>ระยะเวลา</dt>
          <dd>{duration((ch.endedAt ?? now) - ch.startedAt)}</dd>
        </div>
        <div>
          <dt>เฟรม</dt>
          <dd>
            {ch.frames.toLocaleString()} <span className="muted small">({fps.toFixed(1)}/s)</span>
          </dd>
        </div>
        <div>
          <dt>ข้อมูล</dt>
          <dd>{bytes(ch.bytes)}</dd>
        </div>
        <div>
          <dt>เฟรมล่าช้า</dt>
          <dd className={ch.lateFrames > 0 ? 'warn-text' : ''}>{ch.lateFrames}</dd>
        </div>
        <div className="wide">
          <dt>ถอดเสียง</dt>
          <dd>
            <span className={`pill pill-${ch.sttStatus}`}>{STT_LABEL[ch.sttStatus] ?? ch.sttStatus}</span>
            {ch.sttError && <span className="error-text small"> {ch.sttError}</span>}
          </dd>
        </div>
      </dl>
    </div>
  );
}
