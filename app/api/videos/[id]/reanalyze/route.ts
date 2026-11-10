import { NextResponse } from "next/server";
import { getVideo } from "@/lib/store";
import { enqueue } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = await getVideo(id).catch(() => null);
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { mode } = await req.json().catch(() => ({ mode: "full" }));
  await enqueue(id, mode === "repredict" && rec.analysis ? "repredict" : "full");
  return NextResponse.json({ ok: true });
}
