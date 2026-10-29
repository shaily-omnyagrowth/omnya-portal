export default function ClientForm({ data, setData, onSave, onCancel, title, db, err, saving }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="form-group"><label className="form-label">Client Name</label><input className="form-input" placeholder="e.g. Eden Health" value={data.name||""} onChange={e=>setData({...data,name:e.target.value})}/></div>
        <div className="grid-2">
          <div className="form-group"><label className="form-label">Deal Type</label><select className="select" value={data.deal_type||"Monthly Retainer"} onChange={e=>setData({...data,deal_type:e.target.value})}>{["Monthly Retainer","One-Off","Trial"].map(d=><option key={d}>{d}</option>)}</select></div>
          <div className="form-group"><label className="form-label">Status</label><select className="select" value={data.status||"Active"} onChange={e=>setData({...data,status:e.target.value})}>{["Active","Paused","Completed"].map(s=><option key={s}>{s}</option>)}</select></div>
          <div className="form-group"><label className="form-label">Videos/Month</label><input className="form-input" type="number" value={data.videos_per_month||""} onChange={e=>setData({...data,videos_per_month:e.target.value})}/></div>
          <div className="form-group"><label className="form-label">Monthly Budget ($)</label><input className="form-input" type="number" value={data.budget||""} onChange={e=>setData({...data,budget:e.target.value})}/></div>
        </div>
        <div className="form-group"><label className="form-label">Contact Name</label><input className="form-input" placeholder="Decision maker" value={data.contact_name||""} onChange={e=>setData({...data,contact_name:e.target.value})}/></div>
        <div className="grid-2">
          <div className="form-group"><label className="form-label">Contact Email</label><input className="form-input" type="email" value={data.contact_email||""} onChange={e=>setData({...data,contact_email:e.target.value})}/></div>
          <div className="form-group"><label className="form-label">Contact Phone</label><input className="form-input" value={data.contact_phone||""} onChange={e=>setData({...data,contact_phone:e.target.value})}/></div>
        </div>
        <div className="form-group"><label className="form-label">Google Drive Link</label><input className="form-input" placeholder="https://drive.google.com/..." value={data.drive_link||""} onChange={e=>setData({...data,drive_link:e.target.value})}/></div>
        <div className="form-group"><label className="form-label">Contract Notes</label><textarea className="textarea" rows={3} placeholder="Contract terms, payment schedule, special conditions..." value={data.contract_notes||""} onChange={e=>setData({...data,contract_notes:e.target.value})}/></div>
        <div className="form-group"><label className="form-label">Contract URL <span style={{color:"var(--ink3)",fontWeight:400}}>(optional)</span></label><input className="form-input" placeholder="https://docs.google.com/..." value={data.contract_url||""} onChange={e=>setData({...data,contract_url:e.target.value})}/></div>
        <div className="form-group"><label className="form-label">Assign Account Manager</label><select className="select" value={data.am_id||""} onChange={e=>setData({...data,am_id:e.target.value||null})}><option value="">— Unassigned —</option>{db.accountManagers.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        {err&&<div style={{color:"var(--red)",fontSize:13,marginBottom:12}}>{err}</div>}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={saving}>{saving?"Saving...":"Save"}</button>
        </div>
      </div>
    </div>
  );
}
