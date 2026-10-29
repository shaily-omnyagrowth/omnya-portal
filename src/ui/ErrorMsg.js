export default function ErrorMsg({msg, onRetry}) {
  return <div style={{background:"rgba(192,57,43,0.08)",border:"1px solid rgba(192,57,43,0.2)",borderRadius:"var(--radius)",padding:"16px 20px",color:"var(--red)",fontSize:13,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
    <span>⚠ {msg}</span>
    {onRetry && <button className="btn btn-ghost btn-sm" onClick={onRetry}>Retry</button>}
  </div>;
}
