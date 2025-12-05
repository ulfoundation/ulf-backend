import "dotenv/config";
import connectDB from "../config/db.js";
import Post from "../models/Post.js";
import Member from "../models/Member.js";
import Team from "../models/Team.js";
import About from "../models/About.js";

async function main() {
  await connectDB();
  const posts = await Post.find({}).lean();
  let postCloud = 0;
  for (const p of posts) {
    const media = Array.isArray(p.imageUrls) ? p.imageUrls : [];
    if (
      media.some((m) => {
        const src = typeof m === "string" ? m : m?.full || m?.thumb;
        return typeof src === "string" && src.includes("cloudinary");
      })
    ) {
      postCloud++;
    }
  }

  const members = await Member.find({}).lean();
  const memberCloud = members.filter((m) => typeof m.avatar === "string" && m.avatar.includes("cloudinary")).length;

  const teams = await Team.find({}).lean();
  const teamCloud = teams.filter((t) => typeof t.photo === "string" && t.photo.includes("cloudinary")).length;

  const about = await About.findOne();
  const aboutCloud = about && Array.isArray(about.images)
    ? about.images.filter((u) => typeof u === "string" && u.includes("cloudinary")).length
    : 0;

  console.log(JSON.stringify({ postCloud, memberCloud, teamCloud, aboutCloud }));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
