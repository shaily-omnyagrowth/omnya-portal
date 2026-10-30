import { Building03Icon } from "@hugeicons/core-free-icons";
import EmptyState from "../../ui/EmptyState";
import { PageSkeleton } from "../../ui/Skeleton";

// Loading, error and not-yet-linked states shared by every brand page.
export default function ClientGate({ state, variant = "dashboard", onRetry, children }) {
  if (state.status === "loading") return <PageSkeleton variant={variant} />;
  if (state.status === "error") {
    return (
      <div className="content"><div className="card">
        <EmptyState icon={Building03Icon} title="Your brand workspace didn't load" action={onRetry && <button className="btn btn-primary btn-sm" onClick={onRetry}>Try again</button>}>{state.error}</EmptyState>
      </div></div>
    );
  }
  if (state.status === "unlinked") {
    return (
      <div className="content"><div className="card">
        <EmptyState icon={Building03Icon} title="We're connecting your brand" action={onRetry && <button className="btn btn-secondary btn-sm" onClick={onRetry}>Check again</button>}>
          Your account is verified. Your account manager is linking it to your brand, and campaigns appear here as soon as that's done. Questions? Email hello@omnyagrowth.com.
        </EmptyState>
      </div></div>
    );
  }
  return children;
}
