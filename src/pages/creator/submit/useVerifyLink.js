import { useEffect, useState } from "react";
import { supabase } from "../../../supabaseClient";

export const linkPlatform = (url) =>
  /tiktok\.com/i.test(url) ? "TikTok"
  : /instagram\.com/i.test(url) ? "Instagram"
  : /youtube\.com|youtu\.be/i.test(url) ? "YouTube"
  : /facebook\.com|fb\.watch/i.test(url) ? "Facebook"
  : null;

export async function authedPost(path, body) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

// Final videos are only accepted for platforms whose stats we can pull.
export function useConnectedPlatforms(userId) {
  const [set, setSet] = useState(new Set());
  useEffect(() => {
    setSet(new Set());
    if (!userId) return;
    supabase.from("creator_social_accounts_safe").select("platform, connection_status").eq("user_id", userId)
      .then(({ data }) => setSet(new Set((data || []).filter(a => a.connection_status === "connected").map(a => a.platform))));
  }, [userId]);
  return { connected: set, isConnected: (p) => set.has((p || "").toLowerCase()) };
}

export function useVerifyLink({ creator, isConnected }) {
  const [verifying, setVerifying] = useState(false);
  const [verifyErr, setVerifyErr] = useState("");
  const [verifiedVideo, setVerifiedVideo] = useState(null);

  const reset = () => { setVerifiedVideo(null); setVerifyErr(""); };

  const verify = async (rawUrl, platform) => {
    const url = (rawUrl || "").trim();
    if (!url) { setVerifyErr("Paste the video link first."); return null; }
    if (!isConnected(platform)) { setVerifyErr(`Connect ${platform} on the Social channels page so we can confirm the video is yours.`); return null; }
    setVerifying(true); setVerifyErr("");
    try {
      const { ok, json } = await authedPost("/api/social/verify-video-link", { url, creatorId: creator?.id });
      if (!ok) { setVerifyErr(json?.error?.message || json?.message || "We couldn't verify that link."); setVerifiedVideo(null); return null; }
      const video = json?.data?.video || null;
      setVerifiedVideo(video);
      return video;
    } catch (e) {
      setVerifyErr(e.message || "Network error while checking the link.");
      setVerifiedVideo(null);
      return null;
    } finally {
      setVerifying(false);
    }
  };

  return { verify, verifying, verifyErr, verifiedVideo, reset };
}
