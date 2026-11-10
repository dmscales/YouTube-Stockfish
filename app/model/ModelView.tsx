"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Model = { params: any; report: any };

export default function ModelView({ initial, counts }: { initial: Model; counts: { analyzed: number; labeled: number } }) {
  const router = useRouter();
  const [model, setModel] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string | null>(null);

  async function train(dryRun: boolean) {
    setBusy(true);
    setLog(null);
    const r = await fetch("/api/model", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dryRun }) });
    const j = await r.json();
    setModel({ params: j.params, report: j.report });
    setLog(j.output);
    setBusy(false);
    router.refresh();
  }

  const p = model.params;
  const rep = model.report;
  const cv = rep?.cv;
  const s = cv?.summary;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Model accuracy</h1>
        <p className="max-w-3xl text-sm text-ink-2">
          The first version runs on hand-set rules. It only becomes a real prediction engine once it has been checked against
          what actually happened. Log real retention on published videos, then train here. Accuracy is measured on videos the
          model did not see during training.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Current model" value={p?.version ?? "heuristic-v0"} sub={p?.trained ? `fitted on ${p.n_videos} videos` : "hand-set rules, untrained"} />
        <Tile label="Analyzed drafts" value={counts.analyzed} sub="videos with a prediction" />
        <Tile label="With real results" value={counts.labeled} sub="need at least 3 to train" />
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy || counts.labeled < 3} onClick={() => train(false)}>
          {busy ? "Working…" : "Train on my results"}
        </button>
        <button className="btn" disabled={busy || counts.labeled < 3} onClick={() => train(true)}>
          Evaluate only
        </button>
        {counts.labeled < 3 && <span className="self-center text-xs text-muted">Log real results on {3 - counts.labeled} more video(s) to unlock training.</span>}
      </div>

      {rep?.status === "not_enough_data" && <div className="card p-4 text-sm text-ink-2">{rep.message}</div>}

      {s && (
        <div className="card overflow-x-auto p-4">
          <h2 className="font-semibold">Holdout accuracy</h2>
          <p className="mb-3 text-xs text-muted">
            Held out one {cv.holdout} at a time ({cv.folds} folds). Error is in percentage points of viewers still watching, so lower is better.
          </p>
          <table className="w-full text-sm tnum">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 font-normal">Model</th>
                <th className="py-1 font-normal">Retention curve error</th>
                <th className="py-1 font-normal">Avg viewed error</th>
                <th className="py-1 font-normal">Range coverage</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["baseline", "Duration-only baseline (no video analysis)"],
                ["heuristic", "Hand-set rules (heuristic-v0)"],
                ["trained", "Trained on your results"],
              ].map(([k, label]) => (
                <tr key={k} className="border-t border-line">
                  <td className="py-1.5 pr-4">{label}</td>
                  <td className="py-1.5 pr-4">{s[k].curve_mae_pp ?? "-"}{s[k].curve_mae_pp != null && " pts"}</td>
                  <td className="py-1.5 pr-4">{s[k].avg_viewed_err_pp ?? "-"}{s[k].avg_viewed_err_pp != null && " pts"}</td>
                  <td className="py-1.5">{k === "trained" && s[k].band_coverage != null ? `${Math.round(s[k].band_coverage * 100)}% (target ~80%)` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 text-sm">
            {cv.improvement_over_baseline_pct == null ? (
              "Not enough comparable data to score improvement yet."
            ) : cv.beats_target ? (
              <span className="text-good">
                ● Beats the baseline by {cv.improvement_over_baseline_pct}% on unseen {cv.holdout === "channel" ? "channels" : "videos"} (target: 20%).
              </span>
            ) : (
              <span>
                ◆ {cv.improvement_over_baseline_pct}% better than the baseline on unseen {cv.holdout === "channel" ? "channels" : "videos"}. Target is 20% before
                calling it a prediction engine.
              </span>
            )}
          </div>
          {cv.folds < 10 && <p className="mt-2 text-xs text-muted">With fewer than ~10 videos these numbers swing a lot. Keep logging.</p>}
        </div>
      )}

      {p?.betas && (
        <div className="card p-4">
          <h2 className="mb-2 font-semibold">What the model has learned</h2>
          <p className="mb-3 text-xs text-muted">How strongly each signal raises the chance a viewer leaves (1.0 roughly means 2.7x the hazard at full strength).</p>
          <div className="space-y-1.5">
            {Object.entries(p.betas as Record<string, number>).map(([k, v]) => (
              <div key={k} className="flex items-center gap-3 text-sm">
                <span className="w-36 shrink-0 text-ink-2">{k.replaceAll("_", " ")}</span>
                <span className="h-2 rounded" style={{ width: `${Math.min(100, v * 50)}%`, background: "var(--series-1)" }} />
                <span className="tnum text-xs">{v.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-4 text-sm text-ink-2">
        <h2 className="mb-1 font-semibold text-ink">About the training data</h2>
        <p>
          Results you log stay on this machine and only train your copy of the model. If you later pull retention from the YouTube
          Analytics API, check YouTube&apos;s developer policies first: they restrict pooling data across content owners and building
          derived metrics from API data. Running your own test-viewer sessions is the cleanest way to build a shared dataset.
        </p>
      </div>

      {log && <pre className="card overflow-x-auto p-3 text-xs">{log}</pre>}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tnum">{value}</div>
      <div className="mt-1 text-xs text-ink-2">{sub}</div>
    </div>
  );
}
