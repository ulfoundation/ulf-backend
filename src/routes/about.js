import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import About from "../models/About.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* 💾 Local Disk Storage for About images                                     */
/* -------------------------------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const aboutDir = path.resolve(__dirname, "../../client/uploads/about");
import fsSync from "fs";
fsSync.mkdirSync(aboutDir, { recursive: true });

/* -------------------------------------------------------------------------- */
/* 📦 Multer disk storage (supports up to 3 banners)                          */
/* -------------------------------------------------------------------------- */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, aboutDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]+/gi, "-");
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});

const upload = multer({ storage, limits: { files: 3, fileSize: 10 * 1024 * 1024 } });

/* -------------------------------------------------------------------------- */
/* 🧹 Helper — Extract Public ID from Cloudinary URL                          */
/* -------------------------------------------------------------------------- */
function extractLocalRelative(url) {
  const idx = url.indexOf("/uploads/");
  if (idx === -1) return null;
  return url.slice(idx + "/uploads/".length);
}

/* -------------------------------------------------------------------------- */
/* 🔹 GET — Public Access                                                     */
/* -------------------------------------------------------------------------- */
router.get("/", async (req, res) => {
  try {
    let about = await About.findOne();

    // If none exists, create a starter document
    if (!about) {
      about = await About.create({
        content:
          "Welcome to United Link Foundation. Our mission is to empower widows, orphans, and persons with disabilities.",
        images: [],
      });
    }

    const validImages = (about.images || []).filter(
      (url) => typeof url === "string" && url.startsWith("http")
    );

    res.json({
      content: about.content,
      images: validImages,
    });
  } catch (err) {
    console.error("❌ Error fetching About content:", err);
    res.status(500).json({ message: "Server error fetching About content" });
  }
});

/* -------------------------------------------------------------------------- */
/* 🔸 PUT — Admin Only (Requires Auth + Upload Images to Cloudinary)          */
/* -------------------------------------------------------------------------- */
router.put("/", requireAuth, upload.array("images", 3), async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Access denied — Admins only" });
    }

    const { content } = req.body;
    const uploadedImages = (req.files || []).map((file) =>
      `${req.protocol}://${req.get("host")}/uploads/about/${path.basename(file.path)}`
    );

    let about = await About.findOne();

    // If About page does not exist, create new one
    if (!about) {
      about = new About({
        content,
        images: uploadedImages.slice(0, 3),
      });
    } else {
      // 🧹 Replace images if new ones provided
      if (uploadedImages.length > 0) {
        // delete old local images if present
        if (about.images?.length > 0) {
          for (const imgUrl of about.images) {
            const rel = extractLocalRelative(imgUrl);
            if (!rel) continue;
            const filePath = path.join(path.resolve(__dirname, "../../client/uploads"), rel);
            await fs.unlink(filePath).catch(() => {});
          }
        }
        about.images = uploadedImages.slice(0, 3);
      }

      // 📝 Update text content
      if (content && content.trim()) {
        about.content = content.trim();
      }
    }

    await about.save();

    const imagesOut = (about.images || []).filter((url) => typeof url === "string");

    res.json({
      message: "✅ About page updated successfully!",
      content: about.content,
      images: imagesOut,
    });
  } catch (err) {
    console.error("❌ Error updating About content:", err);
    res.status(500).json({ message: "Failed to update About content" });
  }
});

export default router;
