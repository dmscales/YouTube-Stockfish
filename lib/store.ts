import "server-only";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Analysis, Feedback, Meta, Status, VideoRecord, VideoSummary } from "./types";

/**
 * Local-disk store for the MVP. Each video is a folder:
 *   data/videos/<id>/{source.<ext>, meta.json, status.json, analysis.json, feedback.json, thumbs/}
 * Swap this module for Supabase + R2 when you need multiple users.
 */
export const DATA_DIR = path.resolve(process.env.YTS_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data"));
export const VIDEOS_DIR = path.join(DATA_DIR, "videos");

const ID_RE = /^[a-z0-9]{8,40}$/;
const STALE_MS = 30 * 60 * 1000;

export function videoDir(id: string): string {
  if (!ID_RE.test(id)) throw new Error("Invalid id");
  return path.join(VIDEOS_DIR, id);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, data: unknown) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

export async function writeStatus(id: string, status: Partial<Status>) {
  const dir = videoDir(id);
  const prev = (await readJson<Status>(path.join(dir, "status.json"))) ?? undefined;
  await writeJson(path.join(dir, "status.json"), {
    state: "queued",
    stage: "Queued",
    progress: 0,
    error: null,
    ...prev,
    ...status,
    updated_at: new Date().toISOString(),
  });
}

async function readStatus(dir: string): Promise<Status> {
  const s = (await readJson<Status>(path.join(dir, "status.json"))) ?? {
    state: "failed",
    stage: "Unknown",
    progress: 0,
    error: "Missing status",
    updated_at: new Date(0).toISOString(),
  };
  if (s.state === "processing" && Date.now() - Date.parse(s.updated_at) > STALE_MS) {
    return { ...s, state: "failed", error: "Analysis stalled (worker stopped). Click re-analyze." };
  }
  return s;
}

export async function createVideo(file: File, fields: Omit<Meta, "id" | "original_name" | "ext" | "size" | "created_at">) {
  const id = crypto.randomBytes(8).toString("hex");
  const dir = videoDir(id);
  await fs.mkdir(dir, { recursive: true });
  const ext = (path.extname(file.name).slice(1).toLowerCase() || "mp4").replace(/[^a-z0-9]/g, "");
  await fs.writeFile(path.join(dir, `source.${ext}`), Buffer.from(await file.arrayBuffer()));
  const meta: Meta = {
    id,
    original_name: file.name.slice(0, 200),
    ext,
    size: file.size,
    created_at: new Date().toISOString(),
    ...fields,
  };
  await writeJson(path.join(dir, "meta.json"), meta);
  await writeStatus(id, { state: "queued", stage: "Queued", progress: 0, error: null });
  return meta;
}

export async function getVideo(id: string): Promise<VideoRecord | null> {
  const dir = videoDir(id);
  const meta = await readJson<Meta>(path.join(dir, "meta.json"));
  if (!meta) return null;
  return {
    meta,
    status: await readStatus(dir),
    analysis: await readJson<Analysis>(path.join(dir, "analysis.json")),
    feedback: await readJson<Feedback>(path.join(dir, "feedback.json")),
  };
}

export async function updateMeta(id: string, patch: Partial<Meta>) {
  const dir = videoDir(id);
  const meta = await readJson<Meta>(path.join(dir, "meta.json"));
  if (!meta) throw new Error("Not found");
  const next = { ...meta, ...patch, id: meta.id };
  await writeJson(path.join(dir, "meta.json"), next);
  return next;
}

export async function saveFeedback(id: string, fb: Feedback) {
  await writeJson(path.join(videoDir(id), "feedback.json"), fb);
}

export async function deleteFeedback(id: string) {
  await fs.rm(path.join(videoDir(id), "feedback.json"), { force: true });
}

export async function deleteVideo(id: string) {
  await fs.rm(videoDir(id), { recursive: true, force: true });
}

export async function sourcePath(id: string): Promise<{ file: string; ext: string } | null> {
  const meta = await readJson<Meta>(path.join(videoDir(id), "meta.json"));
  if (!meta) return null;
  const file = path.join(videoDir(id), `source.${meta.ext}`);
  return existsSync(file) ? { file, ext: meta.ext } : null;
}

export async function listIds(): Promise<string[]> {
  try {
    return (await fs.readdir(VIDEOS_DIR)).filter((d) => ID_RE.test(d));
  } catch {
    return [];
  }
}

export async function listVideos(): Promise<VideoSummary[]> {
  const out: VideoSummary[] = [];
  for (const id of await listIds()) {
    const rec = await getVideo(id);
    if (!rec) continue;
    const p = rec.analysis?.prediction;
    out.push({
      meta: rec.meta,
      status: rec.status,
      duration: rec.analysis?.video.duration ?? null,
      avg_viewed: p?.avg_viewed ?? null,
      avg_viewed_p10: p?.avg_viewed_p10 ?? null,
      avg_viewed_p90: p?.avg_viewed_p90 ?? null,
      opening_risk: p?.opening_risk ?? null,
      model_version: p?.model_version ?? null,
      thumb: rec.analysis?.thumbs?.[Math.min(1, (rec.analysis?.thumbs.length ?? 1) - 1)]?.file ?? null,
      has_feedback: !!rec.feedback,
      actual_avg_viewed: rec.feedback?.avg_viewed_pct ?? null,
    });
  }
  return out.sort((a, b) => b.meta.created_at.localeCompare(a.meta.created_at));
}

export async function readModel() {
  const params = await readJson<Record<string, unknown>>(path.join(DATA_DIR, "model_params.json"));
  const report = await readJson<Record<string, unknown>>(path.join(DATA_DIR, "model_report.json"));
  return { params, report };
}
