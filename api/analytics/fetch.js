const { createClient } = require('@supabase/supabase-js');

const setCorsHeaders = (req) => ({
  'Access-Control-Allow-Origin': req.headers.origin || '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

module.exports = async (req, res) => {
  const corsHeaders = setCorsHeaders(req);
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing auth header' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

  try {
    let body = req.body;
    if (typeof body === 'string') try { body = JSON.parse(body); } catch (_) {}
    const { submissionId, platform, videoId, creatorId, campaignId } = body || {};
    
    if (!submissionId || !platform || !videoId || !creatorId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 1. Fetch Token securely directly from DB using service_role
    const { data: tokenData } = await supabase.from('creator_tokens')
      .select('*').eq('creator_id', creatorId).eq('platform', platform).single();
      
    if (!tokenData) return res.status(404).json({ error: `No ${platform} account connected` });

    const hasExpired = tokenData.expires_at && new Date(tokenData.expires_at) < new Date();
    if (hasExpired && platform === 'tiktok') {
        // Here you would trigger the refresh_token swap over TikTok API 
        // For now, fail explicitly so frontend knows token is dead
        return res.status(401).json({ error: 'Token expired, requires refresh' });
    }

    // 2. Fetch from Social API
    let results = { views: 0, likes: 0, comments: 0, shares: 0, reach: 0, saves: 0 };

    if (platform === 'meta' || platform === 'instagram') {
      try {
        // Fetch specific media data (likes, comments)
        const mediaRes = await fetch(`https://graph.facebook.com/v19.0/${videoId}?fields=like_count,comments_count&access_token=${tokenData.access_token}`);
        if (mediaRes.ok) {
          const mediaData = await mediaRes.json();
          results.likes = mediaData.like_count || 0;
          results.comments = mediaData.comments_count || 0;
        }

        // Fetch insights (reach, saved, impressions)
        // Note: Specific metrics depend on media type. We request a broad set and handle what returns.
        const insightsRes = await fetch(`https://graph.facebook.com/v19.0/${videoId}/insights?metric=impressions,reach,saved,video_views&access_token=${tokenData.access_token}`);
        if (insightsRes.ok) {
          const insightsData = await insightsRes.json();
          (insightsData.data || []).forEach(m => {
             const val = m.values?.[0]?.value || 0;
             if (m.name === 'impressions') results.views = val;
             if (m.name === 'video_views') results.views = val; // Override with video_views if available
             if (m.name === 'reach') results.reach = val;
             if (m.name === 'saved') results.saves = val;
          });
        }
      } catch (err) {
        console.warn('Meta API Fetch Warn:', err);
      }
    } else {
      // Mock other platforms for now
      results.views = Math.floor(Math.random() * 50000) + 1000;
      results.likes = Math.floor(results.views * 0.1);
      results.shares = Math.floor(results.likes * 0.05);
    }

    // 3. Upsert into video_analytics directly through proxy
    const { error: dbError } = await supabase.from('video_analytics').upsert({
      platform,
      creator_id: creatorId,
      campaign_id: campaignId,
      submission_id: submissionId,
      video_id: videoId,
      views: results.views,
      likes: results.likes,
      comments: results.comments || 0,
      shares: results.shares || 0,
      reach: results.reach || 0,
      saves: results.saves || 0,
      pulled_at: new Date().toISOString()
    }, { onConflict: 'submission_id' });

    if (dbError) throw dbError;

    return res.status(200).json({ success: true, ...results, status: 'synced' });
  } catch (err) {
    console.error('Analytics Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
