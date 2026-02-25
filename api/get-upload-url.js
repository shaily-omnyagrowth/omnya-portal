export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { fileName, fileSize, mimeType, folderId } = req.body;

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
    if (!tokenData.access_token) throw new Error("Failed to get access token: " + JSON.stringify(tokenData));

    // Create resumable upload session
    const metadata = { name: fileName };
    if (folderId) metadata.parents = [folderId];

    const initRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": mimeType || "video/mp4",
        "X-Upload-Content-Length": fileSize,
      },
      body: JSON.stringify(metadata),
    });

    if (!initRes.ok) {
      const err = await initRes.text();
      throw new Error("Failed to initiate upload: " + err);
    }

    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) throw new Error("No upload URL returned");

    // Also return the access token so browser can make file public after upload
    return res.status(200).json({ 
      uploadUrl, 
      accessToken: tokenData.access_token 
    });

  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
