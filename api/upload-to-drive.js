const { applyCors } = require('./_utils/cors');
const { requireAuth } = require('./_utils/auth');
const { Errors, sendOk } = require('./_utils/errors');

const config = {
  api: {
    bodyParser: false,
    sizeLimit: "100mb",
  },
};

async function getAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Failed to get access token: " + JSON.stringify(data));
  return data.access_token;
}

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseBoundary(contentType) {
  const match = contentType.match(/boundary=(.+)$/);
  return match ? match[1].trim() : null;
}

function parseMultipart(body, boundary) {
  const delimiter = Buffer.from("--" + boundary);
  const parts = [];
  let start = 0;

  while (start < body.length) {
    const delimIdx = body.indexOf(delimiter, start);
    if (delimIdx === -1) break;
    
    const partStart = delimIdx + delimiter.length;
    if (body.slice(partStart, partStart + 2).toString() === "--") break;
    
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), partStart + 2);
    if (headerEnd === -1) break;

    const headers = body.slice(partStart + 2, headerEnd).toString();
    const nextDelim = body.indexOf(delimiter, headerEnd + 4);
    const dataEnd = nextDelim === -1 ? body.length : nextDelim - 2;
    const data = body.slice(headerEnd + 4, dataEnd);

    const nameMatch = headers.match(/name="([^"]+)"/);
    const fileMatch = headers.match(/filename="([^"]+)"/);
    
    parts.push({
      name: nameMatch ? nameMatch[1] : null,
      filename: fileMatch ? fileMatch[1] : null,
      data,
    });
    
    start = partStart;
  }

  return parts;
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return Errors.methodNotAllowed(res);

  // Require user session
  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const contentType = req.headers["content-type"] || "";
    const boundary = parseBoundary(contentType);
    if (!boundary) return Errors.badRequest(res, "No boundary in content-type");

    const rawBody = await getRawBody(req);
    const parts = parseMultipart(rawBody, boundary);

    const filePart = parts.find(p => p.filename);
    const folderPart = parts.find(p => p.name === "folderId");

    if (!filePart) return Errors.badRequest(res, "No file received");

    const fileName = filePart.filename;
    const fileData = filePart.data;
    const folderId = folderPart ? folderPart.data.toString().trim() : null;

    const accessToken = await getAccessToken();

    // Step 1: Create file metadata
    const metadata = { name: fileName };
    if (folderId) metadata.parents = [folderId];

    const metaRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "application/octet-stream",
        "X-Upload-Content-Length": fileData.length.toString(),
      },
      body: JSON.stringify(metadata),
    });

    if (!metaRes.ok) {
      const err = await metaRes.text();
      throw new Error("Failed to initiate upload: " + err);
    }

    const uploadUrl = metaRes.headers.get("location");
    if (!uploadUrl) throw new Error("No upload URL returned");

    // Step 2: Upload file data
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: fileData,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error("Upload failed: " + err);
    }

    const uploadData = await uploadRes.json();

    // Removed the "anyone reader" public permission call to enforce server-side privacy by default.
    const driveLink = `https://drive.google.com/file/d/${uploadData.id}/view`;
    return sendOk(res, { url: driveLink, id: uploadData.id });

  } catch (err) {
    console.error("Upload error:", err);
    return Errors.internal(res, err.message);
  }
};

module.exports.config = config;
