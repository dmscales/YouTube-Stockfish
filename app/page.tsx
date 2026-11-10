import Link from "next/link";
import { listVideos } from "@/lib/store";
import { pct, ts } from "@/lib/format";
import RiskBadge from "@/components/RiskBadge";

export const dynamic = "force-dynamic";

export default async function Home() {
  const videos = await listVideos();

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <h1 className="text-2xl font-semibold">Check a draft before it goes live</h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          Upload an unfinished Short. Draft Check breaks it into scenes, sound and speech, runs it past eight simulated viewer
          types, flags where people are likely to swipe away, and tells you exactly what to cut or move. Log real results after
          you publish and the model retrains on them.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/upload" className="btn btn-primary">Analyze a draft</Link>
          <Link href="/compare" className="btn">Compare two edits</Link>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Your drafts</h2>
        {videos.length === 0 ? (
          <div className="card p-8 text-center text-ink-2">
            No drafts yet. <Link href="/upload" className="text-accent underline">Upload your first one</Link>.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((v) => (
              <Link key={v.meta.id} href={`/analysis/${v.meta.id}`} className="card flex gap-3 p-3 transition hover:border-accent">
                <div className="h-24 w-16 shrink-0 overflow-hidden rounded-md bg-surface-2">
                  {v.thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/videos/${v.meta.id}/thumbs/${v.thumb}`} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{v.meta.title}</div>
                  <div className="text-xs text-muted">
                    {v.meta.version_label && <span>{v.meta.version_label} · </span>}
                    {v.duration != null ? ts(v.duration) : "--:--"} · {new Date(v.meta.created_at).toLocaleDateString()}
                  </div>
                  {v.status.state === "done" && v.avg_viewed != null ? (
                    <div className="mt-2 space-y-1 text-sm">
                      <div className="tnum">
                        <span className="font-semibold">{pct(v.avg_viewed)}</span>{" "}
                        <span className="text-muted">avg viewed ({pct(v.avg_viewed_p10)}-{pct(v.avg_viewed_p90)})</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {v.opening_risk && <RiskBadge level={v.opening_risk} label={`${v.opening_risk} opening risk`} />}
                        {v.has_feedback && <span className="text-xs text-good">● real results logged</span>}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-ink-2">
                      {v.status.state === "failed" ? <span className="text-critical">Failed</span> : `${v.status.stage}…`}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
