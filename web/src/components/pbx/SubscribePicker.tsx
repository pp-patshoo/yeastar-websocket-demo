import { useMemo, useState } from 'react';
import type { RemoteOption, RemoteOptions, SubscribeItem, SubscribeType } from '../../../../shared/protocol';
import { Toggle } from '../Form';

export const TYPE_LABEL: Record<SubscribeType, string> = {
  extension: 'Extension',
  ext_group: 'กลุ่ม Extension',
  organization: 'Organization',
  trunk: 'Trunk',
  did: 'DID',
};

type Flag = 'enableExt' | 'enableTrunk' | 'enableDid';

/** Subscription types grouped under the PBX flag that switches them on. */
const GROUPS: { flag: Flag; title: string; hint: string; types: SubscribeType[] }[] = [
  {
    flag: 'enableExt',
    title: 'สายของ Extension',
    hint: 'ส่งเสียงทุกสายที่ extension ที่เลือกเกี่ยวข้อง (enable_ext)',
    types: ['extension', 'ext_group', 'organization'],
  },
  { flag: 'enableTrunk', title: 'สายผ่าน Trunk', hint: 'สายเข้า/ออกที่วิ่งผ่าน trunk ที่เลือก (enable_trunk)', types: ['trunk'] },
  { flag: 'enableDid', title: 'สายเข้าเบอร์ DID', hint: 'สายเข้าที่โทรมาที่เบอร์ DID ที่เลือก (enable_did)', types: ['did'] },
];

interface Props {
  flags: Record<Flag, boolean>;
  onFlag: (flag: Flag, v: boolean) => void;
  subscribe: SubscribeItem[];
  onChange: (next: SubscribeItem[]) => void;
  options?: RemoteOptions;
  loading: boolean;
  onReload: () => void;
}

export function SubscribePicker({ flags, onFlag, subscribe, onChange, options, loading, onReload }: Props) {
  return (
    <div className="subscribe">
      <div className="row-between">
        <div className="field-label">สายที่จะส่งเสียงมา (Subscribe)</div>
        <button type="button" className="btn btn-sm" onClick={onReload} disabled={loading}>
          {loading ? 'กำลังโหลดรายการ…' : 'โหลดรายการจาก PBX ใหม่'}
        </button>
      </div>
      {GROUPS.map((g) => (
        <div key={g.flag} className="sub-group">
          <Toggle label={g.title} hint={g.hint} checked={flags[g.flag]} onChange={(v) => onFlag(g.flag, v)} />
          <div className={`sub-types ${flags[g.flag] ? '' : 'muted-block'}`}>
            {g.types.map((t) => (
              <TypeList
                key={t}
                type={t}
                options={options?.options[t] ?? []}
                error={options?.errors[t]}
                selected={subscribe.filter((s) => s.type === t).map((s) => s.id)}
                onChange={(ids) => onChange([...subscribe.filter((s) => s.type !== t), ...ids.map((id) => ({ type: t, id }))])}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TypeList({
  type,
  options,
  error,
  selected,
  onChange,
}: {
  type: SubscribeType;
  options: RemoteOption[];
  error?: string;
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const [q, setQ] = useState('');
  const sel = new Set(selected);
  // Selected ids the PBX no longer lists still have to be visible (and removable).
  const all = useMemo(() => {
    const known = new Set(options.map((o) => o.id));
    return [...options, ...selected.filter((id) => !known.has(id)).map((id) => ({ id, text: `ID ${id} (ไม่พบในรายการของ PBX)` }))];
  }, [options, selected]);
  const shown = q ? all.filter((o) => o.text.toLowerCase().includes(q.toLowerCase())) : all;

  return (
    <details className="type-list" open={selected.length > 0 || undefined}>
      <summary>
        <span>{TYPE_LABEL[type]}</span>
        <span className="muted small">
          เลือก {selected.length}/{options.length}
        </span>
      </summary>
      {error && <div className="error-text small">{error}</div>}
      {all.length > 6 && <input className="input-sm" placeholder="ค้นหา…" value={q} onChange={(e) => setQ(e.target.value)} />}
      {all.length > 0 && (
        <div className="row-gap">
          <button type="button" className="link-btn" onClick={() => onChange([...new Set([...selected, ...shown.map((o) => o.id)])])}>
            เลือกที่แสดงทั้งหมด
          </button>
          <button type="button" className="link-btn" onClick={() => onChange([])}>
            ล้าง
          </button>
        </div>
      )}
      <div className="check-list">
        {all.length === 0 && !error && <div className="muted small">ไม่มีรายการ</div>}
        {shown.map((o) => (
          <label key={o.id} className="check-item">
            <input
              type="checkbox"
              checked={sel.has(o.id)}
              onChange={(e) => onChange(e.target.checked ? [...selected, o.id] : selected.filter((id) => id !== o.id))}
            />
            <span>{o.text}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
