import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Spots left per campaign id; a campaign is missing when it has no limit or the lookup failed.
export function useCampaignSpots(campaignIds) {
  const [spots, setSpots] = useState({});
  const key = [...campaignIds].sort().join(",");
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    supabase.rpc("campaign_spots", { p_campaign_ids: key.split(",") }).then(({ data }) => {
      if (live) setSpots(Object.fromEntries((data || []).filter(r => r.spots_left != null).map(r => [r.campaign_id, r.spots_left])));
    });
    return () => { live = false; };
  }, [key]);
  return spots;
}

export const spotsLabel = (left) => `${left} ${left === 1 ? "spot" : "spots"} left`;
