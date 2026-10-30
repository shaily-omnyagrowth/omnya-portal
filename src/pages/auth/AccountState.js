const COPY = {
  pending: {
    title: "Your account is waiting for approval",
    body: "An Omnya admin will review your account shortly. We'll email you when it's ready, and this page updates on its own.",
  },
  denied: {
    title: "This account doesn't have access",
    body: "Your request wasn't approved. If you think that's a mistake, email hello@omnyagrowth.com.",
  },
  error: {
    title: "We couldn't load your account",
    body: "Check your connection and try again. If it keeps happening, email hello@omnyagrowth.com.",
  },
};

export default function AccountState({ kind, onRetry, onLogout }) {
  const c = COPY[kind];
  return (
    <div className="state-screen">
      <div className="state-card">
        <img src="/brand/mark.png" alt="Omnya" width="30" height="40" style={{ margin: "0 auto 28px" }} />
        <h1>{c.title}</h1>
        <p>{c.body}</p>
        <div className="state-actions">
          {onRetry && <button className="btn btn-primary" onClick={onRetry}>Try again</button>}
          <button className="btn btn-secondary" onClick={onLogout}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
