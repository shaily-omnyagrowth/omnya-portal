import { useMemo } from "react";
import { UserIcon } from "@hugeicons/core-free-icons";
import AttentionCards from "../../components/AttentionCards";
import UGCDashboardView from "../../components/UGCDashboardView";
import EmptyState from "../../ui/EmptyState";
import PageHeader from "../../ui/PageHeader";

export default function AMDashboard({ user, db, setPage }) {
  const am = db.accountManagers.find(a => a.user_id === user.id || a.email === user.email);
  const myCreators = useMemo(() => (am ? db.creators.filter(c => c.am_id === am.id) : []), [am, db.creators]);
  const myClients = useMemo(() => (am ? db.clients.filter(c => c.am_id === am.id) : []), [am, db.clients]);
  const myCampaigns = useMemo(() => { const ids = new Set(myClients.map(c => c.id)); return db.campaigns.filter(c => ids.has(c.client_id)); }, [myClients, db.campaigns]);
  const campIds = useMemo(() => new Set(myCampaigns.map(c => c.id)), [myCampaigns]);
  const mine = useMemo(() => db.submissions.filter(s => campIds.has(s.campaign_id) || myCreators.some(c => c.id === s.creator_id)), [db.submissions, campIds, myCreators]);

  if (!am) {
    return (
      <div className="content">
        <EmptyState icon={UserIcon} title="Your account manager profile isn't linked yet">
          An owner needs to connect your login to your account manager record before clients and creators show up here. Email hello@omnyagrowth.com if this takes more than a day.
        </EmptyState>
      </div>
    );
  }

  const waiting = mine.filter(s => s.status === "Submitted" || s.status === "Under Review");
  const approvedWeek = mine.filter(s => s.status === "Approved" && new Date(s.approved_date) > Date.now() - 7 * 86400000).length;
  const applications = (db.campaignCreators || []).filter(cc => campIds.has(cc.campaign_id) && cc.status === "Applied").length;

  return (
    <div className="content">
      <PageHeader title={`Hi ${(am.name || "").split(" ")[0] || "there"}`} description={waiting.length ? `${waiting.length} ${waiting.length === 1 ? "submission is" : "submissions are"} waiting for your review.` : "Nothing is waiting for review. Here's how your accounts are performing."}
        actions={<button className="btn btn-primary" onClick={() => setPage("review-queue")}>Open review queue</button>} />
      <AttentionCards onNavigate={setPage} items={[
        { label: "Waiting for review", value: waiting.length, sub: `${waiting.filter(s => s.submission_type !== "Final").length} concepts · ${waiting.filter(s => s.submission_type === "Final").length} finals`, to: "review-queue", alert: true },
        { label: "Creator applications", value: applications, sub: "across your campaigns", to: "campaigns", alert: true },
        { label: "Approved this week", value: approvedWeek, to: "content-library" },
        { label: "Creators and clients", value: `${myCreators.length} · ${myClients.length}`, sub: "you manage", to: "my-creators" },
      ]} />
      <UGCDashboardView campaigns={myCampaigns} submissions={mine.filter(s => campIds.has(s.campaign_id))} analytics={db.analytics || []} creators={myCreators} onNavigate={setPage} />
    </div>
  );
}
