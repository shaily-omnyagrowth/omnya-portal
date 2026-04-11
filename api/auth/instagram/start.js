module.exports = async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).send('Missing userId');
  
  // Instagram Basic Display + Graph Scopes
  const appId = process.env.INSTAGRAM_APP_ID;
  const redirectUri = encodeURIComponent('https://www.portalomnyagrowth.com/api/auth/meta/callback');
  
  const state = Buffer.from(JSON.stringify({ userId, type: 'instagram' })).toString('base64');
  
  // Using the instagram-branded login endpoint
  const url = `https://api.instagram.com/oauth/authorize?client_id=${appId}&redirect_uri=${redirectUri}&scope=user_profile,user_media&response_type=code&state=${state}`;
  
  res.redirect(302, url);
};
