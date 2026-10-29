import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) {
    console.error("Portal error:", error, info);
    // If it's an auth/session error, clear stale storage and force a clean reload to login
    const msg = (error?.message || "").toLowerCase();
    if (
      msg.includes("jwt") || msg.includes("session") ||
      msg.includes("unauthorized") || msg.includes("auth") ||
      msg.includes("token")
    ) {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch(_) {}
      setTimeout(() => window.location.replace("/login"), 1500);
    }
  }
  componentDidUpdate(prevProps) {
    if (prevProps.label !== this.props.label && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{minHeight:"60vh",display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)",flexDirection:"column",gap:16,padding:32,textAlign:"center"}}>
          <div style={{fontSize:48}}>🛠️</div>
          <div style={{fontWeight:700,fontSize:20,color:"var(--ink)"}}>
            Something went wrong {this.props.label ? `in ${this.props.label}` : ''}
          </div>
          <div style={{fontSize:14,color:"var(--ink3)",maxWidth:460}}>
            An unexpected error occurred. This might be due to a slow connection or a temporary issue.
          </div>
          {this.state.error && (
            <div style={{margin: "8px 0", padding: "12px 16px", background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: 8, color: "#dc2626", fontSize: 13, maxWidth: 540, textAlign: "left", wordBreak: "break-word"}}>
              <strong>Error details:</strong> {this.state.error?.message || String(this.state.error)}
            </div>
          )}
          <div style={{display:"flex", gap: 10, marginTop: 8}}>
            <button className="btn btn-primary btn-sm" onClick={() => this.setState({ hasError: false, error: null })}>
              🔄 Try Again
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
