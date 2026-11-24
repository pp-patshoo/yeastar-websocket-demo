import { useEffect, useRef } from 'react';

/** Rolling bar graph of recent audio levels (0..1), drawn on a canvas. */
export function LevelGraph({ history, active, side }: { history: number[]; active: boolean; side: 0 | 1 }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr) canvas.width = w * dpr;
    if (canvas.height !== h * dpr) canvas.height = h * dpr;
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(canvas);
    const color = css.getPropertyValue(side === 0 ? '--side-a' : '--side-b').trim();
    const muted = css.getPropertyValue('--line').trim();
    const points = 80;
    const barW = w / points;
    const start = points - history.length;
    for (let i = 0; i < points; i++) {
      const v = i >= start ? history[i - start] : 0;
      const bh = Math.max(2, v * (h - 4));
      g.fillStyle = active && v > 0.02 ? color : muted;
      g.globalAlpha = active ? 0.35 + 0.65 * (i / points) : 0.5;
      g.fillRect(i * barW + 0.5, (h - bh) / 2, Math.max(1, barW - 1.5), bh);
    }
    g.globalAlpha = 1;
  }, [history, active, side]);

  return <canvas ref={ref} className="level-graph" />;
}
