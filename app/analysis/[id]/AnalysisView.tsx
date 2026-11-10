"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import RetentionChart from "@/components/RetentionChart";
import Heatmap from "@/components/Heatmap";
import RiskBadge from "@/components/RiskBadge";
import FeedbackPanel from "./FeedbackPanel";
import { pct, ts } from "@/lib/format";
import { AUDIENCE_PRESETS, type AudiencePreset, type VideoRecord } from "@/lib/types";

export default function AnalysisView({ initial }: { initial: VideoRecord }) {
  const router = useRouter();
  const [rec, setRec] = useState(initial);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const id = rec.meta.id;
  const running = rec.status.state === "queued" || rec.status.state === "processing";

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/videos/${id}`, { cache: "no-store" });
    if (r.ok) setRec(await r.json());
  }, [id]);

  useEffect(() => {
    if (!running) return;
    const h = setInterval(refresh, 1200);
    return () => clearInterval(h);
  }, [running, refresh]);

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    v.play().catch(() => {});
  };

  async function post(path: string, body: unknown, method = "POST") {
    setBusy(true);
    await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    await refresh();
  }

  async function remove() {
    if (!confirm("Delete this video, its analysis and any logged results?")) return;
    await fetch(`/api/videos/${id}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  const a = rec.analysis;
  const p = a?.prediction;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold">{rec.meta.title}</h1>
          <div className="text-sm text-muted">
            {[rec.meta.version_label, a ? ts(a.video.duration) : null, p ? (p.format === "short" ? "Short" : "Long-form") : null, rec.meta.audience.description || null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {a && (
            <Link href={`/compare?a=${id}`} className="btn">
              Compare with another edit
            </Link>
          )}
          <button className="btn" disabled={busy || running} onClick={() => post(`/api/videos/${id}/reanalyze`, { mode: "full" })}>
            Re-analyze
          </button>
          <button className="btn btn-danger" onClick={remove}>
            Delete
          </button>
        </div>
      </div>

      {running && (
        <div className="card p-5">
          <div className="mb-2 flex justify-between text-sm">
            <span>{rec.status.stage}…</span>
            <span className="text-muted tnum">{Math.round(rec.status.progress * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-surface-2">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.max(4, rec.status.progress * 100)}%` }} />
          </div>
        </div>
      )}

      {rec.status.state === "failed" && (
        <div className="card border-critical p-5">
          <div className="font-medium text-critical">Analysis failed</div>
          <div className="mt-1 text-sm text-ink-2">{rec.status.error}</div>
        </div>
      )}

      {a && p && (
        <>
          <div className="rounded-lg border border-line bg-surface-2 px-4 py-2 text-xs text-ink-2">
            {p.model_trained ? (
              <>
                Model <b>{p.model_version}</b>, fitted to your logged results. See <Link className="underline" href="/model">holdout accuracy</Link>.
              </>
            ) : (
              <>
                Model <b>{p.model_version}</b>: hand-set rules, not yet trained on real retention. Treat numbers as a risk ranking, not a forecast.{" "}
                <Link className="underline" href="/model">How it gets more accurate</Link>
              </>
            )}{" "}
            Audience: {p.audience_label}.
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Watch duration" value={`${Math.round(p.watch_seconds)}s`} sub={`range ${Math.round(p.avg_viewed_p10 * a.video.duration)}-${Math.round(p.avg_viewed_p90 * a.video.duration)}s of ${Math.round(a.video.duration)}s`} />
            <Stat
              label="Average viewed"
              value={pct(p.avg_viewed)}
              sub={`range ${pct(p.avg_viewed_p10)}-${pct(p.avg_viewed_p90)} · typical ${pct(p.baseline_avg_viewed)}`}
            />
            <Stat
              label="Opening risk"
              value={<RiskBadge level={p.opening_risk} label={p.opening_risk} />}
              sub={`${pct(p.opening_loss)} gone by 0:03 (typical ${pct(p.baseline_opening_loss)})`}
            />
            <Stat label="Still watching at end" value={pct(p.finish_rate)} sub="before any loop / rewatch" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_1fr]">
            <div className="card overflow-hidden p-2">
              <video
                ref={videoRef}
                src={`/api/videos/${id}/media`}
                controls
                playsInline
                className="mx-auto max-h-[460px] w-full rounded-lg bg-black"
                onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
              />
            </div>
            <div className="card min-w-0 p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="font-semibold">Predicted audience retention</h2>
                <span className="text-xs text-muted">Click the chart to jump the video</span>
              </div>
              <RetentionChart
                duration={a.video.duration}
                series={[
                  { id: "pred", label: "Predicted", curve: p.curve, color: "var(--series-1)", band: { lo: p.curve_p10, hi: p.curve_p90 } },
                  { id: "base", label: "Typical video this length", curve: p.baseline_curve, color: "var(--series-base)", dashed: true },
                ]}
                actual={
                  rec.feedback?.retention.length
                    ? { label: "Your real retention", points: rec.feedback.retention.map(([t, v]) => [t, v / 100] as [number, number]) }
                    : null
                }
                moments={p.moments}
                playhead={playhead}
                onSeek={seek}
              />
              {a.thumbs.length > 0 && (
                <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
                  {a.thumbs.map((t) => (
                    <button key={t.file} onClick={() => seek(t.t)} className="shrink-0" title={ts(t.t)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/videos/${id}/thumbs/${t.file}`} alt={`Frame at ${ts(t.t)}`} className="h-16 rounded object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <section className="card p-4">
            <h2 className="mb-1 font-semibold">What to change</h2>
            <p className="mb-3 text-xs text-muted">
              Ranked by the model&apos;s estimated gain in average viewed if the problem were fixed. Estimates, not guarantees.
            </p>
            {p.recommendations.length === 0 ? (
              <div className="text-sm text-ink-2">No moments stand out as riskier than a typical video of this length.</div>
            ) : (
              <ol className="space-y-3">
                {p.recommendations.map((r, i) => (
                  <li key={i} className="rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button className="font-mono text-sm text-accent underline tnum" onClick={() => seek(r.start)}>
                        {ts(r.start)}
                      </button>
                      <span className="font-medium">{r.title.replace(/^\d\d:\d\d - /, "")}</span>
                      <RiskBadge level={r.severity} label={r.severity === "info" ? "AI reviewer" : `${r.severity} risk`} />
                      {r.est_gain_pp != null && r.est_gain_pp > 0 && (
                        <span className="ml-auto text-xs text-ink-2 tnum">est. +{r.est_gain_pp.toFixed(1)} pts avg viewed</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink-2">{r.why}</p>
                    <p className="mt-1 text-sm">
                      <span className="font-medium">Suggested fix: </span>
                      {r.fix}
                    </p>
                    {r.affected.length > 0 && <p className="mt-1 text-xs text-muted">Hits hardest: {r.affected.join(", ")}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="card p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div className="flex-1">
                <h2 className="font-semibold">Simulated audience</h2>
                <p className="text-xs text-muted">
                  Eight simulated viewer types, weighted by the audience you picked. Simulated preferences, not measured people.
                </p>
              </div>
              <select
                className="input w-auto"
                value={rec.meta.audience.preset}
                disabled={running}
                onChange={(e) => post(`/api/videos/${id}`, { preset: e.target.value as AudiencePreset }, "PATCH")}
                aria-label="Audience"
              >
                {AUDIENCE_PRESETS.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </div>
            <Heatmap heatmap={p.interest_heatmap} mix={p.mix} reactions={p.reactions} segments={a.segments} duration={a.video.duration} onSeek={seek} />
          </section>

          {a.llm && (
            <section className="card p-4 text-sm">
              <h2 className="mb-1 font-semibold">AI reviewer summary</h2>
              <p className="text-ink-2">{a.llm.video_summary}</p>
              <p className="mt-1 text-ink-2">
                <span className="font-medium text-ink">Opening promise: </span>
                {a.llm.opening_promise}
              </p>
            </section>
          )}

          <section className="card p-4">
            <h2 className="mb-1 font-semibold">Timeline breakdown</h2>
            <p className="mb-3 text-xs text-muted">
              Measured observations per segment. Transcript source: {a.transcript.source.replaceAll("_", " ")}.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-normal">Time</th>
                    <th className="py-1 pr-3 font-normal">Role</th>
                    <th className="py-1 pr-3 font-normal">Cuts</th>
                    <th className="py-1 pr-3 font-normal">Static</th>
                    <th className="py-1 pr-3 font-normal">Silence</th>
                    <th className="py-1 pr-3 font-normal">WPM</th>
                    <th className="py-1 pr-3 font-normal">New words</th>
                    <th className="py-1 font-normal">Transcript</th>
                  </tr>
                </thead>
                <tbody className="tnum">
                  {a.segments.map((s) => (
                    <tr key={s.index} className="border-t border-line align-top">
                      <td className="py-1.5 pr-3">
                        <button className="text-accent underline" onClick={() => seek(s.start)}>
                          {ts(s.start)}-{ts(s.end)}
                        </button>
                      </td>
                      <td className="py-1.5 pr-3" title={s.interpretation.note}>
                        {s.interpretation.narrative_function.replace("_", " ")}
                      </td>
                      <td className="py-1.5 pr-3">{s.observations.scene_changes}</td>
                      <td className="py-1.5 pr-3">{s.observations.longest_static_s}s</td>
                      <td className="py-1.5 pr-3">{Math.round(s.observations.silence_ratio * 100)}%</td>
                      <td className="py-1.5 pr-3">{s.observations.speech_rate_wpm || "-"}</td>
                      <td className="py-1.5 pr-3">{s.observations.new_word_ratio == null ? "-" : pct(s.observations.new_word_ratio)}</td>
                      <td className="max-w-xs py-1.5 text-ink-2">{s.transcript || <span className="text-muted">-</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <FeedbackPanel id={id} feedback={rec.feedback} prediction={p} duration={a.video.duration} onSaved={refresh} />

          {a.warnings.length > 0 && (
            <ul className="space-y-1 text-xs text-muted">
              {a.warnings.map((w) => (
                <li key={w}>Note: {w}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tnum">{value}</div>
      <div className="mt-1 text-xs text-ink-2 tnum">{sub}</div>
    </div>
  );
}
