import { NextResponse } from "next/server";
import { readModel } from "@/lib/store";
import { repredictAll, runTraining } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readModel());
}

export async function POST(req: Request) {
  const { dryRun } = await req.json().catch(() => ({ dryRun: false }));
  const result = await runTraining(!!dryRun);
  const model = await readModel();
  if (result.code === 0 && !dryRun && model.report?.status === "ok") await repredictAll();
  return NextResponse.json({ ...result, ...model }, { status: result.code === 0 ? 200 : 500 });
}
