import { Router } from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import crypto from "crypto";
import Post from "../models/Post.js";
import Comment from "../models/Comment.js";
import Like from "../models/Like.js";
import { requireAuth } from "../middleware/auth.js";
import { body, param, query, validationResult } from "express-validator";
import { ok, created, badRequest, forbidden, serverError } from "../utils/respond.js";
import rateLimit from "express-rate-limit";
import { UPLOADS_ROOT, getPublicBase, extractUploadsRel, generateFilename } from "../utils/media.js";
import logger from "../utils/logger.js";
import { uploadFileToFirebase, deleteFirebaseFile, gcsPathFromUrl } from "../utils/firebase.js";

const router = Router();

/* -------------------------------------------------------------------------- */
/* 🧩 Temporary local upload storage (before Cloudinary)                       */
/* -------------------------------------------------------------------------- */
const upload = multer({
  dest: "temp_uploads/",
  limits: { fileSize: 200 * 1024 * 1024, files: 10 }, // 200MB max
});

// Ensure local upload directories exist
import fsSync from "fs";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsRoot = UPLOADS_ROOT;
const postImagesDir = path.join(uploadsRoot, "posts", "images");
const postVideosDir = path.join(uploadsRoot, "posts", "videos");
const tempDir = path.join(process.cwd(), "temp_uploads");
for (const dir of [uploadsRoot, postImagesDir, postVideosDir, tempDir]) {
  try {
    fsSync.mkdirSync(dir, { recursive: true });
  } catch {}
}

function extFromUrl(u) {
  try {
    const p = new URL(u).pathname;
    const e = path.extname(p);
    if (e) return e.toLowerCase();
    return ".jpg";
  } catch {
    return ".jpg";
  }
}

function isVideoUrl(u) {
  try {
    const parsed = new URL(String(u));
    const pathname = decodeURIComponent(parsed.pathname || "");
    const ext = path.extname(pathname).toLowerCase();
    if (ext) return /(\.mp4|\.mov|\.webm|\.avi)/.test(ext);
  } catch {}
  const s = String(u).toLowerCase();
  return s.includes("/video/upload/") || /\.(mp4|mov|webm|avi)(?:$|[?#])/.test(s);
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
    const ext = extFromUrl(u);
    const base = path.basename(u, ext).replace(/[^a-z0-9_-]+/gi, "-");
    return `${base}${ext}`;
  }
}

async function ensureLocalMedia(src, baseUrl) {
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
      fetchWithRedirect(src);
    });
  }
  const url = `${baseUrl}/uploads/posts/${video ? "videos" : "images"}/${filename}`;
  return { full: url, thumb: url, type: video ? "video" : "image" };
}

const extractLocalRelative = extractUploadsRel;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function isRelUsedByOtherPosts(rel, excludeId) {
  try {
    const pattern = new RegExp(`/uploads/${escapeRegex(rel)}$`);
    const count = await Post.countDocuments({
      _id: { $ne: excludeId },
      $or: [
        { "imageUrls.full": { $regex: pattern } },
        { "imageUrls.thumb": { $regex: pattern } },
        // legacy string entries
        { imageUrls: { $elemMatch: { $regex: pattern } } },
      ],
    });
    return count > 0;
  } catch {
    return true;
  }
}

async function isUrlUsedByOtherPosts(url, excludeId) {
  try {
    const count = await Post.countDocuments({
      _id: { $ne: excludeId },
      $or: [
        { "imageUrls.full": url },
        { "imageUrls.thumb": url },
        { imageUrls: { $elemMatch: { $eq: url } } },
      ],
    });
    return count > 0;
  } catch {
    return true;
  }
}

function getVisitorId(req) {
  const ip = (req.headers["x-forwarded-for"]?.split(",")[0] || req.ip || "").toString();
  const ua = (req.get("user-agent") || "").toString();
  const raw = `${ip}|${ua}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

// Using getPublicBase from utils

const idKey = (req) => req.user?.id || getVisitorId(req);
const likeLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: idKey });
const commentLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: idKey });

/* ========================================================================== */
/* 📝 CREATE NEW POST — Admin Only (auto dev fallback)                         */
/* ========================================================================== */
router.post(
  "/",
  requireAuth,
  upload.fields([
    { name: "images", maxCount: 10 },
    { name: "media", maxCount: 10 },
  ]),
  [body("content").optional().isString()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return badRequest(res, errors.array());
      const { content } = req.body;
      const user = req.user;

      // ✅ Restrict post creation to admins only
      if (user.role !== "admin") {
        return forbidden(res, "Access denied — only admins can create posts");
      }

      const incomingFiles = [
        ...(Array.isArray(req.files?.images) ? req.files.images : []),
        ...(Array.isArray(req.files?.media) ? req.files.media : []),
      ];

      const rawUrls = req.body.mediaUrls || req.body.imageUrls;
      let incomingUrls = [];
      if (typeof rawUrls === "string") {
        try {
          const parsed = JSON.parse(rawUrls);
          if (Array.isArray(parsed)) incomingUrls = parsed;
        } catch {
          incomingUrls = rawUrls.split(",").map((s) => s.trim()).filter(Boolean);
        }
      } else if (Array.isArray(rawUrls)) {
        incomingUrls = rawUrls.filter((u) => typeof u === "string");
      }

      if (!content && incomingFiles.length === 0 && incomingUrls.length === 0) {
        return badRequest(res, "Post must include text or media");
      }

      const media = [];

      for (const file of incomingFiles) {
        const isVideo = file.mimetype.startsWith("video/");
        const filename = generateFilename(file.originalname);
        const dest = `posts/${isVideo ? "videos" : "images"}/${filename}`;
        try {
          const url = await uploadFileToFirebase(file.path, dest, file.mimetype, true);
          await fs.unlink(file.path).catch(() => {});
          media.push({ full: url, thumb: url, type: isVideo ? "video" : "image" });
          logger.info("Saved media to Firebase", { url });
        } catch (err) {
          logger.error("Firebase save error", err);
          await fs.unlink(file.path).catch(() => {});
          throw err;
        }
      }

      for (const url of incomingUrls) {
        const type = isVideoUrl(url) ? "video" : "image";
        media.push({ full: url, thumb: url, type });
      }

      const newPost = new Post({
        content,
        imageUrls: media,
        member: { fullname: user.fullname, avatar: user.avatar },
        userId: user.id,
        likes: [],
      });

      await newPost.save();
      logger.info("Post created successfully", { id: newPost._id });

      created(res, { message: "Post created successfully", post: newPost });
    } catch (err) {
      logger.error("Fatal error creating post", err);
      serverError(res, err?.message || "Failed to create post");
    }
  }
);

/* ========================================================================== */
/* 📬 FETCH ALL POSTS — With Pagination Support                               */
/* ========================================================================== */
router.get(
  "/",
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, errors.array());
    const userId = req.user?.id || getVisitorId(req);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const posts = await Post.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const baseUrl = getPublicBase(req);
    const enriched = await Promise.all(
      posts.map(async (p) => {
        const [commentsCount, likesCount, userLiked, latestComments] = await Promise.all([
          Comment.countDocuments({ postId: p._id }),
          Like.countDocuments({ postId: p._id }),
          Like.exists({ postId: p._id, userId }),
          Comment.find({ postId: p._id })
            .sort({ createdAt: -1 })
            .limit(3)
            .select({ text: 1, author: 1, createdAt: 1 })
            .lean(),
        ]);
      const media = Array.isArray(p.imageUrls) ? p.imageUrls : [];
      let changed = false;
      const mappedMedia = await Promise.all(
        media.map(async (m) => {
          const src = typeof m === "string" ? m : m?.full || m?.thumb;
          if (typeof src === "string" && src.includes("cloudinary")) {
            try {
              const local = await ensureLocalMedia(src, baseUrl);
              changed = true;
              return local;
            } catch {
              return typeof m === "string" ? { full: src, thumb: src } : m;
            }
          }
          const rel = extractLocalRelative(src);
          if (rel) {
            const url = `${baseUrl}/uploads/${rel}`;
            changed = true;
            return { full: url, thumb: url };
          }
          return typeof m === "string" ? { full: src, thumb: src } : m;
        })
      );
      if (changed) {
        Post.updateOne({ _id: p._id }, { $set: { imageUrls: mappedMedia } }).catch(() => {});
      }
        return { ...p, imageUrls: mappedMedia, commentsCount, likesCount, liked: !!userLiked, latestComments };
      })
    );

    ok(res, { posts: enriched });
  } catch (err) {
    logger.error("Error fetching posts", err?.message || err);
    serverError(res, "Failed to fetch posts");
  }
}
);

// Recent comments across posts for admin notifications
router.get(
  "/comments/recent",
  requireAuth,
  [query("limit").optional().isInt({ min: 1, max: 100 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return badRequest(res, errors.array());
      const user = req.user;
      if (user.role !== "admin") return forbidden(res, "Access denied");
      const limit = parseInt(req.query.limit) || 20;
      const comments = await Comment.find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .select({ postId: 1, text: 1, createdAt: 1 })
        .lean();
      ok(res, { comments });
    } catch (err) {
      logger.error("Error fetching recent comments", err);
      serverError(res, "Failed to fetch recent comments");
    }
  }
);

// Fetch single post by id
router.get(
  "/:id",
  [param("id").isString()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return badRequest(res, errors.array());
      const post = await Post.findById(req.params.id).lean();
      if (!post) return badRequest(res, "Post not found");
      const baseUrl = getPublicBase(req);
      const media = Array.isArray(post.imageUrls) ? post.imageUrls : [];
      const mappedMedia = await Promise.all(
        media.map(async (m) => {
          const src = typeof m === "string" ? m : m?.full || m?.thumb;
          if (typeof src === "string" && src.includes("cloudinary")) {
            try {
              return await ensureLocalMedia(src, baseUrl);
            } catch {
              return typeof m === "string" ? { full: src, thumb: src } : m;
            }
          }
          const rel = extractLocalRelative(src);
          if (rel) {
            const url = `${baseUrl}/uploads/${rel}`;
            return { full: url, thumb: url };
          }
          return typeof m === "string" ? { full: src, thumb: src } : m;
        })
      );
      ok(res, { post: { ...post, imageUrls: mappedMedia } });
    } catch (err) {
      logger.error("Error fetching post", err);
      serverError(res, "Failed to fetch post");
    }
  }
);

router.put(
  "/:id",
  requireAuth,
  upload.fields([
    { name: "images", maxCount: 10 },
    { name: "media", maxCount: 10 },
  ]),
  [param("id").isString(), body("content").optional().isString()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return badRequest(res, errors.array());
      const user = req.user;
      if (user.role !== "admin") return forbidden(res, "Access denied — only admins can update posts");
      const postId = req.params.id;
      const post = await Post.findById(postId);
      if (!post) return badRequest(res, "Post not found");

      const removeMedia = Array.isArray(req.body.removeMedia)
        ? req.body.removeMedia
        : typeof req.body.removeMedia === "string"
        ? req.body.removeMedia.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

      const incomingFiles = [
        ...(Array.isArray(req.files?.images) ? req.files.images : []),
        ...(Array.isArray(req.files?.media) ? req.files.media : []),
      ];
      const rawUrls = req.body.mediaUrls || req.body.imageUrls;
      let incomingUrls = [];
      if (typeof rawUrls === "string") {
        try {
          const parsed = JSON.parse(rawUrls);
          if (Array.isArray(parsed)) incomingUrls = parsed;
        } catch {
          incomingUrls = rawUrls.split(",").map((s) => s.trim()).filter(Boolean);
        }
      } else if (Array.isArray(rawUrls)) {
        incomingUrls = rawUrls.filter((u) => typeof u === "string");
      }

      let media = Array.isArray(post.imageUrls) ? [...post.imageUrls] : [];
      if (removeMedia.length > 0) {
        const keep = [];
        for (const m of media) {
          const src = typeof m === "string" ? m : m.full || m.thumb;
          if (removeMedia.includes(src)) {
            // Do not delete physical files on update; only remove the reference
            continue;
          }
          keep.push(m);
        }
        media = keep;
      }

      for (const file of incomingFiles) {
        const isVideo = file.mimetype.startsWith("video/");
        const filename = generateFilename(file.originalname);
        const dest = `posts/${isVideo ? "videos" : "images"}/${filename}`;
        try {
          const url = await uploadFileToFirebase(file.path, dest, file.mimetype, true);
          await fs.unlink(file.path).catch(() => {});
          media.push({ full: url, thumb: url, type: isVideo ? "video" : "image" });
        } catch (err) {
          await fs.unlink(file.path).catch(() => {});
          return serverError(res, `Failed to save media: ${err?.message || "unknown error"}`);
        }
      }

      for (const url of incomingUrls) {
        const type = isVideoUrl(url) ? "video" : "image";
        media.push({ full: url, thumb: url, type });
      }

      if (typeof req.body.content === "string") {
        post.content = req.body.content;
      }
      post.imageUrls = media;
      await post.save();
      ok(res, { message: "Post updated", post });
    } catch (err) {
      logger.error("Error updating post", err);
      serverError(res, "Failed to update post");
    }
  }
);

router.delete(
  "/:id",
  requireAuth,
  [param("id").isString()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return badRequest(res, errors.array());
      const user = req.user;
      if (user.role !== "admin") return forbidden(res, "Access denied — only admins can delete posts");

      const post = await Post.findById(req.params.id);
      if (!post) return badRequest(res, "Post not found");

      const media = Array.isArray(post.imageUrls) ? post.imageUrls : [];
      for (const m of media) {
        const src = typeof m === "string" ? m : m.full || m.thumb;
        if (typeof src === "string") {
          if (src.includes("/uploads/")) {
            const rel = extractLocalRelative(src);
            if (!rel) continue;
            const filePath = path.join(uploadsRoot, rel);
            const usedElsewhere = await isRelUsedByOtherPosts(rel, post._id);
            if (!usedElsewhere) await fs.unlink(filePath).catch(() => {});
          } else if (src.includes("storage.googleapis.com")) {
            const usedElsewhere = await isUrlUsedByOtherPosts(src, post._id);
            const gcs = gcsPathFromUrl(src);
            if (gcs && !usedElsewhere) await deleteFirebaseFile(gcs).catch(() => {});
          }
        }
      }

      await Comment.deleteMany({ postId: post._id });
      await Like.deleteMany({ postId: post._id });
      await post.deleteOne();

      ok(res, { message: "Post deleted" });
    } catch (err) {
      logger.error("Error deleting post", err);
      serverError(res, "Failed to delete post");
    }
  }
);

/* ========================================================================== */
/* ❤️ LIKE / UNLIKE POST                                                     */
/* ========================================================================== */
router.post(
  "/:id/like",
  likeLimiter,
  [param("id").isString()],
  async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, errors.array());
    const userId = req.user?.id || getVisitorId(req);
    const postId = req.params.id;

    const existingLike = await Like.findOne({ postId, userId });
    if (existingLike) {
      await Like.deleteOne({ _id: existingLike._id });
    } else {
      await Like.create({ postId, userId });
    }

    const likesCount = await Like.countDocuments({ postId });
    ok(res, { liked: !existingLike, likesCount });
  } catch (err) {
    logger.error("Error toggling like", err?.message || err);
    serverError(res, "Failed to like/unlike");
  }
}
);

/* ========================================================================== */
/* 💬 COMMENTS — Create & Fetch                                              */
/* ========================================================================== */

// ➕ Create a new comment
router.post(
  "/:id/comments",
  commentLimiter,
  [param("id").isString(), body("text").isString().trim().isLength({ min: 1 })],
  async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, errors.array());
    const postId = req.params.id;
    const { text } = req.body;
    const ownerId = req.user?.id || getVisitorId(req);
    const user = req.user || {
      id: ownerId,
      fullname: (typeof req.body.name === "string" && req.body.name.trim()) || "Visitor",
      avatar: "/default-avatar.png",
    };

    const newComment = await Comment.create({
      postId,
      text,
      author: { fullname: user.fullname, avatar: user.avatar },
      ownerId: ownerId,
    });

    logger.info("New comment added", { by: user.fullname, postId });
    created(res, { message: "Comment added", comment: newComment });
  } catch (err) {
    logger.error("Error creating comment", err);
    serverError(res, "Failed to add comment");
  }
}
);

// 📖 Get all comments for a post
router.get(
  "/:id/comments",
  [param("id").isString()],
  async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, errors.array());
    const postId = req.params.id;
    const visitorId = req.user?.id || getVisitorId(req);
    const comments = await Comment.find({ postId })
      .sort({ createdAt: -1 })
      .lean();
    const withFlags = comments.map((c) => ({
      ...c,
      canEdit: c.ownerId && c.ownerId === visitorId,
    }));
    ok(res, { comments: withFlags });
  } catch (err) {
    logger.error("Error fetching comments", err);
    serverError(res, "Failed to fetch comments");
  }
}
);

router.put(
  "/:id/comments/:commentId",
  commentLimiter,
  [param("id").isString(), param("commentId").isString(), body("text").isString().trim().isLength({ min: 1 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return badRequest(res, errors.array());
      const postId = req.params.id;
      const commentId = req.params.commentId;
      const visitorId = req.user?.id || getVisitorId(req);
      const comment = await Comment.findOne({ _id: commentId, postId });
      if (!comment) return badRequest(res, "Comment not found");
      if (comment.ownerId !== visitorId) return forbidden(res, "Not allowed");
      comment.text = req.body.text;
      await comment.save();
      ok(res, { message: "Comment updated", comment });
    } catch (err) {
      logger.error("Error updating comment", err);
      serverError(res, "Failed to update comment");
    }
  }
);

router.delete(
  "/:id/comments/:commentId",
  commentLimiter,
  [param("id").isString(), param("commentId").isString()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return badRequest(res, errors.array());
      const postId = req.params.id;
      const commentId = req.params.commentId;
      const visitorId = req.user?.id || getVisitorId(req);
      const comment = await Comment.findOne({ _id: commentId, postId });
      if (!comment) return badRequest(res, "Comment not found");
      if (comment.ownerId !== visitorId) return forbidden(res, "Not allowed");
      await Comment.deleteOne({ _id: commentId });
      ok(res, { message: "Comment deleted" });
    } catch (err) {
      logger.error("Error deleting comment", err);
      serverError(res, "Failed to delete comment");
    }
  }
)

export default router;
