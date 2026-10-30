import React from "react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import Icon from "../ui/Icon";

// Only a dead session justifies wiping storage and sending the user to sign in.
const isSessionError = (error) => {
  const msg = (error?.message || "").toLowerCase();
  return error?.name === "AuthSessionMissingError" || /jwt expired|invalid jwt|refresh token not found|invalid refresh token/.test(msg);
};

export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error("Portal error:", error, info);
    if (isSessionError(error)) {
      try { localStorage.clear(); sessionStorage.clear(); } catch (_) {}
      setTimeout(() => window.location.replace("/login"), 1200);
    }
  }
  componentDidUpdate(prevProps) {
    if (prevProps.label !== this.props.label && this.state.error) this.setState({ error: null });
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="content">
        <div className="empty" style={{ minHeight: "50vh" }}>
          <div className="empty-icon" style={{ background: "var(--red-light)", color: "var(--red)" }}><Icon icon={Alert02Icon} size={20} /></div>
          <h3>Something went wrong on this page</h3>
          <p>The rest of the portal still works. Try again, and if it keeps happening, send us the details below.</p>
          <code style={{ marginTop: 8, padding: "8px 12px", borderRadius: 6, background: "var(--bg2)", fontSize: 12, color: "var(--ink2)", maxWidth: 520, overflowWrap: "anywhere" }}>
            {error.message || String(error)}
          </code>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="btn btn-primary btn-sm" onClick={() => this.setState({ error: null })}>Try again</button>
            <button className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>Reload the portal</button>
          </div>
        </div>
      </div>
    );
  }
}
