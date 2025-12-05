import "dotenv/config";
import path from "path";
import fs from "fs";
import https from "https";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  console.error("Missing Cloudinary credentials in env");
  process.exit(1);
}

const root = path.join(process.cwd(), "../client/uploads", "cloudinary");
const imagesDir = path.join(root, "images");
const videosDir = path.join(root, "videos");
for (const d of [root, imagesDir, videosDir]) {
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
}

function apiList(type, nextCursor) {
  const cursorParam = nextCursor ? `&next_cursor=${encodeURIComponent(nextCursor)}` : "";
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/resources/${type}?max_results=500${cursorParam}`;
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "GET",
      headers: {
        Authorization: "Basic " + Buffer.from(`${apiKey}:${apiSecret}`).toString("base64"),
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dest);
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (err) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function downloadAll(type) {
  let next = undefined;
  let count = 0;
  do {
    const resp = await apiList(type, next);
    const resources = resp.resources || [];
    for (const r of resources) {
      const url = r.secure_url || r.url;
      const format = r.format || "jpg";
      const basePath = type === "image" ? imagesDir : videosDir;
      const localPath = path.join(basePath, `${r.public_id}.${format}`);
      try { await download(url, localPath); count++; } catch {}
    }
    next = resp.next_cursor;
  } while (next);
  return count;
}

async function main() {
  const img = await downloadAll("image");
  const vid = await downloadAll("video");
  console.log(JSON.stringify({ imagesDownloaded: img, videosDownloaded: vid }));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
