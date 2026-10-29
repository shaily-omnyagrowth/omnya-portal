import { useEffect, useRef, useState } from "react";
import { supabase } from "../../supabaseClient";
import Spinner from "../../ui/Spinner";

export default function CampaignForum({ campaign, user, db, canPin }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef(null);

  const senderName = () => {
    const am = db.accountManagers.find(a=>a.user_id===user?.id||a.email===user?.email);
    const creator = db.creators.find(c=>c.user_id===user?.id||c.email===user?.email);
    if (am) return am.name;
    if (creator) return creator.name;
    return user?.email?.split("@")[0]||"Unknown";
  };

  const loadMessages = async () => {
    const { data } = await supabase.from("messages").select("*").eq("campaign_id", campaign.id).order("created_at", {ascending:true});
    setMessages(data||[]);
    setLoading(false);
  };

  useEffect(() => {
    loadMessages();
    const channel = supabase.channel(`campaign-${campaign.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `campaign_id=eq.${campaign.id}` },
        payload => { setMessages(prev => [...prev, payload.new]); }
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `campaign_id=eq.${campaign.id}` },
        payload => { setMessages(prev => prev.map(m => m.id===payload.new.id ? payload.new : m)); }
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages", filter: `campaign_id=eq.${campaign.id}` },
        payload => { setMessages(prev => prev.filter(m => m.id!==payload.old.id)); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [campaign.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({behavior:"smooth"});
  }, [messages]);

  const send = async () => {
    if (!input.trim()) return;
    setSending(true);
    await supabase.from("messages").insert({
      campaign_id: campaign.id,
      user_id: user?.id,
      sender_name: senderName(),
      content: input.trim(),
      is_pinned: false
    });
    setInput("");
    setSending(false);
  };

  const togglePin = async (msg) => {
    const pinnedCount = messages.filter(m=>m.is_pinned&&m.id!==msg.id).length;
    if (!msg.is_pinned && pinnedCount >= 3) return alert("Max 3 pinned messages allowed.");
    await supabase.from("messages").update({is_pinned:!msg.is_pinned}).eq("id", msg.id);
  };

  const deleteMsg = async (msgId) => {
    await supabase.from("messages").delete().eq("id", msgId);
  };

  const toggleReaction = async (msg, emoji) => {
    const reactions = msg.reactions || {};
    const users = reactions[emoji] || [];
    const userId = user?.id || user?.email;
    const hasReacted = users.includes(userId);
    const updated = hasReacted ? users.filter(u=>u!==userId) : [...users, userId];
    const newReactions = {...reactions, [emoji]: updated};
    if (updated.length === 0) delete newReactions[emoji];
    // Optimistic update
    setMessages(prev => prev.map(m => m.id===msg.id ? {...m, reactions: newReactions} : m));
    await supabase.from("messages").update({reactions: newReactions}).eq("id", msg.id);
  };

  const pinned = messages.filter(m=>m.is_pinned);
  const regular = messages.filter(m=>!m.is_pinned);

  if (loading) return <Spinner label="Loading forum…" />;

  return (
    <div style={{marginTop:24,borderTop:"1px solid var(--border)",paddingTop:20}}>
      <div style={{fontSize:13,fontWeight:600,marginBottom:12}}>💬 Campaign Forum</div>

      {/* Pinned Messages */}
      {pinned.length>0&&(
        <div style={{marginBottom:16}}>
          {pinned.map(m=>(
            <div key={m.id} style={{background:"#fffbe6",border:"1px solid #ffe066",borderRadius:"var(--radius-sm)",padding:"10px 12px",marginBottom:8,position:"relative"}}>
              <div style={{fontSize:11,color:"#b08800",marginBottom:4}}>📌 Pinned · {m.sender_name}</div>
              <div style={{fontSize:13,color:"var(--ink)"}}>{m.content}</div>
              {canPin&&<button onClick={()=>togglePin(m)} style={{position:"absolute",top:8,right:8,background:"none",border:"none",cursor:"pointer",fontSize:11,color:"var(--ink3)"}}>Unpin</button>}
            </div>
          ))}
        </div>
      )}

      {/* Message Thread */}
      <div style={{maxHeight:320,overflowY:"auto",display:"flex",flexDirection:"column",gap:8,marginBottom:12,padding:"4px 0"}}>
        {regular.length===0&&<div style={{fontSize:13,color:"var(--ink3)",fontStyle:"italic",textAlign:"center",padding:16}}>No messages yet — start the conversation!</div>}
        {regular.map(m=>{
          const isMe = m.user_id===user?.id||m.sender_name===senderName();
          return (
            <div key={m.id} style={{display:"flex",flexDirection:"column",alignItems:isMe?"flex-end":"flex-start"}}>
              <div style={{fontSize:11,color:"var(--ink3)",marginBottom:2,paddingLeft:isMe?0:4,paddingRight:isMe?4:0}}>{m.sender_name} · {new Date(m.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
              <div style={{display:"flex",alignItems:"center",gap:6,flexDirection:isMe?"row-reverse":"row"}}>
                <div style={{display:"flex",flexDirection:"column",alignItems:isMe?"flex-end":"flex-start",gap:4}}>
                  <div style={{maxWidth:360,background:isMe?"var(--ink)":"var(--bg2)",color:isMe?"#fff":"var(--ink)",borderRadius:isMe?"16px 16px 4px 16px":"16px 16px 16px 4px",padding:"8px 12px",fontSize:13}}>{m.content}</div>
                  <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap",justifyContent:isMe?"flex-end":"flex-start"}}>
                    {["👍","👎"].map(emoji=>{
                      const users = (m.reactions||{})[emoji]||[];
                      const hasReacted = users.includes(user?.id||user?.email);
                      return (
                        <button key={emoji} onClick={()=>toggleReaction(m,emoji)} style={{background:hasReacted?"var(--bg3, #e8e8e8)":"var(--bg2)",border:"1px solid var(--border)",borderRadius:20,padding:"2px 7px",cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",gap:3}}>
                          {emoji}{users.length>0&&<span style={{fontSize:11,color:"var(--ink3)"}}>{users.length}</span>}
                        </button>
                      );
                    })}
                    {canPin&&<button onClick={()=>togglePin(m)} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,opacity:0.4}} title="Pin">📌</button>}
                    {(canPin||m.user_id===user?.id)&&<button onClick={()=>deleteMsg(m.id)} style={{background:"none",border:"1px solid var(--border)",borderRadius:20,padding:"2px 7px",cursor:"pointer",fontSize:11,color:"var(--red)",opacity:0.7}} title="Delete">🗑</button>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div style={{display:"flex",gap:8}}>
        <input
          className="form-input"
          style={{flex:1}}
          placeholder="Type a message..."
          value={input}
          onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()}
        />
        <button className="btn btn-primary btn-sm" onClick={send} disabled={sending||!input.trim()}>{sending?"...":"Send"}</button>
      </div>
    </div>
  );
}
