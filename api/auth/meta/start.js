module.exports = async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).send('Missing userId');
  
  const clientId = process.env.FACEBOOK_APP_ID;
  const redirectUri = encodeURIComponent('https://www.portalomnyagrowth.com/api/auth/meta/callback');
  
  const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
  
  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=instagram_basic,instagram_manage_insights,pages_show_list`;
  
  res.redirect(302, authUrl);
};
