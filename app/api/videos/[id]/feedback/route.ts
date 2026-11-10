import { NextResponse } from "next/server";
import { deleteFeedback, getVideo, saveFeedback } from "@/lib/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const rec = await getVideo(id).catch(() => null);
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = await req.json();
  const num = (v: unknown) => (v === null || v === "" || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const retention: [number, number][] = Array.isArray(b.retention)
    ? b.retention
        .map((p: unknown) => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : null))
        .filter((p: number[] | null): p is [number, number] => !!p && p.every(Number.isFinite) && p[0] >= 0 && p[1] >= 0)
        .slice(0, 2000)
    : [];
  const avg = num(b.avg_viewed_pct);
  if (!retention.length && avg === null) {
    return NextResponse.json({ error: "Add an average-viewed % or at least two retention points" }, { status: 400 });
  }
  if (avg !== null && (avg < 0 || avg > 400)) {
    return NextResponse.json({ error: "Average viewed % looks wrong" }, { status: 400 });
  }
  await saveFeedback(id, {
    avg_viewed_pct: avg,
    retention,
    views: num(b.views),
    source: String(b.source ?? "creator_manual").slice(0, 60),
    notes: String(b.notes ?? "").slice(0, 2000),
    logged_at: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await deleteFeedback(id);
  return NextResponse.json({ ok: true });
}
