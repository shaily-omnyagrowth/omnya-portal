import { useMemo, useState } from "react";
import { UserIcon } from "@hugeicons/core-free-icons";
import { BarChart } from "../ui/charts";
import Alert from "../ui/Alert";
import EmptyState from "../ui/EmptyState";
import PageHeader from "../ui/PageHeader";
import { PageSkeleton } from "../ui/Skeleton";
import Tabs from "../ui/Tabs";
import { fmtMoney } from "../utils";
import BonusTracker from "./earnings/BonusTracker";
import { EarningsTable, WithdrawalsTable } from "./earnings/History";
import PayoutMethodCard from "./earnings/PayoutMethodCard";
import useEarningsData from "./earnings/useEarningsData";
import WithdrawDialog from "./earnings/WithdrawDialog";

export default function CreatorEarnings({ user, db }) {
  const creator = db.creators.find(c => c.user_id === user.id || c.email === user.email);
  const data = useEarningsData(creator?.id);
  const [tab, setTab] = useState("history");
  const [withdrawing, setWithdrawing] = useState(false);
  const [openPayout, setOpenPayout] = useState(0);

  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const value = data.earnings.filter(e => {
        const c = new Date(e.created_at);
        return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth() && !["forfeited", "cancelled"].includes(e.status);
      }).reduce((a, e) => a + (parseFloat(e.amount) || 0), 0);
      return { label: d.toLocaleDateString("en-US", { month: "short" }).slice(0, 3), fullLabel: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }), value };
    });
  }, [data.earnings]);

  if (!creator) return <div className="content"><EmptyState icon={UserIcon} title="Your creator profile isn't set up yet">Contact your account manager and they'll link it for you.</EmptyState></div>;
  if (data.loading) return <PageSkeleton variant="table" />;

  const { available, pending, requested, paid } = data.balances;
  const hasMethod = (creator.payment_method_status || "missing") !== "missing" && !!creator.payment_method;
  const canWithdraw = data.canWithdraw && available > 0 && hasMethod;
  const why = !hasMethod ? "Set up a payout method first." : available <= 0 ? "Nothing is approved to withdraw yet." : !data.canWithdraw && data.nextWithdrawal ? `Next withdrawal available ${data.nextWithdrawal.toLocaleDateString("en-US", { month: "long", day: "numeric" })}.` : "";
  const bonusSubs = data.bonusSubs;

  return (
    <div className="content">
      <PageHeader
        title="Payments"
        description="What you've earned, what's on its way and where it's sent. Withdraw your approved balance once every 14 days."
        actions={<button className="btn btn-primary" onClick={() => setWithdrawing(true)} disabled={!canWithdraw} title={why || undefined}>Withdraw {fmtMoney(available, { cents: true })}</button>}
      />
      {data.error && <Alert tone="error" title="Some payment details didn't load" style={{ marginBottom: 16 }}>{data.error}</Alert>}
      {!canWithdraw && why && (
        <Alert tone={hasMethod ? "info" : "warning"} style={{ marginBottom: 16 }}
          action={!hasMethod && <button className="btn btn-secondary btn-sm" onClick={() => { setOpenPayout(n => n + 1); document.getElementById("payout-method")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>Set up payouts</button>}>
          {why}
        </Alert>
      )}

      <div className="stats-grid">
        <div className="stat-card stat-highlight"><div className="stat-label">Ready to withdraw</div><div className="stat-value">{fmtMoney(available, { cents: true })}</div><div className="stat-sub">approved and yours</div></div>
        <div className="stat-card"><div className="stat-label">Pending approval</div><div className="stat-value">{fmtMoney(pending, { cents: true })}</div><div className="stat-sub">waiting on review</div></div>
        <div className="stat-card"><div className="stat-label">On its way</div><div className="stat-value">{fmtMoney(requested, { cents: true })}</div><div className="stat-sub">withdrawal requested</div></div>
        <div className="stat-card"><div className="stat-label">Paid to you</div><div className="stat-value">{fmtMoney(paid, { cents: true })}</div><div className="stat-sub">all time</div></div>
      </div>

      <div className="dash-grid mb-24">
        <section className="card card-stacked">
          <div className="card-head"><div><h2 className="card-title">Earned per month</h2><p className="card-desc">Base pay and bonuses over the last 12 months.</p></div></div>
          <BarChart data={months} height={200} format={(v) => fmtMoney(v)} ariaLabel="Earnings per month for the last year" />
        </section>
        <PayoutMethodCard creator={creator} openSignal={openPayout} onSaved={data.reload} />
      </div>

      <Tabs label="Payment details" value={tab} onChange={setTab} tabs={[
        { id: "history", label: "Earnings", count: data.earnings.length },
        { id: "bonus", label: "Bonus tracker", count: bonusSubs.length },
        { id: "withdrawals", label: "Withdrawals", count: data.withdrawals.length },
      ]} />
      {tab === "history" && <EarningsTable rows={data.earnings} campaigns={db.campaigns} />}
      {tab === "bonus" && <BonusTracker subs={bonusSubs} earnings={data.earnings} onSaved={(id, updated) => data.setBonusSubs(list => list.map(s => (s.id === id ? { ...s, ...updated } : s)))} />}
      {tab === "withdrawals" && <WithdrawalsTable rows={data.withdrawals} />}

      {withdrawing && <WithdrawDialog amount={available} creator={creator} onClose={() => setWithdrawing(false)} onDone={() => { setWithdrawing(false); data.reload(); }} />}
    </div>
  );
}
