export function duration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function clock(ts: number) {
  return new Date(ts).toLocaleTimeString('th-TH', { hour12: false });
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export const CALLFLOW_LABEL: Record<string, string> = {
  ivr: 'IVR',
  queue: 'Queue',
  ringgroup: 'Ring Group',
  cfd: 'Call Forward',
  conference: 'Conference',
  multicast_paging: 'Paging',
};

export const STT_LABEL: Record<string, string> = {
  off: 'ปิด',
  connecting: 'กำลังเชื่อมต่อ',
  open: 'กำลังถอดเสียง',
  closing: 'กำลังปิด',
  closed: 'เสร็จสิ้น',
  error: 'ผิดพลาด',
};
