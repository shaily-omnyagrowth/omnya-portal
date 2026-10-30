import PageHeader from "../ui/PageHeader";
import VideoAnalytics from "./client/VideoAnalytics";

export default function ClientVideoInsights() {
  return (
    <div className="content">
      <PageHeader title="Video insights" description="Views and engagement for every video delivered across your campaigns, synced from each platform." />
      <VideoAnalytics />
    </div>
  );
}
