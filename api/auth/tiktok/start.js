module.exports = async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).send('Missing userId field required for OAuth state');
  
  const clientKey = process.env.TIKTOK_CLIENT_KEY || 'MISSING_KEY';
  const redirectUri = encodeURIComponent('https://www.portalomnyagrowth.com/api/auth/tiktok/callback');
  
  // Encode userId into state to prevent CSRF and identify the user on callback
  const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
  
  const url = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&response_type=code&scope=user.info.basic,video.list&redirect_uri=${redirectUri}&state=${state}`;
  
  res.redirect(302, url);
};
