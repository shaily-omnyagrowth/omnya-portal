const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Helper to set CORS headers
const setCorsHeaders = (req) => {
  const origin = req.headers.origin || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
};

// Helper to handle CORS preflight
const handleCors = (req, res) => {
  if (req.method === 'OPTIONS') {
    res.set(setCorsHeaders(req));
    res.status(204).send('');
    return true;
  }
  return false;
};

module.exports = async (req, res) => {
  // Handle CORS
  if (handleCors(req, res)) return;

  const headers = setCorsHeaders(req);
  res.set(headers);

  try {
    const { platform, creatorId } = req.query;

    if (!platform || !creatorId) {
      return res.status(400).json({ error: 'Missing platform or creatorId' });
    }

    // 1. Fetch token from creator_tokens table (Primary)
    const { data: tokenRecord, error: tokenError } = await supabase
      .from('creator_tokens')
      .select('*')
      .eq('creator_id', creatorId)
      .eq('platform', platform === 'instagram' ? 'meta' : platform)
      .single();

    let accessToken = tokenRecord?.access_token;

    // 2. Fallback to legacy creators table if no tokenRecord found
    if (!accessToken) {
      const { data: creator } = await supabase
        .from('creators')
        .select('*')
        .eq('id', creatorId)
        .single();
      
      if (creator) {
        if (platform === 'tiktok') accessToken = creator.tiktok_token;
        else if (platform === 'instagram') accessToken = creator.instagram_token;
        else if (platform === 'meta') accessToken = creator.instagram_token;
      }
    }

    // 3. Fetch data from platform API (Mock implementation for now)
    // In a real production scenario, we would use the accessToken to call the platform API
    let metrics = {};
    
    if (platform === 'tiktok') {
      metrics = {
        views: Math.floor(Math.random() * 10000) + 1500,
        likes: Math.floor(Math.random() * 1000) + 200,
        comments: Math.floor(Math.random() * 100) + 12,
        shares: Math.floor(Math.random() * 50) + 5,
        followers: Math.floor(Math.random() * 50000) + 1000
      };
    } else if (platform === 'instagram' || platform === 'meta') {
      metrics = {
        views: Math.floor(Math.random() * 8000) + 1200,
        likes: Math.floor(Math.random() * 1200) + 150,
        comments: Math.floor(Math.random() * 150) + 8,
        reach: Math.floor(Math.random() * 6000) + 900,
        followers: Math.floor(Math.random() * 45000) + 500
      };
    } else {
       // Fallback for others
       metrics = {
        views: 0, likes: 0, comments: 0, shares: 0, reach: 0
       };
    }

    // 4. Normalize metrics
    const normalized = {
      platform,
      creatorId,
      timestamp: new Date().toISOString(),
      live: !!accessToken, // Indicate if this is powered by a real token
      metrics: {
        views: metrics.views || 0,
        likes: metrics.likes || 0,
        comments: metrics.comments || 0,
        shares: metrics.shares || 0,
        reach: metrics.reach || metrics.followers || metrics.subscribers || 0
      }
    };

    return res.status(200).json(normalized);

  } catch (error) {
    console.error('Analytics proxy error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
