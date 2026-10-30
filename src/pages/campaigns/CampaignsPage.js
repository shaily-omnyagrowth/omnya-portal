import { useMemo, useState } from "react";
import { Calendar03Icon, GridViewIcon, Megaphone01Icon, Search01Icon, TableIcon } from "@hugeicons/core-free-icons";
import CampaignCalendarView from "../../components/CampaignCalendarView";
import CampaignProgressCard from "../../components/CampaignProgressCard";
import CampaignShareModal from "../../components/CampaignShareModal";
import EmptyState from "../../ui/EmptyState";
import Icon from "../../ui/Icon";
import PageHeader from "../../ui/PageHeader";
import CampaignDetail from "./CampaignDetail";
import CampaignsTable from "./CampaignsTable";
import NewCampaignDialog from "./NewCampaignDialog";

const FILTERS = [["active", "Active"], ["all", "All"], ["completed", "Completed"], ["archived", "Archived"]];
const LIVE = new Set(["Approved", "Published/Tracked"]);

export default function CampaignsPage({ user, db, onRefresh, isOwner }) {
  const am = db.accountManagers.find(a => a.user_id === user.id || a.email === user.email);
  const campaigns = useMemo(() => (isOwner ? db.campaigns : db.campaigns.filter(c => db.clients.find(cl => cl.id === c.client_id)?.am_id === am?.id))
    .slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [db.campaigns, db.clients, isOwner, am]);
  const [showCreate, setShowCreate] = useState(false);
  const [viewId, setViewId] = useState(null);
  const [shareCampaign, setShareCampaign] = useState(null);
  const [viewMode, setViewMode] = useState("cards");
  const [statusFilter, setStatusFilter] = useState("active");
  const [search, setSearch] = useState("");

  const approvedFor = (id) => db.submissions.filter(s => s.campaign_id === id && LIVE.has(s.status)).length;
  const matches = (c, filter) => filter === "all" || (filter === "active" && !["Archived", "Completed"].includes(c.status)) || (filter === "completed" && c.status === "Completed") || (filter === "archived" && c.status === "Archived");
  const shown = campaigns.filter(c => {
    const q = search.trim().toLowerCase();
    if (q && !`${c.name} ${db.clients.find(cl => cl.id === c.client_id)?.name || ""}`.toLowerCase().includes(q)) return false;
    return matches(c, statusFilter);
  });
  const viewCampaign = viewId && db.campaigns.find(c => c.id === viewId);

  return (
    <div className="content">
      <PageHeader
        title="Campaigns"
        description="Briefs, deliverables and pacing for every campaign. Open one to edit it, review applications or talk to creators."
        actions={<button className="btn btn-primary" onClick={() => setShowCreate(true)}>New campaign</button>}
      />

      {campaigns.length === 0 ? (
        <div className="card">
          <EmptyState icon={Megaphone01Icon} title="No campaigns yet" action={<button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>Create a campaign</button>}>
            A campaign holds the brief, the creators on it and every video they deliver.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <div className="chip-row" role="group" aria-label="Filter by status">
              {FILTERS.map(([id, label]) => <button key={id} className="chip" aria-pressed={statusFilter === id} onClick={() => setStatusFilter(id)}>{label} <span className="text-muted" style={{ marginLeft: 2 }}>{campaigns.filter(c => matches(c, id)).length}</span></button>)}
            </div>
            <label className="toolbar-search" style={{ maxWidth: 320 }}>
              <Icon icon={Search01Icon} size={16} />
              <span className="sr-only">Search campaigns</span>
              <input className="form-input" type="search" placeholder="Search campaign or client" value={search} onChange={e => setSearch(e.target.value)} />
            </label>
            <div className="segmented toolbar-view" role="group" aria-label="Layout">
              <button type="button" aria-pressed={viewMode === "cards"} onClick={() => setViewMode("cards")} aria-label="Cards"><Icon icon={GridViewIcon} size={16} /></button>
              <button type="button" aria-pressed={viewMode === "table"} onClick={() => setViewMode("table")} aria-label="Table"><Icon icon={TableIcon} size={16} /></button>
              <button type="button" aria-pressed={viewMode === "calendar"} onClick={() => setViewMode("calendar")} aria-label="Calendar"><Icon icon={Calendar03Icon} size={16} /></button>
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="card"><EmptyState icon={Search01Icon} title="No campaigns match" action={<button className="btn btn-secondary btn-sm" onClick={() => { setSearch(""); setStatusFilter("all"); }}>Show all campaigns</button>}>Try another search or status.</EmptyState></div>
          ) : viewMode === "cards" ? (
            <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))" }}>
              {shown.map(c => {
                const client = db.clients.find(cl => cl.id === c.client_id);
                return (
                  <CampaignProgressCard key={c.id} campaign={c} client={client} accountManager={db.accountManagers.find(a => a.id === client?.am_id)}
                    approvedCount={approvedFor(c.id)} assignedCreatorsCount={(c.assigned_creators || []).length}
                    onClick={() => setViewId(c.id)} onShareClick={() => setShareCampaign(c)} showCpmBadge />
                );
              })}
            </div>
          ) : viewMode === "table" ? (
            <CampaignsTable campaigns={shown} db={db} approvedFor={approvedFor} onOpen={c => setViewId(c.id)} onShare={setShareCampaign} />
          ) : (
            <CampaignCalendarView campaigns={shown} onSelectCampaign={c => setViewId(c.id)} />
          )}
        </>
      )}

      {shareCampaign && <CampaignShareModal campaign={db.campaigns.find(c => c.id === shareCampaign.id) || shareCampaign} onClose={() => setShareCampaign(null)} onUpdated={onRefresh} />}
      {viewCampaign && <CampaignDetail campaign={viewCampaign} db={db} user={user} isOwner={isOwner} onRefresh={onRefresh} onClose={() => setViewId(null)} onShare={setShareCampaign} />}
      {showCreate && <NewCampaignDialog clients={db.clients} isOwner={isOwner} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); onRefresh(); }} />}
    </div>
  );
}
