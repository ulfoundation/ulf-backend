import "dotenv/config";
import connectDB from "../config/db.js";
import Post from "../models/Post.js";
import Member from "../models/Member.js";
import Team from "../models/Team.js";
import About from "../models/About.js";

function normalize(publicBase, url) {
  if (!url || typeof url !== "string") return url;
  const idx = url.indexOf("/uploads/");
  if (idx === -1) return url;
  const rel = url.slice(idx + "/uploads/".length);
  return `${publicBase}/uploads/${rel}`;
}

async function run() {
  const raw = (process.env.PUBLIC_BASE_URL || "").trim();
  const publicBase = raw.replace(/\/+$/, "");
  if (!publicBase) {
    console.error("PUBLIC_BASE_URL is not set");
    process.exit(1);
  }

  await connectDB();

  let postsUpdated = 0;
  const posts = await Post.find({}).lean();
  for (const p of posts) {
    const media = Array.isArray(p.imageUrls) ? p.imageUrls : [];
    let changed = false;
    const out = media.map((m) => {
      const src = typeof m === "string" ? m : m?.full || m?.thumb;
      const full = normalize(publicBase, src);
      const thumb = full;
      if (full !== src) changed = true;
      return typeof m === "string" ? full : { ...m, full, thumb };
    });
    if (changed) {
      await Post.updateOne({ _id: p._id }, { $set: { imageUrls: out } });
      postsUpdated++;
    }
  }

  let membersUpdated = 0;
  const members = await Member.find({}).lean();
  for (const m of members) {
    const avatar = normalize(publicBase, m.avatar);
    if (avatar !== m.avatar) {
      await Member.updateOne({ _id: m._id }, { $set: { avatar } });
      membersUpdated++;
    }
  }

  let teamUpdated = 0;
  const team = await Team.find({}).lean();
  for (const t of team) {
    const photo = normalize(publicBase, t.photo);
    if (photo !== t.photo) {
      await Team.updateOne({ _id: t._id }, { $set: { photo } });
      teamUpdated++;
    }
  }

  let aboutUpdated = 0;
  const about = await About.findOne();
  if (about && Array.isArray(about.images)) {
    const imgs = about.images.map((u) => normalize(publicBase, u));
    if (JSON.stringify(imgs) !== JSON.stringify(about.images)) {
      await About.updateOne({ _id: about._id }, { $set: { images: imgs } });
      aboutUpdated++;
    }
  }

  console.log(
    JSON.stringify({ postsUpdated, membersUpdated, teamUpdated, aboutUpdated })
  );
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

