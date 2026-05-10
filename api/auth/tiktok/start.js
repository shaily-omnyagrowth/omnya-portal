module.exports = async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).send('Missing userId field required for OAuth state');
  
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  console.log(`[TikTok OAuth Start] Client Key Present: ${!!clientKey}`);
  
  const redirectUri = 'https://www.portalomnyagrowth.com/api/auth/tiktok/callback';
  
  // Encode userId into state to prevent CSRF and identify the user on callback
  const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
  
  const searchParams = new URLSearchParams({
    client_key: clientKey,
    response_type: 'code',
    scope: 'user.info.basic',
    redirect_uri: redirectUri,
    state: state
  });

  const url = `https://www.tiktok.com/v2/auth/authorize/?${searchParams.toString()}`;
  
  res.redirect(302, url);
};
