import { useState } from 'react';
import { IconCopy } from './Icons';

export function CopyButton({ text, label = 'คัดลอก' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // The clipboard API needs https or localhost; fall back to a prompt.
          window.prompt('คัดลอกข้อความนี้', text);
        }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      <IconCopy width={14} height={14} />
      {done ? 'คัดลอกแล้ว' : label}
    </button>
  );
}
