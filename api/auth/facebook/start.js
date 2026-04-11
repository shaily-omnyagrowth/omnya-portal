module.exports = async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).send('Missing userId');
  
  const appId = process.env.INSTAGRAM_APP_ID; // Sharing the same Meta App ID
  const redirectUri = encodeURIComponent('https://www.portalomnyagrowth.com/api/auth/meta/callback');
  
  const state = Buffer.from(JSON.stringify({ userId, type: 'facebook' })).toString('base64');
  
  // Using the Facebook-branded login endpoint
  const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&state=${state}&scope=pages_show_list,pages_read_engagement,pages_manage_posts`;
  
  res.redirect(302, url);
};
