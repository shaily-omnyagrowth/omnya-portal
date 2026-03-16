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

    // 1. Fetch creator data to get token
    const { data: creator, error: creatorError } = await supabase
      .from('creators')
      .select('*')
      .eq('id', creatorId)
      .single();

    if (creatorError || !creator) {
      return res.status(404).json({ error: 'Creator not found' });
    }

    // 2. Get token - try different fields based on platform
    let accessToken = null;
    if (platform === 'tiktok') accessToken = creator.tiktok_token;
    else if (platform === 'instagram') accessToken = creator.instagram_token;
    else if (platform === 'youtube') accessToken = creator.youtube_token;
    else if (platform === 'facebook') accessToken = creator.facebook_token;
    else {
      return res.status(400).json({ error: 'Unsupported platform' });
    }

    if (!accessToken) {
      return res.status(404).json({ error: `No token found for ${platform}` });
    }

    // 3. Decrypt token if needed (simple base64 for now, replace with actual decryption)
    // const decryptedToken = Buffer.from(accessToken, 'base64').toString('utf-8');
    // Note: In production, use proper decryption (e.g., AES) with a secret key
    const decryptedToken = accessToken; 

    // 4. Fetch data from platform API (Mock implementation for now)
    let metrics = {};
    
    if (platform === 'tiktok') {
      // Mock TikTok API response
      // Real implementation would use TikTok API v2
      metrics = {
        views: Math.floor(Math.random() * 10000),
        likes: Math.floor(Math.random() * 1000),
        comments: Math.floor(Math.random() * 100),
        shares: Math.floor(Math.random() * 50),
        followers: Math.floor(Math.random() * 50000)
      };
    } else if (platform === 'instagram') {
      // Mock Instagram API response
      metrics = {
        views: Math.floor(Math.random() * 8000),
        likes: Math.floor(Math.random() * 1200),
        comments: Math.floor(Math.random() * 150),
        reach: Math.floor(Math.random() * 6000),
        followers: Math.floor(Math.random() * 45000)
      };
    } else if (platform === 'youtube') {
      metrics = {
        views: Math.floor(Math.random() * 50000),
        likes: Math.floor(Math.random() * 5000),
        comments: Math.floor(Math.random() * 500),
        subscribers: Math.floor(Math.random() * 100000)
      };
    } else if (platform === 'facebook') {
      metrics = {
        reach: Math.floor(Math.random() * 20000),
        likes: Math.floor(Math.random() * 3000),
        shares: Math.floor(Math.random() * 200),
        comments: Math.floor(Math.random() * 300)
      };
    }

    // 5. Normalize metrics
    const normalized = {
      platform,
      creatorId,
      timestamp: new Date().toISOString(),
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
