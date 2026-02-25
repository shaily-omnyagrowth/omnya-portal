const { Readable } = require("stream");

export const config = {
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
      client_id: process.env.REACT_APP_GOOGLE_CLIENT_ID,
      client_secret: process.env.REACT_APP_GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.REACT_APP_GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Failed to get access token: " + JSON.stringify(data));
  return data.access_token;
}

async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] || "";
      const boundary = contentType.split("boundary=")[1];
      if (!boundary) return reject(new Error("No boundary found"));

      const parts = body.toString("binary").split("--" + boundary);
      let file = null;
      let fileName = "";
      let folderId = null;

      for (const part of parts) {
        if (part.includes("Content-Disposition")) {
          if (part.includes('name="folderId"')) {
            const valueMatch = part.match(/\r\n\r\n(.*)\r\n$/);
            if (valueMatch) folderId = valueMatch[1].trim();
          } else if (part.includes('name="file"')) {
            const nameMatch = part.match(/filename="([^"]+)"/);
            if (nameMatch) fileName = nameMatch[1];
            const dataStart = part.indexOf("\r\n\r\n") + 4;
            const dataEnd = part.lastIndexOf("\r\n");
            if (dataStart > 3 && dataEnd > dataStart) {
              file = Buffer.from(part.slice(dataStart, dataEnd), "binary");
            }
          }
        }
      }
      resolve({ file, fileName, folderId });
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { file, fileName, folderId } = await parseMultipart(req);
    if (!file) return res.status(400).json({ error: "No file received" });

    const accessToken = await getAccessToken();

    const metadata = {
      name: fileName,
      ...(folderId ? { parents: [folderId] } : {}),
    };

    const boundary = "omnya_boundary_" + Date.now();
    const metadataStr = JSON.stringify(metadata);

    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataStr}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`
      ),
      file,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const uploadRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );

    const uploadData = await uploadRes.json();
    if (uploadData.error) throw new Error(uploadData.error.message);

    const driveLink = uploadData.webViewLink || `https://drive.google.com/file/d/${uploadData.id}/view`;
    return res.status(200).json({ url: driveLink, id: uploadData.id });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ error: err.message });
  }
}
