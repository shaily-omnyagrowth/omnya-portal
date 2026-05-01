const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).send('Missing authorization header');

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) return res.status(401).send('Unauthorized');

    let { platform } = req.body;
    if (!platform) return res.status(400).send('Missing platform');
    if (platform === 'instagram' || platform === 'facebook') {
      platform = 'meta';
    }

    // Remove token from database
    const { error } = await supabase
      .from('creator_tokens')
      .delete()
      .match({ user_id: user.id, platform });

    if (error) throw error;

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Disconnect error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
