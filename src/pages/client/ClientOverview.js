import { useState } from "react";
import UGCDashboardView from "../../components/UGCDashboardView";
import PageHeader from "../../ui/PageHeader";
import { NavLink } from "../../app/Sidebar";
import CampaignDetail from "./CampaignDetail";
import { CampaignList } from "./ClientCampaigns";
import ClientGate from "./ClientGate";
import useClient from "./useClient";

const ACTIVE = new Set(["Active", "Open", "In Progress"]);

export default function ClientOverview({ user, db, onNavigate }) {
  const state = useClient(user, db);
  const [openId, setOpenId] = useState(null);
  const open = state.campaigns.find(c => c.id === openId);
  const live = state.campaigns.filter(c => ACTIVE.has(c.status));
  const featured = (live.length ? live : state.campaigns).slice(0, 3);

  return (
    <ClientGate state={state} onRetry={state.reload}>
      <div className="content">
        {open ? (
          <CampaignDetail campaign={open} clientProfile={state.client} submissions={state.submissions} analytics={db.analytics || []} creators={db.creators || []} onBack={() => setOpenId(null)} />
        ) : (
          <>
            <PageHeader title={state.client?.name || "Overview"}
              description={live.length ? `${live.length} ${live.length === 1 ? "campaign is" : "campaigns are"} live. Views and engagement below are verified from the platforms.` : "Views and engagement from every video we've delivered for you."} />
            <UGCDashboardView campaigns={state.campaigns} submissions={state.submissions} analytics={db.analytics || []} creators={db.creators || []} showTopPosts showDelivery={false} />
            <section className="section">
              <div className="flex-between mb-12">
                <h2 className="section-title" style={{ margin: 0 }}>{live.length ? "Live campaigns" : "Campaigns"}</h2>
                {state.campaigns.length > featured.length && <NavLink id="campaigns" onNavigate={onNavigate} className="btn btn-ghost btn-sm">All {state.campaigns.length} campaigns</NavLink>}
              </div>
              <CampaignList campaigns={featured} submissions={state.submissions} client={state.client} onOpen={c => setOpenId(c.id)} />
            </section>
          </>
        )}
      </div>
    </ClientGate>
  );
}
