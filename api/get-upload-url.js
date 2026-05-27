const { applyCors } = require('./_utils/cors');
const { requireAuth } = require('./_utils/auth');
const { Errors, sendOk } = require('./_utils/errors');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  // Require user session
  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const { fileName, fileSize, mimeType, folderId } = req.body || {};
    if (!fileName || !fileSize) {
      return Errors.badRequest(res, 'Missing fileName or fileSize');
    }

    // Get access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("Failed to get access token");

    // Create resumable upload session
    const metadata = { name: fileName };
    if (folderId) metadata.parents = [folderId];

    const initRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": mimeType || "video/mp4",
        "X-Upload-Content-Length": fileSize.toString(),
      },
      body: JSON.stringify(metadata),
    });

    if (!initRes.ok) {
      const err = await initRes.text();
      throw new Error("Failed to initiate upload: " + err);
    }

    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) throw new Error("No upload URL returned");

    // Secure flow: Never return Google Drive accessToken to browser/client!
    return sendOk(res, { uploadUrl });

  } catch (err) {
    console.error("Error in get-upload-url:", err);
    return Errors.internal(res, err.message);
  }
};
