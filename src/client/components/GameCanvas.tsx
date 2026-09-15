import { useEffect, useRef } from 'react';
import { randomUUID } from './uuid';
import type { Point, Stroke } from '../../shared/types';

interface Props {
  strokes: Stroke[];
  enabled?: boolean;
  onStart?: (id: string) => void;
  onPoints?: (id: string, points: Point[]) => void;
  onEnd?: (id: string) => void;
  onUndo?: () => void;
  onClear?: () => void;
}

export function GameCanvas({ strokes, enabled = false, onStart, onPoints, onEnd, onUndo, onClear }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const active = useRef<string | null>(null);
  const pending = useRef<Point[]>([]);
  const frame = useRef<number | null>(null);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(rect.width * ratio) || canvas.height !== Math.round(rect.height * ratio)) {
      canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = '#101018'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const stroke of strokes) {
      if (!stroke.points.length) continue;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x * rect.width, stroke.points[0].y * rect.height);
      for (const point of stroke.points.slice(1)) ctx.lineTo(point.x * rect.width, point.y * rect.height);
      if (stroke.points.length === 1) ctx.lineTo(stroke.points[0].x * rect.width + .1, stroke.points[0].y * rect.height + .1);
      ctx.stroke();
    }
  };

  useEffect(() => {
    draw();
    const observer = new ResizeObserver(draw);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [strokes]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const flush = () => {
    frame.current = null;
    if (active.current && pending.current.length) onPoints?.(active.current, pending.current.splice(0));
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!enabled || !active.current) return;
    pending.current.push(point(event));
    if (frame.current === null) frame.current = requestAnimationFrame(flush);
  };
  const end = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active.current) return;
    pending.current.push(point(event)); flush(); onEnd?.(active.current); active.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className={`canvas-wrap ${enabled ? 'drawing-enabled' : ''}`}>
      <canvas
        ref={canvasRef} aria-label="Lienzo de dibujo"
        onPointerDown={event => { if (!enabled) return; active.current = randomUUID(); event.currentTarget.setPointerCapture(event.pointerId); onStart?.(active.current); pending.current.push(point(event)); }}
        onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      />
      {enabled && <div className="canvas-tools">
        <button className="button secondary" onClick={onUndo}>Deshacer</button>
        <button className="button danger" onClick={() => confirm('¿Limpiar todo el lienzo?') && onClear?.()}>Limpiar</button>
      </div>}
    </div>
  );
}
