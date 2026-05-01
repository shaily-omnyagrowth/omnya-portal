const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase admin client
const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  // 1. Verify Authorization (Cron Secret)
  // Ensure only authorized services (like Vercel Cron) can trigger this
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('Starting Analytics Sync Job...');

    // 2. Fetch all valid tokens
    const { data: tokens, error: tokensError } = await supabase
      .from('creator_tokens')
      .select('*')
      .not('access_token', 'is', null);

    if (tokensError) throw tokensError;

    // 3. Fetch all active submissions that have posted links
    const { data: submissions, error: subError } = await supabase
      .from('submissions')
      .select('id, creator_id, user_id, campaign_id, platform, posted_link')
      .not('posted_link', 'is', null)
      .not('posted_link', 'eq', '')
      .eq('type', 'Final Post'); // Adjust this based on actual status terminology

    if (subError) throw subError;

    const results = [];

    // 4. Group submissions by user & platform to optimize API calls
    const grouped = {};
    submissions.forEach(sub => {
      // Extract video ID from link
      const videoId = extractVideoId(sub.platform, sub.posted_link);
      if (!videoId) return;

      const key = `${sub.user_id}_${sub.platform}`;
      if (!grouped[key]) grouped[key] = { submissions: [], token: null };
      grouped[key].submissions.push({ ...sub, videoId });
    });

    // Map tokens to the groups
    tokens.forEach(token => {
      // Since meta maps to both instagram and facebook, handle it
      if (token.platform === 'meta') {
        if (grouped[`${token.user_id}_instagram`]) grouped[`${token.user_id}_instagram`].token = token;
        if (grouped[`${token.user_id}_facebook`]) grouped[`${token.user_id}_facebook`].token = token;
      } else {
        if (grouped[`${token.user_id}_${token.platform}`]) {
          grouped[`${token.user_id}_${token.platform}`].token = token;
        }
      }
    });

    // 5. Execute API Calls (Parallelized by user/platform)
    const syncPromises = Object.values(grouped).map(async (group) => {
      if (!group.token || group.submissions.length === 0) return;

      const platform = group.submissions[0].platform.toLowerCase();
      
      try {
        let analyticsData = [];

        // Route to the correct platform handler
        switch (platform) {
          case 'youtube':
            analyticsData = await syncYouTubeMetrics(group.submissions, group.token.access_token);
            break;
          case 'tiktok':
            analyticsData = await syncTikTokMetrics(group.submissions, group.token.access_token);
            break;
          case 'instagram':
          case 'facebook':
            analyticsData = await syncMetaMetrics(group.submissions, group.token.access_token, platform);
            break;
          default:
            console.warn(`Unsupported platform for sync: ${platform}`);
        }

        // 6. Upsert the fetched metrics to Supabase
        if (analyticsData.length > 0) {
          const { error: upsertError } = await supabase
            .from('video_analytics')
            .upsert(analyticsData, { onConflict: 'video_id, platform' });
            
          if (upsertError) throw upsertError;
          results.push(...analyticsData);
        }

      } catch (err) {
        console.error(`Failed to sync ${platform} for user ${group.token.user_id}:`, err);
        // Note: Here you would normally detect 401s and trigger token refresh logic
      }
    });

    await Promise.all(syncPromises);

    res.status(200).json({ success: true, synced_count: results.length, data: results });
  } catch (error) {
    console.error('Analytics Sync Job Failed:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// --- Helper Functions ---

function extractVideoId(platform, url) {
  if (!url) return null;
  const p = platform.toLowerCase();
  try {
    if (p === 'youtube') {
      const match = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/) || url.match(/shorts\/([^?]+)/);
      return match ? match[1] : null;
    }
    if (p === 'tiktok') {
      const match = url.match(/video\/(\d+)/);
      return match ? match[1] : null;
    }
    if (p === 'instagram') {
      const match = url.match(/(?:p|reel)\/([A-Za-z0-9_-]+)/);
      return match ? match[1] : null;
    }
  } catch (e) { return null; }
  return null;
}

// --------------------------------------------------------------------------------
// Platform Handlers
// These functions orchestrate the actual fetch calls to the social networks
// --------------------------------------------------------------------------------

async function syncYouTubeMetrics(submissions, accessToken) {
  const videoIds = submissions.map(s => s.videoId).join(',');
  const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds}`;
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  
  if (!response.ok) throw new Error(`YouTube API Error: ${response.statusText}`);
  const data = await response.json();

  return data.items.map(item => {
    // Find the matching submission to grab campaign/user context
    const sub = submissions.find(s => s.videoId === item.id);
    return {
      video_id: item.id,
      platform: 'youtube',
      campaign_id: sub.campaign_id,
      user_id: sub.user_id,
      views: parseInt(item.statistics.viewCount || 0),
      likes: parseInt(item.statistics.likeCount || 0),
      comments: parseInt(item.statistics.commentCount || 0),
      shares: 0, // YouTube doesn't expose shares publicly easily
      reach: 0,
      pulled_at: new Date()
    };
  });
}

async function syncTikTokMetrics(submissions, accessToken) {
  const results = [];
  
  // TikTok allows max 20 videos per query
  const batchSize = 20;
  for (let i = 0; i < submissions.length; i += batchSize) {
    const batch = submissions.slice(i, i + batchSize);
    const videoIds = batch.map(s => s.videoId);
    
    // Explicitly request the metric fields
    const url = 'https://open.tiktokapis.com/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ filters: { video_ids: videoIds } })
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.data && data.data.videos) {
        data.data.videos.forEach(video => {
          const sub = batch.find(s => s.videoId === video.id);
          if (sub) {
            results.push({
              video_id: video.id,
              platform: 'tiktok',
              campaign_id: sub.campaign_id,
              user_id: sub.user_id,
              views: video.view_count || 0,
              likes: video.like_count || 0,
              comments: video.comment_count || 0,
              shares: video.share_count || 0,
              reach: 0,
              pulled_at: new Date()
            });
          }
        });
      }
    } else {
      console.error(`TikTok API Error: ${response.status} ${response.statusText}`);
    }
  }
  return results;
}

async function syncMetaMetrics(submissions, accessToken, specificPlatform) {
  const results = [];
  
  if (specificPlatform === 'instagram') {
    // 1. Get User's Pages & Instagram Accounts
    const accountRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=instagram_business_account,access_token&access_token=${accessToken}`);
    const accountData = await accountRes.json();
    
    if (!accountData.data || accountData.data.length === 0) return results;

    // 2. Fetch media for connected IG accounts to match shortcodes
    for (const page of accountData.data) {
      if (!page.instagram_business_account) continue;
      
      const igAccountId = page.instagram_business_account.id;

      // Fetch recent media for this IG account
      const mediaRes = await fetch(`https://graph.facebook.com/v19.0/${igAccountId}/media?fields=id,shortcode,like_count,comments_count,media_product_type&limit=100&access_token=${accessToken}`);
      const mediaData = await mediaRes.json();
      
      if (!mediaData.data) continue;

      for (const sub of submissions) {
        // sub.videoId is the extracted shortcode
        const matchedMedia = mediaData.data.find(m => m.shortcode === sub.videoId);
        if (matchedMedia) {
          let reach = 0;
          let views = 0;
          
          try {
            // Fetch Insights for Impressions/Reach/Plays
            const metricMap = matchedMedia.media_product_type === 'REELS' 
               ? 'plays,reach' 
               : 'impressions,reach';
               
            const insightsRes = await fetch(`https://graph.facebook.com/v19.0/${matchedMedia.id}/insights?metric=${metricMap}&access_token=${accessToken}`);
            const insightsData = await insightsRes.json();
            
            if (insightsData.data) {
               insightsData.data.forEach(metric => {
                 if (metric.name === 'reach') reach = metric.values[0]?.value || 0;
                 if (metric.name === 'plays' || metric.name === 'impressions') views = metric.values[0]?.value || 0;
               });
            }
          } catch (e) {
             console.error(`IG Insights fetch failed for ${matchedMedia.id}`, e);
          }

          results.push({
            video_id: sub.videoId, // keep shortcode as identifier in DB
            platform: 'instagram',
            campaign_id: sub.campaign_id,
            user_id: sub.user_id,
            views: views,
            likes: matchedMedia.like_count || 0,
            comments: matchedMedia.comments_count || 0,
            shares: 0, // Shares require specialized webhook/insights
            reach: reach,
            pulled_at: new Date()
          });
        }
      }
    }
  } else if (specificPlatform === 'facebook') {
    // Facebook Logic: videoId is likely the post ID
    for (const sub of submissions) {
      const res = await fetch(`https://graph.facebook.com/v19.0/${sub.videoId}?fields=shares,comments.summary(true),likes.summary(true)&access_token=${accessToken}`);
      if (res.ok) {
        const data = await res.json();
        results.push({
          video_id: sub.videoId,
          platform: 'facebook',
          campaign_id: sub.campaign_id,
          user_id: sub.user_id,
          views: 0, // Post impressions require page insights access
          likes: data.likes?.summary?.total_count || 0,
          comments: data.comments?.summary?.total_count || 0,
          shares: data.shares?.count || 0,
          reach: 0,
          pulled_at: new Date()
        });
      }
    }
  }

  return results;
}
