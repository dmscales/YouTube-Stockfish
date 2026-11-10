import { getVideo, listVideos } from "@/lib/store";
import CompareView from "./CompareView";

export const dynamic = "force-dynamic";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const { a, b } = await searchParams;
  const options = (await listVideos()).filter((v) => v.status.state === "done" || v.avg_viewed != null);
  const [ra, rb] = await Promise.all([a ? getVideo(a).catch(() => null) : null, b ? getVideo(b).catch(() => null) : null]);
  return (
    <CompareView
      options={options.map((v) => ({ id: v.meta.id, title: v.meta.title, label: v.meta.version_label }))}
      a={ra}
      b={rb}
    />
  );
}
