import { NextResponse } from "next/server";
import { deleteVideo, getVideo, updateMeta } from "@/lib/store";
import { enqueue } from "@/lib/jobs";
import type { AudiencePreset } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const rec = await getVideo(id).catch(() => null);
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(rec);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const rec = await getVideo(id).catch(() => null);
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json();
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") patch.title = body.title.slice(0, 200);
  if (typeof body.channel === "string") patch.channel = body.channel.slice(0, 80);
  if (typeof body.version_label === "string") patch.version_label = body.version_label.slice(0, 40);
  let presetChanged = false;
  if (["feed", "subscribers", "search"].includes(body.preset) && body.preset !== rec.meta.audience.preset) {
    patch.audience = { ...rec.meta.audience, preset: body.preset as AudiencePreset };
    presetChanged = true;
  }
  const meta = await updateMeta(id, patch);
  if (presetChanged && rec.analysis) await enqueue(id, "repredict");
  return NextResponse.json(meta);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await deleteVideo(id);
  return NextResponse.json({ ok: true });
}
