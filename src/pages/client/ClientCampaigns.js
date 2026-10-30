import { useState } from "react";
import { GridViewIcon, Megaphone01Icon, Search01Icon, TableIcon } from "@hugeicons/core-free-icons";
import CampaignProgressCard from "../../components/CampaignProgressCard";
import EmptyState, { NoMatchRow } from "../../ui/EmptyState";
import Icon from "../../ui/Icon";
import PageHeader from "../../ui/PageHeader";
import { calcPacing, fmtDate, statusBadge } from "../../utils";
import CampaignDetail from "./CampaignDetail";
import ClientGate from "./ClientGate";
import useClient from "./useClient";

const LIVE = new Set(["Approved", "Published/Tracked"]);

// The campaign list, reused on the overview with a limit.
export function CampaignList({ campaigns, submissions, client, onOpen, view = "cards", search = "", onClear }) {
  const delivered = (id) => submissions.filter(s => s.campaign_id === id && LIVE.has(s.status)).length;
  if (!campaigns.length && !search) return <div className="card"><EmptyState icon={Megaphone01Icon} title="No campaigns yet">Your account manager sets up your first campaign. It shows up here with live delivery progress.</EmptyState></div>;
  if (!campaigns.length) return <div className="card"><EmptyState icon={Search01Icon} title="No campaigns match" action={<button className="btn btn-secondary btn-sm" onClick={onClear}>Clear search</button>}>Try another name or format.</EmptyState></div>;
  if (view === "cards") {
    return (
      <div className="camp-grid">
        {campaigns.map(c => <CampaignProgressCard key={c.id} campaign={{ ...c, videos_needed: c.videos_needed || 10 }} client={client} approvedCount={delivered(c.id)} onClick={() => onOpen(c)} />)}
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Campaign</th><th>Status</th><th className="num">Delivered</th><th>Pace</th><th>Started</th></tr></thead>
        <tbody>
          {campaigns.map(c => {
            const n = delivered(c.id);
            const pace = calcPacing({ startDate: c.start_date || c.created_at, deadline: c.deadline, videosNeeded: c.videos_needed || 10, approvedCount: n });
            return (
              <tr key={c.id}>
                <td><button className="text-btn fw-600 truncate" style={{ textDecoration: "none", maxWidth: 320, display: "block", textAlign: "left" }} onClick={() => onOpen(c)}>{c.name}</button></td>
                <td>{statusBadge(c.status)}</td>
                <td className="num tnum">{n} of {c.videos_needed || 10}</td>
                <td><span className={`badge ${pace.paceBadge}`}>{pace.paceLabel}</span></td>
                <td className="text-muted">{fmtDate(c.start_date || c.created_at)}</td>
              </tr>
            );
          })}
          {!campaigns.length && <NoMatchRow colSpan={5} onClear={onClear} />}
        </tbody>
      </table>
    </div>
  );
}

export default function ClientCampaigns({ user, db }) {
  const state = useClient(user, db);
  const [openId, setOpenId] = useState(null);
  const [view, setView] = useState("cards");
  const [search, setSearch] = useState("");
  const open = state.campaigns.find(c => c.id === openId);

  return (
    <ClientGate state={state} variant="cards" onRetry={state.reload}>
      <div className="content">
        {open ? (
          <CampaignDetail campaign={open} clientProfile={state.client} submissions={state.submissions} analytics={db.analytics || []} creators={db.creators || []} onBack={() => setOpenId(null)} />
        ) : (
          <>
            <PageHeader title="Campaigns" description="Delivery progress and pacing for every campaign we run for you. Open one for its videos and results." />
            <div className="toolbar">
              <label className="toolbar-search" style={{ maxWidth: 320 }}><Icon icon={Search01Icon} size={16} /><span className="sr-only">Search campaigns</span>
                <input className="form-input" type="search" placeholder="Search campaigns" value={search} onChange={e => setSearch(e.target.value)} /></label>
              <div className="segmented toolbar-view" role="group" aria-label="Layout">
                <button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")} aria-label="Cards"><Icon icon={GridViewIcon} size={16} /></button>
                <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")} aria-label="Table"><Icon icon={TableIcon} size={16} /></button>
              </div>
            </div>
            <CampaignList view={view} search={search} onClear={() => setSearch("")} client={state.client} submissions={state.submissions} onOpen={c => setOpenId(c.id)}
              campaigns={state.campaigns.filter(c => !search.trim() || `${c.name} ${c.format || ""}`.toLowerCase().includes(search.toLowerCase()))} />
          </>
        )}
      </div>
    </ClientGate>
  );
}
