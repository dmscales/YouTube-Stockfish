import { NextResponse } from "next/server";
import { createVideo, listVideos } from "@/lib/store";
import { enqueue } from "@/lib/jobs";
import type { AudiencePreset } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = Number(process.env.YTS_MAX_UPLOAD_MB || 300) * 1024 * 1024;
const PRESETS: AudiencePreset[] = ["feed", "subscribers", "search"];

export async function GET() {
  return NextResponse.json(await listVideos());
}

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a video file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File is larger than ${MAX_BYTES / 1024 / 1024} MB` }, { status: 413 });
  }
  const videoExt = /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name);
  if (!file.type.startsWith("video/") && !videoExt) {
    return NextResponse.json({ error: "That doesn't look like a video file" }, { status: 400 });
  }
  const str = (k: string, max = 200) => String(form.get(k) ?? "").trim().slice(0, max);
  const preset = str("preset") as AudiencePreset;
  const meta = await createVideo(file, {
    title: str("title") || file.name.replace(/\.[^.]+$/, ""),
    channel: str("channel", 80),
    version_label: str("version_label", 40),
    audience: { preset: PRESETS.includes(preset) ? preset : "feed", description: str("audience_description", 500) },
    transcript_text: str("transcript", 20000),
  });
  await enqueue(meta.id, "full");
  return NextResponse.json({ id: meta.id }, { status: 201 });
}
