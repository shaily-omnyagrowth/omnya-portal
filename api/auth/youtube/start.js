module.exports = async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).send('Missing userId');
  
  // YouTube Data API v3 Scopes
  const scope = encodeURIComponent('https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly');
  const redirectUri = encodeURIComponent('https://www.portalomnyagrowth.com/api/auth/youtube/callback');
  const clientId = process.env.YOUTUBE_CLIENT_ID || 'DEMO_CLIENT_ID';
  
  const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
  
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}&access_type=offline&prompt=consent`;
  
  res.redirect(302, url);
};
