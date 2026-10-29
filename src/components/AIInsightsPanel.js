import { fmtNum } from "../utils";

export default function AIInsightsPanel({ sub }) {
  return (
    <div>
      <div className="card mb-16">
        <div className="flex-between mb-16">
          <div className="card-title" style={{margin:0}}>📊 Video Metrics</div>
        </div>
        <div className="metrics-row">
          {[["👁️",sub.views_24h,"Views"],["❤️",sub.likes,"Likes"],["💬",sub.comments,"Comments"],["🔗",sub.shares,"Shares"],["🔖",sub.saves,"Saves"]].map(([icon,val,label],i) => (
            <div key={i} className="metric-mini">
              <div style={{fontSize:16,marginBottom:4}}>{icon}</div>
              <div className="metric-mini-val" style={{color:val!=null?"var(--ink)":"var(--ink4)"}}>{val!=null?fmtNum(val):"—"}</div>
              <div className="metric-mini-label">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
