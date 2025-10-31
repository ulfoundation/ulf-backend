import { Router } from "express";
import multer from "multer";
import fs from "fs/promises";
import cloudinary from "../config/cloudinary.js";
import Post from "../models/Post.js";
import Comment from "../models/Comment.js";
import Like from "../models/Like.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

/* -------------------------------------------------------------------------- */
/* 🧩 Temporary local upload storage (before Cloudinary)                       */
/* -------------------------------------------------------------------------- */
const upload = multer({
  dest: "temp_uploads/",
  limits: { fileSize: 200 * 1024 * 1024, files: 10 }, // 200MB max
});

/* ========================================================================== */
/* 📝 CREATE NEW POST — Admin Only (auto dev fallback)                         */
/* ========================================================================== */
router.post(
  "/",
  async (req, res, next) => {
    // ✅ Auto inject fake admin when not in production
    if (process.env.NODE_ENV !== "production") {
      if (!req.user) {
        req.user = {
          id: "foundation-admin",
          fullname: "Foundation Admin",
          avatar: "/default-avatar.png",
          role: "admin",
        };
        console.log("🧩 Dev mode: injected fake admin user");
      }
    }
    next();
  },
  requireAuth,
  upload.array("media", 10),
  async (req, res) => {
    try {
      const { content } = req.body;
      const user = req.user || {
        id: "foundation-admin",
        fullname: "Foundation Admin",
        avatar: "/default-avatar.png",
        role: "admin",
      };

      // ✅ Restrict post creation to admins only
      if (user.role !== "admin") {
        return res
          .status(403)
          .json({ message: "Access denied — only admins can create posts" });
      }

      if (!content && (!req.files || req.files.length === 0)) {
        return res
          .status(400)
          .json({ message: "Post must include text or media" });
      }

      const media = [];

      for (const file of req.files) {
        console.log(`🚀 Uploading ${file.originalname} (${file.mimetype}) to Cloudinary...`);
        const isVideo = file.mimetype.startsWith("video/");

        try {
          const uploadOptions = {
            folder: "ulf_uploads",
            resource_type: isVideo ? "video" : "image",
            use_filename: true,
            unique_filename: false,
            eager_async: true, // ✅ async to avoid video timeout
          };

          if (!isVideo) {
            uploadOptions.quality = "auto";
            uploadOptions.fetch_format = "auto";
          }

          const result = await cloudinary.uploader.upload(file.path, uploadOptions);
          console.log("✅ Uploaded successfully:", result.secure_url);

          media.push({
            full: result.secure_url,
            thumb: result.secure_url,
            type: isVideo ? "video" : "image",
          });
        } catch (cloudErr) {
          console.error("❌ Cloudinary upload error:", cloudErr);
          throw cloudErr;
        } finally {
          // Clean up local temp file
          await fs.unlink(file.path).catch(() => {});
        }
      }

      const newPost = new Post({
        content,
        imageUrls: media,
        createdAt: new Date(),
        member: { fullname: user.fullname, avatar: user.avatar },
        userId: user.id,
        likes: [],
      });

      await newPost.save();
      console.log("✅ Post created successfully:", newPost._id);

      res.status(201).json({ message: "Post created successfully", post: newPost });
    } catch (err) {
      console.error("\n💥 Fatal error creating post:", err);
      res.status(500).json({
        message: "Failed to create post",
        error: err?.message || "Unknown Cloudinary error",
      });
    }
  }
);

/* ========================================================================== */
/* 📬 FETCH ALL POSTS — With Pagination Support                               */
/* ========================================================================== */
router.get("/", async (req, res) => {
  try {
    const userId = req.user?.id || "foundation-admin";
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const posts = await Post.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const enriched = await Promise.all(
      posts.map(async (p) => {
        const [commentsCount, likesCount, userLiked] = await Promise.all([
          Comment.countDocuments({ postId: p._id }),
          Like.countDocuments({ postId: p._id }),
          Like.exists({ postId: p._id, userId }),
        ]);
        return { ...p, commentsCount, likesCount, liked: !!userLiked };
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error("❌ Error fetching posts:", err?.message || err);
    res.status(500).json({ message: "Failed to fetch posts" });
  }
});

/* ========================================================================== */
/* ❤️ LIKE / UNLIKE POST                                                     */
/* ========================================================================== */
router.post("/:id/like", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id || "foundation-admin";
    const postId = req.params.id;

    const existingLike = await Like.findOne({ postId, userId });
    if (existingLike) {
      await Like.deleteOne({ _id: existingLike._id });
    } else {
      await Like.create({ postId, userId });
    }

    const likesCount = await Like.countDocuments({ postId });
    res.json({ liked: !existingLike, likesCount });
  } catch (err) {
    console.error("❌ Error toggling like:", err?.message || err);
    res.status(500).json({ message: "Failed to like/unlike" });
  }
});

/* ========================================================================== */
/* 💬 COMMENTS — Create & Fetch                                              */
/* ========================================================================== */

// ➕ Create a new comment
router.post("/:id/comments", requireAuth, async (req, res) => {
  try {
    const postId = req.params.id;
    const { text } = req.body;
    const user = req.user || {
      id: "foundation-admin",
      fullname: "Foundation Admin",
      avatar: "/default-avatar.png",
    };

    if (!text || !text.trim()) {
      return res.status(400).json({ message: "Comment text is required" });
    }

    const newComment = await Comment.create({
      postId,
      text,
      author: { fullname: user.fullname, avatar: user.avatar },
      userId: user.id,
      createdAt: new Date(),
    });

    console.log(`💬 New comment added by ${user.fullname} on post ${postId}`);
    res.status(201).json({ message: "Comment added", comment: newComment });
  } catch (err) {
    console.error("❌ Error creating comment:", err);
    res.status(500).json({ message: "Failed to add comment" });
  }
});

// 📖 Get all comments for a post
router.get("/:id/comments", async (req, res) => {
  try {
    const postId = req.params.id;
    const comments = await Comment.find({ postId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ comments });
  } catch (err) {
    console.error("❌ Error fetching comments:", err);
    res.status(500).json({ message: "Failed to fetch comments" });
  }
});

export default router;
