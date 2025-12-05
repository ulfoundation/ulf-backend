import "dotenv/config";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import https from "https";
import connectDB from "../config/db.js";
import Post from "../models/Post.js";
import Member from "../models/Member.js";
import Team from "../models/Team.js";
import About from "../models/About.js";

const baseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5020}`;
const uploadsRoot = path.join(process.cwd(), "../client/uploads");
const postImagesDir = path.join(uploadsRoot, "posts", "images");
const postVideosDir = path.join(uploadsRoot, "posts", "videos");
const teamDir = path.join(uploadsRoot, "team");
const membersDir = path.join(uploadsRoot, "members");
const aboutDir = path.join(uploadsRoot, "about");

for (const dir of [uploadsRoot, postImagesDir, postVideosDir, teamDir, membersDir, aboutDir]) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

function extFromUrl(u) {
  try {
    const p = new URL(u).pathname;
    const e = path.extname(p);
    if (e) return e.toLowerCase();
    return ".jpg";
  } catch { return ".jpg"; }
}

function isVideoUrl(u) {
  const s = String(u).toLowerCase();
  return s.includes("/video/upload/") || s.match(/\.(mp4|mov|webm|avi)$/);
}

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const fetchWithRedirect = (u, redirectsLeft = 3) => {
      const req = https.request(u, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (MigrationScript)",
          Accept: "*/*",
        },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          const next = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, u).toString();
          req.destroy();
          return fetchWithRedirect(next, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
          req.destroy();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on("finish", () => { file.close(resolve); req.destroy(); });
      });
      req.on("error", (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });
      req.end();
    };
    fetchWithRedirect(url);
  });
}

async function migratePosts() {
  const posts = await Post.find({}).lean();
  let changed = 0;
  for (const p of posts) {
    const media = Array.isArray(p.imageUrls) ? p.imageUrls : [];
    let updated = false;
    const newMedia = [];
    for (const m of media) {
      const src = typeof m === "string" ? m : m?.full || m?.thumb;
      if (typeof src === "string" && src.includes("cloudinary")) {
        const video = m?.type === "video" || isVideoUrl(src);
        const dir = video ? postVideosDir : postImagesDir;
        const ext = extFromUrl(src);
        const base = path.basename(src, ext).replace(/[^a-z0-9_-]+/gi, "-");
        const filename = `${Date.now()}-${base}${ext}`;
        const dest = path.join(dir, filename);
        try {
          await download(src, dest);
          const url = `${baseUrl}/uploads/posts/${video ? "videos" : "images"}/${filename}`;
          newMedia.push({ full: url, thumb: url, type: video ? "video" : "image" });
          updated = true;
        } catch {
          newMedia.push(m);
        }
      } else {
        newMedia.push(m);
      }
    }
    if (updated) {
      await Post.updateOne({ _id: p._id }, { $set: { imageUrls: newMedia } });
      changed++;
    }
  }
  return changed;
}

async function migrateMembers() {
  const members = await Member.find({}).lean();
  let changed = 0;
  for (const m of members) {
    const src = m.avatar;
    if (typeof src === "string" && src.includes("cloudinary")) {
      const ext = extFromUrl(src);
      const base = path.basename(src, ext).replace(/[^a-z0-9_-]+/gi, "-");
      const filename = `${Date.now()}-${base}${ext}`;
      const dest = path.join(membersDir, filename);
      try {
        await download(src, dest);
        const url = `${baseUrl}/uploads/members/${filename}`;
        await Member.updateOne({ _id: m._id }, { $set: { avatar: url } });
        changed++;
      } catch {}
    }
  }
  return changed;
}

async function migrateTeams() {
  const teams = await Team.find({}).lean();
  let changed = 0;
  for (const t of teams) {
    const src = t.photo;
    if (typeof src === "string" && src.includes("cloudinary")) {
      const ext = extFromUrl(src);
      const base = path.basename(src, ext).replace(/[^a-z0-9_-]+/gi, "-");
      const filename = `${Date.now()}-${base}${ext}`;
      const dest = path.join(teamDir, filename);
      try {
        await download(src, dest);
        const url = `${baseUrl}/uploads/team/${filename}`;
        await Team.updateOne({ _id: t._id }, { $set: { photo: url } });
        changed++;
      } catch {}
    }
  }
  return changed;
}

async function migrateAbout() {
  const about = await About.findOne();
  if (!about) return 0;
  const imgs = Array.isArray(about.images) ? about.images : [];
  const newImgs = [];
  let updated = false;
  for (const src of imgs) {
    if (typeof src === "string" && src.includes("cloudinary")) {
      const ext = extFromUrl(src);
      const base = path.basename(src, ext).replace(/[^a-z0-9_-]+/gi, "-");
      const filename = `${Date.now()}-${base}${ext}`;
      const dest = path.join(aboutDir, filename);
      try {
        await download(src, dest);
        const url = `${baseUrl}/uploads/about/${filename}`;
        newImgs.push(url);
        updated = true;
      } catch {
        newImgs.push(src);
      }
    } else {
      newImgs.push(src);
    }
  }
  if (updated) {
    await About.updateOne({ _id: about._id }, { $set: { images: newImgs } });
    return 1;
  }
  return 0;
}

async function main() {
  await connectDB();
  const p = await migratePosts();
  const m = await migrateMembers();
  const t = await migrateTeams();
  const a = await migrateAbout();
  console.log(JSON.stringify({ postsUpdated: p, membersUpdated: m, teamsUpdated: t, aboutUpdated: a }));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
