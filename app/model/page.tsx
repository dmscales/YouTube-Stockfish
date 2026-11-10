import { listVideos, readModel } from "@/lib/store";
import ModelView from "./ModelView";

export const dynamic = "force-dynamic";

export default async function ModelPage() {
  const [model, videos] = await Promise.all([readModel(), listVideos()]);
  return (
    <ModelView
      initial={model}
      counts={{ analyzed: videos.filter((v) => v.avg_viewed != null).length, labeled: videos.filter((v) => v.has_feedback).length }}
    />
  );
}
