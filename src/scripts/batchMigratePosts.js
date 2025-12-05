import "dotenv/config";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import https from "https";
import connectDB from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import Post from "../models/Post.js";

const uploadsRoot = path.join(process.cwd(), "../client/uploads");
const postImagesDir = path.join(uploadsRoot, "posts", "images");
const postVideosDir = path.join(uploadsRoot, "posts", "videos");
for (const d of [uploadsRoot, postImagesDir, postVideosDir]) { try { fsSync.mkdirSync(d, { recursive: true }); } catch {} }

function isVideoUrl(u) { const s = String(u).toLowerCase(); return s.includes("/video/upload/") || s.match(/\.(mp4|mov|webm|avi)$/); }
function stableFilenameFromCloudinary(u) {
  try {
    const p = new URL(u).pathname;
    const afterUpload = p.split("/upload/")[1] || p;
    const noVersion = afterUpload.replace(/^v\d+\//, "");
    const ext = path.extname(noVersion) || ".jpg";
    const name = noVersion.replace(ext, "");
    const safe = name.replace(/[^a-z0-9_-]+/gi, "-");
    return `${safe}${ext.toLowerCase()}`;
  } catch {
    const ext = path.extname(u) || ".jpg";
    const base = path.basename(u, ext).replace(/[^a-z0-9_-]+/gi, "-");
    return `${base}${ext}`;
  }
}

function downloadTo(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fsSync.createWriteStream(dest);
    const go = (u, redirects = 3) => {
      const req = https.request(u, { method: "GET", headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          const next = res.headers.location.startsWith("http") ? res.headers.location : new URL(res.headers.location, u).toString();
          req.destroy();
          return go(next, redirects - 1);
        }
        if (res.statusCode !== 200) {
          file.close(); fsSync.unlink(dest, () => {}); req.destroy(); return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on("finish", () => { file.close(resolve); req.destroy(); });
      });
      req.on("error", (err) => { file.close(); fsSync.unlink(dest, () => {}); reject(err); });
      req.end();
    };
    go(url);
  });
}

async function migrateAll() {
  await connectDB();
  const baseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5020}`;
  const posts = await Post.find({}).lean();
  let updated = 0;
  for (const p of posts) {
    const media = Array.isArray(p.imageUrls) ? p.imageUrls : [];
    let changed = false;
    const out = [];
    for (const m of media) {
      const src = typeof m === "string" ? m : m?.full || m?.thumb;
      if (typeof src === "string" && src.includes("cloudinary")) {
        const isVid = isVideoUrl(src);
        const dir = isVid ? postVideosDir : postImagesDir;
        const filename = stableFilenameFromCloudinary(src);
        const dest = path.join(dir, filename);
        try { await fs.access(dest); } catch {
          let dlUrl = src;
          try {
            const ext = path.extname(filename).replace(/^\./, "") || (isVid ? "mp4" : "jpg");
            const publicId = new URL(src).pathname.split("/upload/")[1].replace(/^v\d+\//, "").replace(new RegExp(`\.${ext}$`), "");
            dlUrl = cloudinary.utils.private_download_url(publicId, ext, { resource_type: isVid ? "video" : "image", type: "authenticated" });
          } catch {}
          await downloadTo(dlUrl, dest);
        }
        const url = `${baseUrl}/uploads/posts/${isVid ? "videos" : "images"}/${filename}`;
        out.push({ full: url, thumb: url, type: isVid ? "video" : "image" }); changed = true;
      } else {
        out.push(typeof m === "string" ? { full: src, thumb: src } : m);
      }
    }
    if (changed) { await Post.updateOne({ _id: p._id }, { $set: { imageUrls: out } }); updated++; }
  }
  console.log(JSON.stringify({ postsUpdated: updated }));
  process.exit(0);
}

migrateAll().catch((e) => { console.error(e); process.exit(1); });
