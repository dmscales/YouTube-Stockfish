"use client";

import { useState } from "react";
import { ts } from "@/lib/format";
import { ARCHETYPE_LABELS, type Reaction, type Segment } from "@/lib/types";

interface Props {
  heatmap: Record<string, number[]>;
  mix: Record<string, number>;
  reactions: Reaction[];
  segments: Segment[];
  duration: number;
  onSeek?: (t: number) => void;
}

const MAX_COLS = 90;

export default function Heatmap({ heatmap, mix, reactions, segments, duration, onSeek }: Props) {
  const [tip, setTip] = useState<{ a: string; t0: number; t1: number; v: number; x: number; y: number } | null>(null);
  const ids = Object.keys(heatmap).sort((a, b) => (mix[b] ?? 0) - (mix[a] ?? 0));
  const T = heatmap[ids[0]]?.length ?? 0;
  const bucket = Math.max(1, Math.ceil(T / MAX_COLS));
  const cols = Math.ceil(T / bucket);

  const reactionFor = (a: string, t: number) => {
    const seg = segments.find((s) => t >= s.start && t < s.end) ?? segments[segments.length - 1];
    return reactions.find((r) => r.viewer_type === a && r.segment_index === seg?.index);
  };

  const r = tip ? reactionFor(tip.a, tip.t0) : null;

  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
          <tbody>
            {ids.map((a) => (
              <tr key={a}>
                <th scope="row" className="whitespace-nowrap pr-2 text-left text-xs font-normal text-ink-2">
                  {ARCHETYPE_LABELS[a] ?? a}
                  <span className="ml-1 text-muted tnum">{Math.round((mix[a] ?? 0) * 100)}%</span>
                </th>
                {Array.from({ length: cols }, (_, c) => {
                  const vals = heatmap[a].slice(c * bucket, (c + 1) * bucket);
                  const interest = vals.reduce((s, v) => s + v, 0) / vals.length;
                  const pressure = Math.max(0, Math.min(1, (1 - interest - 0.2) / 0.6));
                  return (
                    <td
                      key={c}
                      className="h-5 min-w-[6px] cursor-pointer rounded-[3px] p-0"
                      style={{ background: `color-mix(in oklab, var(--seq-hi) ${Math.round(pressure * 100)}%, var(--seq-lo))` }}
                      onMouseEnter={(e) => {
                        const box = (e.currentTarget.closest(".relative") as HTMLElement).getBoundingClientRect();
                        const cell = e.currentTarget.getBoundingClientRect();
                        setTip({ a, t0: c * bucket, t1: Math.min(duration, (c + 1) * bucket), v: interest, x: cell.left - box.left, y: cell.bottom - box.top });
                      }}
                      onMouseLeave={() => setTip(null)}
                      onClick={() => onSeek?.(c * bucket)}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        <span>Holding attention</span>
        <span className="h-2 w-24 rounded" style={{ background: "linear-gradient(to right, var(--seq-lo), var(--seq-hi))" }} />
        <span>Likely to swipe away</span>
      </div>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 w-64 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.max(0, Math.min(tip.x - 100, 520)), top: tip.y + 6 }}
        >
          <div className="font-semibold">
            {ARCHETYPE_LABELS[tip.a]} · {ts(tip.t0)}
            {tip.t1 - tip.t0 > 1 ? `-${ts(tip.t1)}` : ""}
          </div>
          <div className="text-ink-2 tnum">Interest score {tip.v.toFixed(2)} (heuristic, 0-1)</div>
          {r && (
            <div className="mt-1 text-ink-2">
              <div>
                <span className="font-medium text-ink">{r.reason}</span> · {r.dropout_risk} risk
              </div>
              {r.evidence && <div className="text-muted">{r.evidence}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
