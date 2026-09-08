// api/campaigns/share-report.js
//
// GET /api/campaigns/share-report?token=<share_token>
//
// Public endpoint for secure, isolated campaign reporting.
// Requires NO authentication, but strictly enforces token validity and share_enabled.
// Redacts all sensitive agency financials (rates, budgets, margins, commissions).

const { applyCors } = require('../_utils/cors');
const { Errors, sendOk } = require('../_utils/errors');
const { getSupabaseAdminClient } = require('../_utils/supabaseAdmin');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return Errors.methodNotAllowed(res);

  const token = req.query && req.query.token ? String(req.query.token).trim() : null;
  if (!token) {
    return Errors.badRequest(res, 'Share token is required.');
  }

  const supabase = getSupabaseAdminClient();

  // 1. Fetch campaign by share_token
  const { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .select('id, name, format, videos_needed, deadline, status, start_date, created_at, brief_url, description, client_id, share_enabled, share_token')
    .eq('share_token', token)
    .maybeSingle();

  if (cErr) {
    console.error('Error fetching shared campaign:', cErr.message);
    return Errors.internal(res, 'Failed to load campaign report.');
  }

  if (!campaign || !campaign.share_enabled) {
    return Errors.notFound(res, 'This shared campaign report is not available or has been disabled.');
  }

  // 2. Fetch Client Name (sanitized - no budget or terms)
  let clientName = 'Brand Partner';
  if (campaign.client_id) {
    const { data: client } = await supabase
      .from('clients')
      .select('name')
      .eq('id', campaign.client_id)
      .maybeSingle();
    if (client && client.name) clientName = client.name;
  }

  // 3. Fetch Approved Submissions
  const { data: rawSubmissions, error: sErr } = await supabase
    .from('submissions')
    .select('id, creator_id, platform, posted_link, concept_status, status, approved_date, created_at, views_24h, views_72h, views_1w, views_2w, views_1m, likes, comments, shares, saves')
    .eq('campaign_id', campaign.id)
    .eq('status', 'Approved');

  const submissions = rawSubmissions || [];

  // 4. Fetch Video Analytics for accurate metrics
  const submissionIds = submissions.map(s => s.id);
  let analyticsMap = {};
  if (submissionIds.length > 0) {
    const { data: analyticsList } = await supabase
      .from('video_analytics')
      .select('submission_id, platform, video_id, views, likes, comments, shares, saves, watch_time, pulled_at')
      .in('submission_id', submissionIds);

    (analyticsList || []).forEach(a => {
      analyticsMap[a.submission_id] = a;
    });
  }

  // 5. Fetch Public Creator Profiles (handles and name only)
  const creatorIds = Array.from(new Set(submissions.map(s => s.creator_id).filter(Boolean)));
  let creatorMap = {};
  if (creatorIds.length > 0) {
    const { data: creatorsList } = await supabase
      .from('creators')
      .select('id, name, tiktok_handle, instagram_handle')
      .in('id', creatorIds);

    (creatorsList || []).forEach(c => {
      creatorMap[c.id] = c;
    });
  }

  // 6. Aggregate KPIs & normalize posts
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  let totalSaves = 0;

  const normalizedPosts = submissions.map(s => {
    const a = analyticsMap[s.id];
    const views = Number(a?.views || s.views_1w || s.views_72h || s.views_24h || 0);
    const likes = Number(a?.likes || s.likes || 0);
    const comments = Number(a?.comments || s.comments || 0);
    const shares = Number(a?.shares || s.shares || 0);
    const saves = Number(a?.saves || s.saves || 0);
    const engagements = likes + comments + shares + saves;
    const engagementRate = views > 0 ? ((engagements / views) * 100).toFixed(2) : '0.00';

    totalViews += views;
    totalLikes += likes;
    totalComments += comments;
    totalShares += shares;
    totalSaves += saves;

    const creator = creatorMap[s.creator_id] || { name: 'Creator' };

    return {
      id: s.id,
      platform: (a?.platform || s.platform || campaign.format || 'tiktok').toLowerCase(),
      posted_link: s.posted_link,
      approved_date: s.approved_date || s.created_at,
      views,
      likes,
      comments,
      shares,
      saves,
      engagements,
      engagementRate,
      creatorName: creator.name,
      creatorHandles: {
        tiktok: creator.tiktok_handle,
        instagram: creator.instagram_handle
      }
    };
  });

  // Sort posts by views descending
  normalizedPosts.sort((a, b) => b.views - a.views);

  const totalEngagements = totalLikes + totalComments + totalShares + totalSaves;
  const overallEngagementRate = totalViews > 0 ? ((totalEngagements / totalViews) * 100).toFixed(2) : '0.00';

  // 7. Calculate Timeline & Week X Tracking
  const now = new Date();
  const startDate = campaign.start_date ? new Date(campaign.start_date) : new Date(campaign.created_at);
  const deadlineDate = campaign.deadline ? new Date(campaign.deadline) : null;

  let daysRemaining = null;
  let totalDays = null;
  let elapsedDays = null;
  let progressPct = 0;

  if (deadlineDate) {
    const diffTime = deadlineDate.getTime() - now.getTime();
    daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    totalDays = Math.max(1, Math.ceil((deadlineDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    elapsedDays = Math.max(0, Math.ceil((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  }

  const videosNeeded = Number(campaign.videos_needed) || 1;
  const deliveredCount = submissions.length;
  const deliveryPct = Math.min(100, Math.round((deliveredCount / videosNeeded) * 100));

  // Total flight duration in weeks
  const totalWeeks = totalDays ? Math.max(1, Math.ceil(totalDays / 7)) : 4;
  const currentWeek = elapsedDays !== null ? Math.min(totalWeeks, Math.max(1, Math.ceil(elapsedDays / 7))) : 1;

  // Expected deliverable pacing
  const expectedPace = Math.min(videosNeeded, Math.round((currentWeek / totalWeeks) * videosNeeded));
  let paceStatus = 'on_track';
  if (deliveredCount >= videosNeeded) {
    paceStatus = 'completed';
  } else if (deliveredCount < expectedPace - 1) {
    paceStatus = 'behind';
  } else if (deliveredCount > expectedPace) {
    paceStatus = 'ahead';
  }

  // Top 5 posts
  const topPosts = normalizedPosts.slice(0, 5);

  // Return clean sanitized report
  sendOk(res, {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      format: campaign.format,
      videos_needed: campaign.videos_needed,
      deadline: campaign.deadline,
      start_date: campaign.start_date || campaign.created_at,
      status: campaign.status,
      description: campaign.description,
      brief_url: campaign.brief_url
    },
    clientName,
    stats: {
      deliveredPosts: deliveredCount,
      targetPosts: videosNeeded,
      deliveryPct,
      totalViews,
      totalLikes,
      totalComments,
      totalShares,
      totalSaves,
      totalEngagements,
      engagementRate: overallEngagementRate,
      avgViewsPerPost: deliveredCount > 0 ? Math.round(totalViews / deliveredCount) : 0
    },
    timeline: {
      startDate: startDate.toISOString().split('T')[0],
      deadline: campaign.deadline,
      daysRemaining,
      totalWeeks,
      currentWeek,
      paceStatus
    },
    topPosts,
    posts: normalizedPosts,
    creators: Object.values(creatorMap).map(c => ({
      id: c.id,
      name: c.name,
      tiktok_handle: c.tiktok_handle,
      instagram_handle: c.instagram_handle
    }))
  });
};
