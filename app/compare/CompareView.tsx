"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import RetentionChart from "@/components/RetentionChart";
import RiskBadge from "@/components/RiskBadge";
import { pct, ts } from "@/lib/format";
import type { VideoRecord } from "@/lib/types";

interface Option {
  id: string;
  title: string;
  label: string;
}

export default function CompareView({ options, a, b }: { options: Option[]; a: VideoRecord | null; b: VideoRecord | null }) {
  const router = useRouter();
  const pick = (key: "a" | "b", id: string) => {
    const q = new URLSearchParams();
    const next = { a: a?.meta.id ?? "", b: b?.meta.id ?? "", [key]: id };
    if (next.a) q.set("a", next.a);
    if (next.b) q.set("b", next.b);
    router.push(`/compare?${q}`);
  };

  const pa = a?.analysis?.prediction;
  const pb = b?.analysis?.prediction;
  let verdict: { text: string; prob: number } | null = null;
  const warnings: string[] = [];
  if (pa && pb && a && b) {
    const n = Math.min(pa.avg_viewed_samples.length, pb.avg_viewed_samples.length);
    let wins = 0;
    for (let i = 0; i < n; i++) if (pb.avg_viewed_samples[i] > pa.avg_viewed_samples[i]) wins++;
    const prob = wins / n;
    const text =
      prob >= 0.75
        ? `Version B is likely to hold viewers better`
        : prob <= 0.25
          ? `Version A is likely to hold viewers better`
          : `Too close to call with this model`;
    verdict = { text, prob };
    if (pa.model_version !== pb.model_version) warnings.push("The two versions were scored by different model versions. Re-run prediction on the older one for a fair comparison.");
    if (pa.audience_preset !== pb.audience_preset) warnings.push("The two versions were scored for different audiences.");
    if (Math.abs(a.analysis!.video.duration - b.analysis!.video.duration) > 3)
      warnings.push("The versions have different lengths. Shorter videos naturally get a higher % viewed, so also compare watch seconds.");
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Compare edits</h1>
        <p className="text-sm text-ink-2">Pick two analyzed versions of the same idea. Both are scored on the same simulated audience draws.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(["a", "b"] as const).map((k) => (
          <div key={k}>
            <label className="label" htmlFor={`sel-${k}`}>
              Version {k.toUpperCase()}
            </label>
            <select id={`sel-${k}`} className="input" value={(k === "a" ? a : b)?.meta.id ?? ""} onChange={(e) => pick(k, e.target.value)}>
              <option value="">Choose a video…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                  {o.label ? ` (${o.label})` : ""}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {options.length < 2 && (
        <div className="card p-5 text-sm text-ink-2">
          You need at least two analyzed videos. <Link href="/upload" className="text-accent underline">Upload another edit</Link>.
        </div>
      )}

      {a && b && pa && pb && verdict && (
        <>
          <div className="card p-5">
            <div className="text-lg font-semibold">{verdict.text}</div>
            <div className="text-sm text-ink-2 tnum">
              B beats A in {Math.round(verdict.prob * 100)}% of {pb.avg_viewed_samples.length} simulated audience draws (average % viewed).
            </div>
            {warnings.map((w) => (
              <div key={w} className="mt-1 text-xs text-serious">⚠ {w}</div>
            ))}
            <div className="mt-1 text-xs text-muted">
              Model estimate for a simulated audience. The way to be sure is to test both edits with real viewers.
            </div>
          </div>

          <div className="card p-4">
            <RetentionChart
              duration={Math.max(a.analysis!.video.duration, b.analysis!.video.duration)}
              series={[
                { id: "a", label: `A: ${a.meta.version_label || a.meta.title}`, curve: pa.curve, color: "var(--series-1)", band: { lo: pa.curve_p10, hi: pa.curve_p90 } },
                { id: "b", label: `B: ${b.meta.version_label || b.meta.title}`, curve: pb.curve, color: "var(--series-2)", band: { lo: pb.curve_p10, hi: pb.curve_p90 } },
              ]}
            />
          </div>

          <div className="card overflow-x-auto p-4">
            <table className="w-full text-sm tnum">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 font-normal" />
                  <th className="py-1 font-normal">A</th>
                  <th className="py-1 font-normal">B</th>
                </tr>
              </thead>
              <tbody>
                <Row k="Length" a={ts(a.analysis!.video.duration)} b={ts(b.analysis!.video.duration)} />
                <Row k="Average viewed" a={`${pct(pa.avg_viewed)} (${pct(pa.avg_viewed_p10)}-${pct(pa.avg_viewed_p90)})`} b={`${pct(pb.avg_viewed)} (${pct(pb.avg_viewed_p10)}-${pct(pb.avg_viewed_p90)})`} />
                <Row k="Watch seconds" a={`${Math.round(pa.watch_seconds)}s`} b={`${Math.round(pb.watch_seconds)}s`} />
                <Row k="Gone by 0:03" a={pct(pa.opening_loss)} b={pct(pb.opening_loss)} />
                <Row k="Opening risk" a={<RiskBadge level={pa.opening_risk} />} b={<RiskBadge level={pb.opening_risk} />} />
                <Row k="Still watching at end" a={pct(pa.finish_rate)} b={pct(pb.finish_rate)} />
                <Row k="High-risk moments" a={pa.moments.filter((m) => m.severity === "high").length} b={pb.moments.filter((m) => m.severity === "high").length} />
                <Row k="Model" a={pa.model_version} b={pb.model_version} />
              </tbody>
            </table>
            <div className="mt-3 flex gap-3 text-sm">
              <Link className="text-accent underline" href={`/analysis/${a.meta.id}`}>Open A</Link>
              <Link className="text-accent underline" href={`/analysis/${b.meta.id}`}>Open B</Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ k, a, b }: { k: string; a: React.ReactNode; b: React.ReactNode }) {
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 pr-4 text-ink-2">{k}</td>
      <td className="py-1.5 pr-4">{a}</td>
      <td className="py-1.5">{b}</td>
    </tr>
  );
}
