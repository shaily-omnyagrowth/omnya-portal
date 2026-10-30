import AttentionCards from "../../components/AttentionCards";
import UGCDashboardView from "../../components/UGCDashboardView";
import PageHeader from "../../ui/PageHeader";
import { fmtMoney } from "../../utils";

const ACTIVE = new Set(["Active", "Open", "In Progress"]);

export default function OwnerDashboard({ db, setPage }) {
  const waiting = db.submissions.filter(s => s.status === "Submitted" || s.status === "Under Review");
  const stale = waiting.filter(s => Date.now() - new Date(s.created_at).getTime() > 3 * 86400000).length;
  const pendingUsers = (db.userProfiles || []).filter(u => u.role === "pending").length;
  const activeClients = db.clients.filter(c => c.status === "Active" && !c.archived_at);
  const revenue = activeClients.reduce((a, c) => a + Number(c.budget || 0), 0);
  const todo = [pendingUsers && `${pendingUsers} new ${pendingUsers === 1 ? "account" : "accounts"} to approve`, waiting.length && `${waiting.length} ${waiting.length === 1 ? "submission" : "submissions"} to review`].filter(Boolean);

  return (
    <div className="content">
      <PageHeader
        title="Overview"
        description={todo.length ? `Waiting on you: ${todo.join(" and ")}.` : "Nothing is waiting on you. Here's how the agency is performing."}
        actions={pendingUsers > 0 ? <button className="btn btn-primary" onClick={() => setPage("pending-users")}>Review sign ups</button>
          : waiting.length > 0 ? <button className="btn btn-primary" onClick={() => setPage("review-queue")}>Open review queue</button> : null}
      />
      <AttentionCards onNavigate={setPage} items={[
        { label: "Waiting for review", value: waiting.length, sub: stale ? `${stale} waiting over 3 days` : "all within 3 days", to: "review-queue", alert: true },
        { label: "Accounts to approve", value: pendingUsers, sub: pendingUsers ? "can't use the portal yet" : "none waiting", to: "pending-users", alert: true },
        { label: "Live campaigns", value: db.campaigns.filter(c => ACTIVE.has(c.status)).length, sub: `${db.campaigns.length} in total`, to: "campaigns" },
        { label: "Monthly revenue", value: fmtMoney(revenue), sub: `${activeClients.length} active clients`, to: "revenue" },
      ]} />
      <UGCDashboardView campaigns={db.campaigns} submissions={db.submissions} analytics={db.analytics || []} creators={db.creators} onNavigate={setPage} />
    </div>
  );
}
