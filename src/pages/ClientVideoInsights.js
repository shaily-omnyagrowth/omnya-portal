import PageHeader from "../ui/PageHeader";
import AnalyticsDashboard from "./AnalyticsDashboard";

export default function ClientVideoInsights() {
  return (
    <div className="content">
      <PageHeader title="Video insights" description="Performance of every video delivered across your campaigns." />
      <AnalyticsDashboard campaignId={null} />
    </div>
  );
}
