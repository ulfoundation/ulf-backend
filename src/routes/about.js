import express from "express";
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";
import About from "../models/About.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* ☁️ Cloudinary Storage (Multiple Banner Uploads - Auto Replace & Cleanup)   */
/* -------------------------------------------------------------------------- */
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "ulf_about",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ quality: "auto", fetch_format: "auto" }],
  },
});

// Allow up to 3 banner images
const upload = multer({
  storage,
  limits: { files: 3 },
});

/* -------------------------------------------------------------------------- */
/* 🧹 Helper — Extract Public ID from Cloudinary URL                          */
/* -------------------------------------------------------------------------- */
function extractPublicId(url) {
  try {
    const parts = url.split("/");
    const filename = parts.pop();
    const folder = parts.slice(parts.indexOf("ulf_about")).join("/");
    return folder
      ? `${folder}/${filename.split(".")[0]}`
      : filename.split(".")[0];
  } catch {
    return null;
  }
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

    res.json(about);
  } catch (err) {
    console.error("❌ Error fetching About content:", err);
    res.status(500).json({ message: "Server error fetching About content" });
  }
});

/* -------------------------------------------------------------------------- */
/* 🔸 PUT — Admin Only (Requires Auth)                                        */
/* -------------------------------------------------------------------------- */
router.put("/", requireAuth, upload.array("images", 3), async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Access denied — Admins only" });
    }

    const { content } = req.body;
    const uploadedImages = req.files?.map((file) => file.path) || [];

    let about = await About.findOne();

    // If About page does not exist, create new one
    if (!about) {
      about = new About({
        content,
        images: uploadedImages.slice(0, 3),
      });
    } else {
      // 🧹 Delete old Cloudinary images if new ones uploaded
      if (uploadedImages.length > 0 && about.images?.length > 0) {
        for (const imgUrl of about.images) {
          const publicId = extractPublicId(imgUrl);
          if (publicId) {
            try {
              await cloudinary.uploader.destroy(publicId);
              console.log(`🗑️ Deleted old image: ${publicId}`);
            } catch (delErr) {
              console.warn("⚠️ Failed to delete old image:", delErr.message);
            }
          }
        }
        // Replace with new images
        about.images = uploadedImages.slice(0, 3);
      }

      // Update text content if provided
      if (content && content.trim()) {
        about.content = content.trim();
      }
    }

    await about.save();
    res.json(about);
  } catch (err) {
    console.error("❌ Error updating About content:", err);
    res.status(500).json({ message: "Failed to update About content" });
  }
});

export default router;
