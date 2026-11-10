import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, listIds, videoDir, writeStatus, getVideo } from "./store";

/**
 * Minimal in-process job queue. Good enough for one machine; replace with
 * Redis + separate Python workers when uploads need to survive restarts.
 */
type Job = { id: string; mode: "full" | "repredict" };

const MAX_CONCURRENT = Number(process.env.YTS_MAX_JOBS || 2);
const PYTHON = process.env.PYTHON || "python3";
const WORKER = path.join(/* turbopackIgnore: true */ process.cwd(), "worker");

const g = globalThis as unknown as { __ytsQueue?: { queue: Job[]; running: Set<string> } };
const state = (g.__ytsQueue ??= { queue: [], running: new Set() });

export async function enqueue(id: string, mode: Job["mode"] = "full") {
  if (state.running.has(id) || state.queue.some((j) => j.id === id)) return;
  await writeStatus(id, { state: "queued", stage: mode === "full" ? "Queued" : "Queued for re-prediction", progress: 0, error: null });
  state.queue.push({ id, mode });
  pump();
}

function pump() {
  while (state.running.size < MAX_CONCURRENT && state.queue.length) {
    const job = state.queue.shift()!;
    state.running.add(job.id);
    run(job).finally(() => {
      state.running.delete(job.id);
      pump();
    });
  }
}

function run(job: Job): Promise<void> {
  return new Promise((resolve) => {
    const dir = videoDir(job.id);
    const log = fs.openSync(path.join(dir, "worker.log"), "a");
    const args = [path.join(WORKER, "analyze.py"), "--dir", dir];
    if (job.mode === "repredict") args.push("--repredict");
    const child = spawn(PYTHON, args, {
      env: { ...process.env, YTS_DATA_DIR: DATA_DIR, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", log, log],
    });
    child.on("error", async (err) => {
      await writeStatus(job.id, { state: "failed", stage: "Failed", error: `Could not start worker: ${err.message}` });
    });
    child.on("exit", async (code) => {
      fs.closeSync(log);
      if (code !== 0) {
        const rec = await getVideo(job.id).catch(() => null);
        if (rec && rec.status.state !== "failed") {
          await writeStatus(job.id, { state: "failed", stage: "Failed", error: `Worker exited with code ${code}. See worker.log.` });
        }
      }
      resolve();
    });
  });
}

export function runTraining(dryRun = false): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const args = [path.join(WORKER, "train.py")];
    if (dryRun) args.push("--dry-run");
    const child = spawn(PYTHON, args, { env: { ...process.env, YTS_DATA_DIR: DATA_DIR } });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", (e) => resolve({ code: 1, output: String(e) }));
    child.on("exit", (code) => resolve({ code: code ?? 1, output: output.slice(-4000) }));
  });
}

export async function repredictAll() {
  for (const id of await listIds()) {
    const rec = await getVideo(id);
    if (rec?.analysis) await enqueue(id, "repredict");
  }
}
