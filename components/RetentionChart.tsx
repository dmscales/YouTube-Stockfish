"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ts } from "@/lib/format";

export interface Series {
  id: string;
  label: string;
  curve: number[]; // value at each whole second, 0..1
  color: string;
  dashed?: boolean;
  band?: { lo: number[]; hi: number[] };
}

interface Props {
  duration: number;
  series: Series[];
  actual?: { label: string; points: [number, number][] } | null; // [sec, 0..1]
  moments?: { start: number; end: number; severity: string }[];
  playhead?: number | null;
  onSeek?: (t: number) => void;
  height?: number;
}

const PAD = { l: 40, r: 12, t: 12, b: 26 };

export default function RetentionChart({ duration, series, actual, moments = [], playhead, onSeek, height = 260 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const iw = width - PAD.l - PAD.r;
  const ih = height - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + (Math.min(t, duration) / duration) * iw;
  const y = (v: number) => PAD.t + (1 - Math.max(0, Math.min(1, v))) * ih;

  const pathFor = (curve: number[]) =>
    curve.map((v, i) => `${i === 0 ? "M" : "L"}${x(Math.min(i, duration)).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const bandPath = (lo: number[], hi: number[]) => {
    const top = hi.map((v, i) => `${i === 0 ? "M" : "L"}${x(Math.min(i, duration)).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const bottom = lo
      .map((v, i) => [i, v] as const)
      .reverse()
      .map(([i, v]) => `L${x(Math.min(i, duration)).toFixed(1)},${y(v).toFixed(1)}`)
      .join("");
    return `${top}${bottom}Z`;
  };

  const xticks = useMemo(() => {
    const step = duration <= 20 ? 5 : duration <= 70 ? 10 : duration <= 180 ? 30 : duration <= 600 ? 60 : 120;
    const out = [];
    for (let t = 0; t <= duration + 0.01; t += step) out.push(t);
    return out;
  }, [duration]);

  const valueAt = (curve: number[], t: number) => {
    const i = Math.floor(t);
    const f = t - i;
    const a = curve[Math.min(i, curve.length - 1)] ?? 0;
    const b = curve[Math.min(i + 1, curve.length - 1)] ?? a;
    return a + (b - a) * f;
  };

  const tFromEvent = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    return Math.max(0, Math.min(duration, ((px - PAD.l) / iw) * duration));
  };

  const tipLeft = hover != null ? Math.min(width - 190, Math.max(0, x(hover) + 12)) : 0;

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Predicted audience retention over time"
        className="block touch-none"
        onPointerMove={(e) => setHover(tFromEvent(e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => onSeek?.(tFromEvent(e as unknown as React.PointerEvent<SVGSVGElement>))}
        style={{ cursor: onSeek ? "pointer" : "default" }}
      >
        {moments.map((m, i) => (
          <rect
            key={i}
            x={x(m.start)}
            y={PAD.t}
            width={Math.max(2, x(m.end) - x(m.start))}
            height={ih}
            fill={m.severity === "high" ? "var(--critical)" : "var(--serious)"}
            opacity={0.1}
          />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={width - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)" className="tnum">
              {v * 100}%
            </text>
          </g>
        ))}
        {xticks.map((t) => (
          <text key={t} x={x(t)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--muted)" className="tnum">
            {ts(t)}
          </text>
        ))}
        {series.map((s) => s.band && <path key={`${s.id}-band`} d={bandPath(s.band.lo, s.band.hi)} fill={s.color} opacity={0.14} />)}
        {series.map((s) => (
          <path
            key={s.id}
            d={pathFor(s.curve)}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeDasharray={s.dashed ? "5 4" : undefined}
            strokeLinejoin="round"
          />
        ))}
        {actual?.points.map(([t, v], i) => (
          <circle key={i} cx={x(t)} cy={y(v)} r={4} fill="var(--series-2)" stroke="var(--surface)" strokeWidth={2} />
        ))}
        {playhead != null && <line x1={x(playhead)} x2={x(playhead)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--text)" strokeWidth={1.5} />}
        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--muted)" strokeDasharray="2 3" />
            {series.map((s) => (
              <circle key={s.id} cx={x(hover)} cy={y(valueAt(s.curve, hover))} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-2 w-[180px] rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
          style={{ left: tipLeft }}
        >
          <div className="mb-1 font-semibold tnum">{ts(hover)}</div>
          {series.map((s) => (
            <div key={s.id} className="flex items-center gap-2 text-ink-2">
              <span className="inline-block h-0.5 w-3" style={{ background: s.color }} />
              <span className="truncate">{s.label}</span>
              <span className="ml-auto font-medium text-ink tnum">{(valueAt(s.curve, hover) * 100).toFixed(0)}%</span>
            </div>
          ))}
          {series
            .filter((s) => s.band)
            .map((s) => (
              <div key={`${s.id}-r`} className="text-muted tnum">
                range {(valueAt(s.band!.lo, hover) * 100).toFixed(0)}-{(valueAt(s.band!.hi, hover) * 100).toFixed(0)}%
              </div>
            ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        {series.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" x2="18" y1="3" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} />
            </svg>
            {s.label}
            {s.band && " (shaded: 10th-90th percentile)"}
          </span>
        ))}
        {actual && actual.points.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--series-2)" }} />
            {actual.label}
          </span>
        )}
        {moments.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-3" style={{ background: "var(--critical)", opacity: 0.25 }} />
            Risk moments
          </span>
        )}
      </div>
    </div>
  );
}
