import { Router } from "express";
import Post from "../models/Post.js";
import User from "../models/User.js"; // ✅ Ensure this model exists and matches your users collection

const router = Router();

/* ========================================================================== */
/* 🔍 GLOBAL SEARCH: Posts + Members                                          */
/* ========================================================================== */
/*
Example:
GET /api/search?q=foundation
Returns {
  success: true,
  query: "foundation",
  members: [...],
  posts: [...]
}
*/
router.get("/", async (req, res) => {
  try {
    const q = req.query.q?.trim();

    if (!q) {
      return res.status(400).json({ error: "Missing search query." });
    }

    const regex = new RegExp(q, "i");

    // Run both searches concurrently for performance
    const [posts, members] = await Promise.all([
      Post.find({
        $or: [
          { content: regex },
          { "member.fullname": regex },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),

      User.find({
        $or: [
          { fullname: regex },
          { username: regex },
          { email: regex },
        ],
      })
        .select("_id fullname avatar email username")
        .limit(10)
        .lean(),
    ]);

    // Normalize post results (ensure consistent media structure)
    const normalizedPosts = posts.map((p) => {
      const imageUrls = (p.imageUrls || []).map((img) => {
        const isVideo =
          img?.type === "video" ||
          (typeof img === "string" && img.match(/\.(mp4|mov|webm|avi)$/i));
        return {
          full: typeof img === "string" ? img : img.full || img.thumb,
          type: isVideo ? "video" : "image",
        };
      });

      return {
        ...p,
        imageUrls,
        member: p.member || { fullname: "Unknown", avatar: "/default-avatar.png" },
      };
    });

    res.json({
      success: true,
      query: q,
      members,
      posts: normalizedPosts,
    });
  } catch (err) {
    console.error("❌ Error performing search:", err);
    res.status(500).json({ message: "Failed to perform search" });
  }
});

export default router;
