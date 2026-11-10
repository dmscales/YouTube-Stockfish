"use client";

import { useState } from "react";
import { parseRetention, pct } from "@/lib/format";
import type { Feedback, Prediction } from "@/lib/types";

interface Props {
  id: string;
  feedback: Feedback | null;
  prediction: Prediction;
  duration: number;
  onSaved: () => void;
}

const SOURCES = [
  { id: "creator_manual", label: "Copied from my YouTube Studio" },
  { id: "test_viewers", label: "My own test viewers" },
  { id: "other", label: "Other" },
];

function interp(curve: number[], t: number) {
  const i = Math.floor(t);
  const a = curve[Math.min(i, curve.length - 1)];
  const b = curve[Math.min(i + 1, curve.length - 1)];
  return a + (b - a) * (t - i);
}

export default function FeedbackPanel({ id, feedback, prediction: p, duration, onSaved }: Props) {
  const [editing, setEditing] = useState(!feedback);
  const [avg, setAvg] = useState(feedback?.avg_viewed_pct?.toString() ?? "");
  const [views, setViews] = useState(feedback?.views?.toString() ?? "");
  const [points, setPoints] = useState(feedback?.retention.map(([t, v]) => `${t} ${v}`).join("\n") ?? "");
  const [source, setSource] = useState(feedback?.source ?? "creator_manual");
  const [error, setError] = useState<string | null>(null);

  const parsed = parseRetention(points);

  async function save() {
    setError(null);
    const r = await fetch(`/api/videos/${id}/feedback`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avg_viewed_pct: avg === "" ? null : Number(avg), views: views === "" ? null : Number(views), retention: parsed, source }),
    });
    if (!r.ok) return setError((await r.json()).error ?? "Could not save");
    setEditing(false);
    onSaved();
  }

  async function clear() {
    await fetch(`/api/videos/${id}/feedback`, { method: "DELETE" });
    setAvg("");
    setPoints("");
    setViews("");
    setEditing(true);
    onSaved();
  }

  let score: { mae: number; baseMae: number; inBand: number } | null = null;
  if (feedback?.retention.length) {
    const pts = feedback.retention.filter(([t]) => t <= duration);
    if (pts.length) {
      const err = (c: number[]) => pts.reduce((s, [t, v]) => s + Math.abs(interp(c, t) - v / 100), 0) / pts.length;
      const inBand = pts.filter(([t, v]) => v / 100 >= interp(p.curve_p10, t) && v / 100 <= interp(p.curve_p90, t)).length / pts.length;
      score = { mae: err(p.curve), baseMae: err(p.baseline_curve), inBand };
    }
  }

  return (
    <section className="card p-4">
      <h2 className="font-semibold">Real results</h2>
      <p className="mb-3 text-xs text-muted">
        After you publish, log what actually happened. This is how the model gets more accurate: every logged video becomes
        training data on the <a className="underline" href="/model">Model accuracy</a> page.
      </p>

      {feedback && !editing ? (
        <div className="space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            {feedback.avg_viewed_pct != null && (
              <div>
                <div className="text-xs text-muted">Average viewed</div>
                <div className="tnum">
                  Actual <b>{feedback.avg_viewed_pct}%</b> · predicted {pct(p.avg_viewed)} ({pct(p.avg_viewed_p10)}-{pct(p.avg_viewed_p90)})
                </div>
              </div>
            )}
            {score && (
              <>
                <div>
                  <div className="text-xs text-muted">Curve error (mean, lower is better)</div>
                  <div className="tnum">
                    Model <b>{(score.mae * 100).toFixed(1)} pts</b> · typical-video baseline {(score.baseMae * 100).toFixed(1)} pts
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted">Points inside the predicted range</div>
                  <div className="tnum">
                    <b>{Math.round(score.inBand * 100)}%</b> (target about 80%)
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn btn-danger" onClick={clear}>Remove</button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="avg">Average percentage viewed (%)</label>
              <input id="avg" className="input" inputMode="decimal" value={avg} onChange={(e) => setAvg(e.target.value)} placeholder="e.g. 74" />
            </div>
            <div>
              <label className="label" htmlFor="views">Views (optional)</label>
              <input id="views" className="input" inputMode="numeric" value={views} onChange={(e) => setViews(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="src">Where the numbers came from</label>
              <select id="src" className="input" value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="pts">Retention points (optional, one per line: seconds and % still watching)</label>
            <textarea id="pts" className="input min-h-36 font-mono" value={points} onChange={(e) => setPoints(e.target.value)} placeholder={"0 100\n3 78\n10 66\n0:20 58\n0:30 51"} />
            <div className="mt-1 text-xs text-muted">{parsed.length} points read</div>
          </div>
          <div className="sm:col-span-2">
            {error && <div className="mb-2 text-sm text-critical">{error}</div>}
            <button className="btn btn-primary" onClick={save}>Save results</button>
            <p className="mt-2 text-xs text-muted">
              Only log numbers for videos you own or have permission to use. Kept on this machine and used to tune this model
              for you.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
