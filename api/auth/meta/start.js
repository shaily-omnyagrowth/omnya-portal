module.exports = async (req, res) => {
  const { userId, type } = req.query; // 'type' is instagram or facebook
  if (!userId) return res.status(400).send('Missing userId field');
  
  const appId = process.env.INSTAGRAM_APP_ID;
  const redirectUri = encodeURIComponent('https://www.portalomnyagrowth.com/api/auth/meta/callback');
  
  const state = Buffer.from(JSON.stringify({ userId, type: type || 'meta' })).toString('base64');
  
  const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&state=${state}&scope=instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement`;
  
  res.redirect(302, url);
};
