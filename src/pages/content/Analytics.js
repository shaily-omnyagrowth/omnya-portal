import { useState } from "react";
import CreatorLeaderboard from "../../components/CreatorLeaderboard";
import UGCDashboardView from "../../components/UGCDashboardView";
import PageHeader from "../../ui/PageHeader";
import Tabs from "../../ui/Tabs";

export default function Analytics({ db }) {
  const [tab, setTab] = useState("performance");
  const approved = db.submissions.filter(s => s.status === "Approved" || s.status === "Published/Tracked");
  const notLive = approved.filter(s => !(s.posted_link || s.posted_url || "").trim()).length;
  return (
    <div className="content">
      <PageHeader title="Analytics" description={`Views, engagement and top performers across your campaigns.${notLive ? ` ${notLive} approved ${notLive === 1 ? "video isn't" : "videos aren't"} posted yet, so they have no views.` : ""}`} />
      <Tabs label="Analytics view" value={tab} onChange={setTab} tabs={[{ id: "performance", label: "Performance" }, { id: "creators", label: "Creators" }]} />
      {tab === "performance"
        ? <UGCDashboardView campaigns={db.campaigns} submissions={db.submissions} analytics={db.analytics} creators={db.creators} />
        : <CreatorLeaderboard creators={db.creators} submissions={db.submissions} analytics={db.analytics} />}
    </div>
  );
}
