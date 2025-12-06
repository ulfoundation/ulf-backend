import "dotenv/config";
import path from "path";
import fs from "fs";
import https from "https";
import connectDB from "../config/db.js";
import Post from "../models/Post.js";
import Member from "../models/Member.js";
import Team from "../models/Team.js";
import About from "../models/About.js";
import { UPLOADS_ROOT } from "../utils/media.js";
import { uploadFileToFirebase } from "../utils/firebase.js";

function isVideoByExt(p) {
  return /\.(mp4|mov|webm|avi)$/i.test(p || "");
}

function relFromUrl(u) {
  if (!u || typeof u !== "string") return null;
  const idx = u.indexOf("/uploads/");
  if (idx === -1) return null;
  return u.slice(idx + "/uploads/".length);
}

function downloadToTemp(url) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(process.cwd(), `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const file = fs.createWriteStream(tmp);
    const fetchWithRedirect = (u, redirectsLeft = 3) => {
      https
        .get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
            const next = res.headers.location.startsWith("http") ? res.headers.location : new URL(res.headers.location, u).toString();
            return fetchWithRedirect(next, redirectsLeft - 1);
          }
          if (res.statusCode !== 200) {
            file.close();
            fs.unlinkSync(tmp);
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          res.pipe(file);
          file.on("finish", () => file.close(() => resolve(tmp)));
        })
        .on("error", (err) => {
          try { file.close(); } catch {}
          try { fs.unlinkSync(tmp); } catch {}
          reject(err);
        });
    };
    fetchWithRedirect(url);
  });
}

async function migratePosts() {
  let updated = 0;
  const posts = await Post.find({}).lean();
  for (const p of posts) {
    const media = Array.isArray(p.imageUrls) ? p.imageUrls : [];
    let changed = false;
    const out = [];
    for (const m of media) {
      const src = typeof m === "string" ? m : m?.full || m?.thumb;
      if (typeof src === "string" && src.includes("storage.googleapis.com")) {
        out.push(typeof m === "string" ? src : m);
        continue;
      }
      let localPath = null;
      let mimetype = "image/jpeg";
      let isVideo = false;
      const rel = relFromUrl(src);
      if (rel) {
        localPath = path.join(UPLOADS_ROOT, rel);
        isVideo = isVideoByExt(rel);
        mimetype = isVideo ? "video/mp4" : "image/jpeg";
      } else if (typeof src === "string" && src.includes("cloudinary")) {
        try {
          localPath = await downloadToTemp(src);
          isVideo = /video\/upload\//.test(src) || isVideoByExt(src);
          mimetype = isVideo ? "video/mp4" : "image/jpeg";
        } catch {
          out.push(typeof m === "string" ? src : m);
          continue;
        }
      }
      if (localPath && fs.existsSync(localPath)) {
        const name = path.basename(localPath);
        const dest = `posts/${isVideo ? "videos" : "images"}/${name}`;
        try {
          const url = await uploadFileToFirebase(localPath, dest, mimetype, true);
          if (!rel) { try { fs.unlinkSync(localPath); } catch {} }
          changed = true;
          out.push(typeof m === "string" ? url : { ...m, full: url, thumb: url });
        } catch {
          out.push(typeof m === "string" ? src : m);
        }
      } else {
        out.push(typeof m === "string" ? src : m);
      }
    }
    if (changed) {
      await Post.updateOne({ _id: p._id }, { $set: { imageUrls: out } });
      updated++;
    }
  }
  return updated;
}

async function migrateMembers() {
  let updated = 0;
  const members = await Member.find({}).lean();
  for (const m of members) {
    const src = m.avatar;
    if (!src || typeof src !== "string" || src.includes("storage.googleapis.com")) continue;
    const rel = relFromUrl(src);
    let localPath = rel ? path.join(UPLOADS_ROOT, rel) : null;
    if (!localPath || !fs.existsSync(localPath)) continue;
    const name = path.basename(localPath);
    const dest = `members/${name}`;
    try {
      const url = await uploadFileToFirebase(localPath, dest, "image/jpeg", true);
      await Member.updateOne({ _id: m._id }, { $set: { avatar: url } });
      updated++;
    } catch {}
  }
  return updated;
}

async function migrateTeam() {
  let updated = 0;
  const team = await Team.find({}).lean();
  for (const t of team) {
    const src = t.photo;
    if (!src || typeof src !== "string" || src.includes("storage.googleapis.com")) continue;
    const rel = relFromUrl(src);
    let localPath = rel ? path.join(UPLOADS_ROOT, rel) : null;
    if (!localPath || !fs.existsSync(localPath)) continue;
    const name = path.basename(localPath);
    const dest = `team/${name}`;
    try {
      const url = await uploadFileToFirebase(localPath, dest, "image/jpeg", true);
      await Team.updateOne({ _id: t._id }, { $set: { photo: url } });
      updated++;
    } catch {}
  }
  return updated;
}

async function migrateAbout() {
  let updated = 0;
  const about = await About.findOne();
  if (!about) return updated;
  if (!Array.isArray(about.images) || about.images.length === 0) return updated;
  const out = [];
  for (const src of about.images) {
    if (typeof src === "string" && src.includes("storage.googleapis.com")) { out.push(src); continue; }
    const rel = relFromUrl(src);
    let localPath = rel ? path.join(UPLOADS_ROOT, rel) : null;
    if (!localPath || !fs.existsSync(localPath)) { out.push(src); continue; }
    const name = path.basename(localPath);
    const dest = `about/${name}`;
    try {
      const url = await uploadFileToFirebase(localPath, dest, "image/jpeg", true);
      out.push(url);
    } catch {
      out.push(src);
    }
  }
  if (JSON.stringify(out) !== JSON.stringify(about.images)) {
    await About.updateOne({ _id: about._id }, { $set: { images: out } });
    updated++;
  }
  return updated;
}

async function run() {
  await connectDB();
  const postsUpdated = await migratePosts();
  const membersUpdated = await migrateMembers();
  const teamUpdated = await migrateTeam();
  const aboutUpdated = await migrateAbout();
  console.log(JSON.stringify({ postsUpdated, membersUpdated, teamUpdated, aboutUpdated }));
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });

