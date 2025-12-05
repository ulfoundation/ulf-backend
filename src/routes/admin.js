import { Router } from "express";
import User from "../models/User.js";
import Post from "../models/Post.js";
import Donation from "../models/Donation.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import https from "https";
import cloudinary from "../config/cloudinary.js";

const router = Router();

// ✅ All routes below require authenticated admin
router.use(requireAuth, requireAdmin);

/* -------------------------------------------------------------------------- */
/* 👥 Register Members (bulk)                                                 */
/* -------------------------------------------------------------------------- */
router.post("/members", async (req, res) => {
  try {
    const { members } = req.body; // [{ fullname, email, password }]
    if (!Array.isArray(members)) {
      return res.status(400).json({ error: "members must be an array" });
    }

    const created = [];

    for (const m of members) {
      if (!m.fullname || !m.email) continue;

      const existing = await User.findOne({ email: m.email });
      if (existing) continue;

      const passwordHash = await bcrypt.hash(m.password || "password123", 10);
      const user = await User.create({
        fullname: m.fullname,
        email: m.email,
        passwordHash,
        role: "member",
      });

      created.push({
        id: user._id,
        email: user.email,
        fullname: user.fullname,
      });
    }

    res.json({
      success: true,
      message: `${created.length} member(s) registered successfully.`,
      created,
    });
  } catch (err) {
    console.error("❌ Error registering members:", err);
    res.status(500).json({ error: "Failed to register members" });
  }
});

/* -------------------------------------------------------------------------- */
/* 🧾 Get All Members                                                         */
/* -------------------------------------------------------------------------- */
router.get("/members", async (_req, res) => {
  try {
    const members = await User.find({ role: "member" })
      .select("fullname email role createdAt isActive")
      .sort({ createdAt: -1 });
    res.json({ success: true, members });
  } catch (err) {
    console.error("❌ Error fetching members:", err);
    res.status(500).json({ error: "Failed to fetch members" });
  }
});

/* -------------------------------------------------------------------------- */
/* 🔄 Toggle Member Active/Inactive                                           */
/* -------------------------------------------------------------------------- */
router.patch("/members/:id/toggle", async (req, res) => {
  try {
    const member = await User.findById(req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });

    member.isActive = !member.isActive;
    await member.save();

    res.json({
      success: true,
      message: `Member ${member.isActive ? "activated" : "deactivated"} successfully.`,
      member,
    });
  } catch (err) {
    console.error("❌ Error toggling member:", err);
    res.status(500).json({ error: "Failed to update member status" });
  }
});

/* -------------------------------------------------------------------------- */
/* ❌ Delete Member                                                           */
/* -------------------------------------------------------------------------- */
router.delete("/members/:id", async (req, res) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Member not found" });

    res.json({ success: true, message: "Member deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting member:", err);
    res.status(500).json({ error: "Failed to delete member" });
  }
});

/* -------------------------------------------------------------------------- */
/* 📝 Create Post Assigned to a Member                                        */
/* -------------------------------------------------------------------------- */
router.post("/posts", async (req, res) => {
  try {
    const { title, content, imageUrl, memberId } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: "Title and content are required" });
    }

    const post = await Post.create({
      title,
      content,
      imageUrl,
      memberId,
      createdAt: new Date(),
    });

    res.json({ success: true, post });
  } catch (err) {
    console.error("❌ Error creating post:", err);
    res.status(500).json({ error: "Failed to create post" });
  }
});

/* -------------------------------------------------------------------------- */
/* 💰 Simple Donation Analytics                                              */
/* -------------------------------------------------------------------------- */
router.get("/stats/donations", async (_req, res) => {
  try {
    const byMember = await Donation.aggregate([
      {
        $group: {
          _id: "$memberId",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "member",
        },
      },
      {
        $unwind: {
          path: "$member",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          memberName: "$member.fullname",
          total: 1,
          count: 1,
        },
      },
      { $sort: { total: -1 } },
    ]);

    const total = await Donation.aggregate([
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    res.json({
      success: true,
      total: total[0]?.total || 0,
      breakdown: byMember,
    });
  } catch (err) {
    console.error("❌ Error fetching donation stats:", err);
    res.status(500).json({ error: "Failed to fetch donation stats" });
  }
});

export default router;
/* -------------------------------------------------------------------------- */
/* 🛠 Migrate all post media from Cloudinary to local storage                  */
/* -------------------------------------------------------------------------- */
function isVideoUrl(u) {
  const s = String(u).toLowerCase();
  return s.includes("/video/upload/") || s.match(/\.(mp4|mov|webm|avi)$/);
}

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

async function ensureLocalMedia(src, baseUrl, postImagesDir, postVideosDir) {
  const video = isVideoUrl(src);
  const dir = video ? postVideosDir : postImagesDir;
  const filename = stableFilenameFromCloudinary(src);
  const dest = path.join(dir, filename);
  try {
    await fs.access(dest);
  } catch {
    await new Promise((resolve, reject) => {
      const file = fsSync.createWriteStream(dest);
      const fetchWithRedirect = (url, redirectsLeft = 3) => {
        https
          .get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
              const next = res.headers.location.startsWith("http")
                ? res.headers.location
                : new URL(res.headers.location, url).toString();
              return fetchWithRedirect(next, redirectsLeft - 1);
            }
            if (res.statusCode !== 200) {
              file.close();
              fsSync.unlink(dest, () => {});
              return reject(new Error(`HTTP ${res.statusCode}`));
            }
            res.pipe(file);
            file.on("finish", () => file.close(resolve));
          })
          .on("error", (err) => {
            file.close();
            fsSync.unlink(dest, () => {});
            reject(err);
          });
      };
      // Try Cloudinary signed download for authenticated/private assets
      let dl = src;
      try {
        const ext = path.extname(filename).replace(/^\./, "") || (video ? "mp4" : "jpg");
        const publicId = new URL(src).pathname
          .split("/upload/")[1]
          .replace(/^v\d+\//, "")
          .replace(new RegExp(`\.${ext}$`), "");
        dl = cloudinary.utils.private_download_url(publicId, ext, {
          resource_type: video ? "video" : "image",
          type: "authenticated",
        });
      } catch {}
      fetchWithRedirect(dl);
    });
  }
  const url = `${baseUrl}/uploads/posts/${video ? "videos" : "images"}/${filename}`;
  return { full: url, thumb: url, type: video ? "video" : "image" };
}

router.post("/migrate/posts", async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const uploadsRoot = path.join(process.cwd(), "../client/uploads");
    const postImagesDir = path.join(uploadsRoot, "posts", "images");
    const postVideosDir = path.join(uploadsRoot, "posts", "videos");
    for (const d of [uploadsRoot, postImagesDir, postVideosDir]) {
      try { fsSync.mkdirSync(d, { recursive: true }); } catch {}
    }

    const posts = await Post.find({}).lean();
    let updated = 0;
    for (const p of posts) {
      const media = Array.isArray(p.imageUrls) ? p.imageUrls : [];
      let changed = false;
      const out = [];
      for (const m of media) {
        const src = typeof m === "string" ? m : m?.full || m?.thumb;
        if (typeof src === "string" && src.includes("cloudinary")) {
          try {
            const local = await ensureLocalMedia(src, baseUrl, postImagesDir, postVideosDir);
            out.push(local);
            changed = true;
          } catch {
            out.push(typeof m === "string" ? { full: src, thumb: src } : m);
          }
        } else {
          out.push(typeof m === "string" ? { full: src, thumb: src } : m);
        }
      }
      if (changed) {
        await Post.updateOne({ _id: p._id }, { $set: { imageUrls: out } });
        updated++;
      }
    }
    res.json({ success: true, postsUpdated: updated });
  } catch (err) {
    console.error("❌ Migration failed:", err);
    res.status(500).json({ error: "Migration failed" });
  }
});
