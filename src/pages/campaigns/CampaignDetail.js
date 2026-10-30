import { useEffect, useState } from "react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import AMClientSummaryBar from "../../components/AMClientSummaryBar";
import { supabase } from "../../supabaseClient";
import Alert from "../../ui/Alert";
import { AreaChart } from "../../ui/charts";
import Dialog from "../../ui/Dialog";
import Icon from "../../ui/Icon";
import Tabs from "../../ui/Tabs";
import { daysLeftLabel, fmtDate, statusBadge } from "../../utils";
import CampaignForum from "./CampaignForum";
import CreatorsPanel from "./detail/CreatorsPanel";
import EditForm from "./detail/EditForm";
import { campaignFinance } from "./detail/finance";
import FinancePanel from "./detail/FinancePanel";

const ratesOf = (c) => ({
  isSalesSourced: Boolean(c.is_sales_sourced), salesRate: Number(c.sales_commission_rate ?? 0.30),
  managerRate: c.manager_commission_rate == null ? null : Number(c.manager_commission_rate), showClientCpm: Boolean(c.show_client_cpm),
});

export default function CampaignDetail({ campaign, db, user, onRefresh, onClose, isOwner, onShare }) {
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rates, setRates] = useState(() => ratesOf(campaign));
  const [uploadingBrief, setUploadingBrief] = useState(false);

  useEffect(() => { if (!editing) setRates(ratesOf(campaign)); }, [campaign, editing]);

  const client = db.clients.find(c => c.id === campaign.client_id);
  const finance = campaignFinance({ campaign, db, client, ...rates });
  const isArchived = campaign.status === "Archived";
  const applications = (db.campaignCreators || []).filter(cc => cc.campaign_id === campaign.id && cc.status === "Applied").length;
  const canPin = isOwner || db.accountManagers.some(a => a.user_id === db._currentUser?.id || a.email === db._currentUser?.email);

  const uploadBrief = async (file) => {
    if (!file) return;
    setUploadingBrief(true);
    const path = `briefs/${campaign.id}/${file.name}`;
    const { error: upErr } = await supabase.storage.from("submissions").upload(path, file, { upsert: true });
    if (upErr) { setUploadingBrief(false); return toast.error("Brief not uploaded", { description: upErr.message }); }
    const { data } = supabase.storage.from("submissions").getPublicUrl(path);
    await supabase.from("campaigns").update({ brief_url: data.publicUrl }).eq("id", campaign.id);
    setUploadingBrief(false);
    toast.success("Brief uploaded", { description: "Creators on this campaign can open it now." });
    onRefresh();
  };

  // §7.1: campaigns are archived, never deleted (trg_campaigns_no_delete), so history and money links survive.
  const setArchived = async (archive) => {
    if (archive && !archiveReason.trim()) return setErr("Add a reason. It's what the audit log will show.");
    setBusy(true); setErr("");
    const patch = archive
      ? { status: "Archived", archived_at: new Date().toISOString(), archived_by: user?.id || null, archive_reason: archiveReason.trim() }
      : { status: "Open", archived_at: null, archived_by: null, archive_reason: null };
    const { data, error } = await supabase.from("campaigns").update(patch).eq("id", campaign.id).select("id");
    setBusy(false);
    if (error || !data?.length) return setErr(error ? error.message : `That campaign wasn't ${archive ? "archived" : "restored"}. You may not have permission.`);
    toast.success(archive ? "Campaign archived" : "Campaign restored", { description: archive ? "Its submissions and payments are kept." : "It's open again." });
    setArchiving(false);
    onRefresh();
  };

  const header = (
    <div className="flex gap-8 flex-wrap">
      {statusBadge(campaign.status)}
      <span className="badge badge-outline">{campaign.format}</span>
      <span className="badge badge-outline">{daysLeftLabel(campaign.deadline)}</span>
    </div>
  );

  return (
    <Dialog size="sheet" title={campaign.name} description={[client?.name, finance.am?.name].filter(Boolean).join(" · ")} onClose={onClose}>
      <div className="flex-between flex-wrap gap-12 mb-16">
        {header}
        {!editing && (
          <div className="flex gap-8">
            {onShare && <button className="btn btn-ghost btn-sm" onClick={() => onShare(campaign)}>Share</button>}
            {isArchived
              ? <button className="btn btn-secondary btn-sm" onClick={() => setArchived(false)} disabled={busy}>{busy ? "Restoring…" : "Restore"}</button>
              : <button className="btn btn-ghost btn-sm" onClick={() => { setArchiving(a => !a); setErr(""); }}>Archive</button>}
            <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>Edit</button>
          </div>
        )}
      </div>

      {isArchived && <Alert tone="info" title="Archived" style={{ marginBottom: 16 }}>{campaign.archive_reason || "No reason recorded."}{campaign.archived_at ? ` · ${fmtDate(campaign.archived_at)}` : ""}. Submissions, earnings and audit history are kept.</Alert>}
      {archiving && (
        <div className="fieldset mb-16">
          <div className="fw-600 mb-4">Archive this campaign?</div>
          <p className="fs-13 text-muted mb-12">It leaves active lists. Submissions, earnings and audit records stay, and you can restore it any time.</p>
          <div className="flex gap-8 flex-wrap">
            <input className="form-input flex-1" placeholder="Reason, e.g. the client ended the retainer" value={archiveReason} onChange={e => setArchiveReason(e.target.value)} aria-label="Reason for archiving" style={{ minWidth: 220 }} />
            <button className="btn btn-danger" onClick={() => setArchived(true)} disabled={busy || !archiveReason.trim()}>{busy ? "Archiving…" : "Archive"}</button>
          </div>
        </div>
      )}
      {err && <Alert tone="error" style={{ marginBottom: 16 }}>{err}</Alert>}

      {editing ? (
        <EditForm campaign={campaign} isOwner={isOwner} amDefaultRate={finance.amDefaultRate} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onRefresh(); }} />
      ) : (
        <>
          <Tabs label="Campaign sections" value={tab} onChange={setTab} tabs={[
            { id: "overview", label: "Overview" },
            { id: "creators", label: "Creators", count: applications ? applications : (campaign.assigned_creators || []).length },
            { id: "thread", label: "Thread" },
          ]} />
          {tab === "overview" && (
            <div className="flex-col gap-24">
              {!isOwner && client && <AMClientSummaryBar client={client} db={db} />}
              {(finance.stale.length > 0 || (finance.margin < 60 && finance.revenue > 0) || finance.costPerVideo > 60) && (
                <div className="flex-col gap-8">
                  {finance.stale.length > 0 && <Alert tone="warning">{finance.stale.length} {finance.stale.length === 1 ? "submission has" : "submissions have"} waited 3 days or more for review.</Alert>}
                  {finance.margin < 60 && finance.revenue > 0 && <Alert tone="warning">Margin is {finance.margin}%, below the 60% target.</Alert>}
                  {finance.costPerVideo > 60 && <Alert tone="error">Cost per video is over $60.</Alert>}
                </div>
              )}
              <section>
                <div className="flex-between mb-12">
                  <h3 className="section-title" style={{ margin: 0 }}>Delivery</h3>
                  <span className="fs-13 text-muted tnum">{finance.approved} of {campaign.videos_needed || 0} approved · {finance.thisWeek} this week</span>
                </div>
                <div className="card">
                  {finance.burnup.length > 1
                    ? <AreaChart data={finance.burnup} height={160} ariaLabel="Approved videos over the campaign" format={(v) => Math.round(v)} />
                    : <p className="fs-13 text-muted">The delivery chart starts after the first week.</p>}
                </div>
              </section>
              <section>
                <div className="flex-between mb-12">
                  <h3 className="section-title" style={{ margin: 0 }}>Brief</h3>
                  <span className="flex gap-8">
                    {campaign.brief_url && <a href={campaign.brief_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Open file<Icon icon={ArrowUpRight01Icon} size={14} /></a>}
                    <label className="btn btn-secondary btn-sm">{uploadingBrief ? "Uploading…" : campaign.brief_url ? "Replace file" : "Upload file"}
                      <input type="file" accept=".pdf,.doc,.docx" className="sr-only" onChange={e => uploadBrief(e.target.files?.[0])} /></label>
                  </span>
                </div>
                <div className="card"><p className="fs-14" style={{ color: campaign.description ? "var(--ink2)" : "var(--ink3)", whiteSpace: "pre-line" }}>{campaign.description || "No written brief yet. Edit the campaign to add one."}</p></div>
              </section>
              <FinancePanel campaign={campaign} isOwner={isOwner} onRefresh={onRefresh} finance={finance} rates={rates} setRates={setRates} />
            </div>
          )}
          {tab === "creators" && <CreatorsPanel campaign={campaign} db={db} user={user} onRefresh={onRefresh} />}
          {tab === "thread" && <CampaignForum campaign={campaign} user={db._currentUser} db={db} canPin={canPin} />}
        </>
      )}
    </Dialog>
  );
}
