import type { ReactNode } from 'react';

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle-row">
      <span>
        <span className="field-label">{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-track" />
      </span>
    </label>
  );
}

export type Notice = { tone: 'ok' | 'error' | 'info'; text: string } | undefined;

export function NoticeBar({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <div className={`notice notice-${notice.tone}`} role="status">
      {notice.text}
    </div>
  );
}
