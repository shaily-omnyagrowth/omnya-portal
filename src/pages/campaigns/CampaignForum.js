import { useEffect, useRef, useState } from "react";
import { Delete02Icon, Pin02Icon, ThumbsUpIcon } from "@hugeicons/core-free-icons";
import { gooeyToast as toast } from "goey-toast";
import { supabase } from "../../supabaseClient";
import Icon from "../../ui/Icon";
import { Skeleton } from "../../ui/Skeleton";
import { fmtRelativeTime } from "../../utils";

export default function CampaignForum({ campaign, user, db, canPin }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const listRef = useRef(null);

  const senderName = () => {
    const am = db.accountManagers.find(a => a.user_id === user?.id || a.email === user?.email);
    const creator = db.creators.find(c => c.user_id === user?.id || c.email === user?.email);
    return am?.name || creator?.name || user?.email?.split("@")[0] || "Unknown";
  };

  useEffect(() => {
    let cancelled = false;
    supabase.from("messages").select("*").eq("campaign_id", campaign.id).order("created_at", { ascending: true })
      .then(({ data }) => { if (!cancelled) { setMessages(data || []); setLoading(false); } });
    const filter = `campaign_id=eq.${campaign.id}`;
    const channel = supabase.channel(`campaign-${campaign.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter }, p => setMessages(prev => (prev.some(m => m.id === p.new.id) ? prev : [...prev, p.new])))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter }, p => setMessages(prev => prev.map(m => (m.id === p.new.id ? p.new : m))))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages", filter }, p => setMessages(prev => prev.filter(m => m.id !== p.old.id)))
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [campaign.id]);

  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length]);

  const send = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    setSending(true);
    const { data, error } = await supabase.from("messages").insert({ campaign_id: campaign.id, user_id: user?.id, sender_name: senderName(), content: input.trim(), is_pinned: false }).select().single();
    setSending(false);
    if (error) return toast.error("Message not sent", { description: error.message });
    setInput("");
    if (data) setMessages(prev => (prev.some(m => m.id === data.id) ? prev : [...prev, data]));
  };

  const togglePin = async (msg) => {
    if (!msg.is_pinned && messages.filter(m => m.is_pinned).length >= 3) return toast("Unpin a message first", { description: "Up to 3 messages can be pinned." });
    const { error } = await supabase.from("messages").update({ is_pinned: !msg.is_pinned }).eq("id", msg.id);
    if (error) toast.error("Couldn't update the pin", { description: error.message });
  };

  const remove = async (id) => {
    const { error } = await supabase.from("messages").delete().eq("id", id);
    if (error) toast.error("Message not deleted", { description: error.message });
  };

  const like = async (msg) => {
    const me = user?.id || user?.email;
    const reactions = { ...(msg.reactions || {}) };
    const list = reactions["👍"] || [];
    reactions["👍"] = list.includes(me) ? list.filter(u => u !== me) : [...list, me];
    if (!reactions["👍"].length) delete reactions["👍"];
    setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, reactions } : m)));
    await supabase.from("messages").update({ reactions }).eq("id", msg.id);
  };

  const pinned = messages.filter(m => m.is_pinned);

  return (
    <section className="forum">
      {pinned.length > 0 && (
        <div className="forum-pinned">
          {pinned.map(m => (
            <div key={m.id} className="forum-pin">
              <Icon icon={Pin02Icon} size={14} />
              <div className="flex-1"><div className="fs-12 text-muted">{m.sender_name}</div><p className="fs-13" style={{ whiteSpace: "pre-line" }}>{m.content}</p></div>
              {canPin && <button className="btn btn-ghost btn-sm" onClick={() => togglePin(m)}>Unpin</button>}
            </div>
          ))}
        </div>
      )}
      <div className="forum-list" ref={listRef}>
        {loading ? [1, 2, 3].map(i => <Skeleton key={i} h={44} w={i % 2 ? "60%" : "45%"} r={14} style={{ alignSelf: i % 2 ? "flex-start" : "flex-end" }} />)
          : messages.filter(m => !m.is_pinned).length === 0 ? <p className="fs-13 text-muted text-center" style={{ padding: 24 }}>No messages yet. Questions about the brief go here, so everyone sees the answer.</p>
          : messages.filter(m => !m.is_pinned).map(m => {
            const mine = m.user_id === user?.id;
            const likes = (m.reactions || {})["👍"] || [];
            const liked = likes.includes(user?.id || user?.email);
            return (
              <div key={m.id} className={`msg ${mine ? "mine" : ""}`}>
                <div className="fs-11 text-muted">{mine ? "You" : m.sender_name} · {fmtRelativeTime(m.created_at)}</div>
                <div className="msg-bubble">{m.content}</div>
                <div className="msg-actions">
                  <button className={`msg-act ${liked ? "on" : ""}`} onClick={() => like(m)} aria-label="Like" aria-pressed={liked}><Icon icon={ThumbsUpIcon} size={13} />{likes.length > 0 && likes.length}</button>
                  {canPin && <button className="msg-act" onClick={() => togglePin(m)} aria-label="Pin"><Icon icon={Pin02Icon} size={13} /></button>}
                  {(canPin || mine) && <button className="msg-act" onClick={() => remove(m.id)} aria-label="Delete"><Icon icon={Delete02Icon} size={13} /></button>}
                </div>
              </div>
            );
          })}
      </div>
      <form className="flex gap-8" onSubmit={send}>
        <input className="form-input flex-1" placeholder="Write a message" value={input} onChange={e => setInput(e.target.value)} aria-label="Message" />
        <button type="submit" className="btn btn-primary" disabled={sending || !input.trim()}>{sending ? "Sending…" : "Send"}</button>
      </form>
    </section>
  );
}
