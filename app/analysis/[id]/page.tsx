import { notFound } from "next/navigation";
import { getVideo } from "@/lib/store";
import AnalysisView from "./AnalysisView";

export const dynamic = "force-dynamic";

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = await getVideo(id).catch(() => null);
  if (!rec) notFound();
  return <AnalysisView initial={rec} />;
}
