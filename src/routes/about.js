import express from "express";
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import { v2 as cloudinary } from "cloudinary";
import About from "../models/About.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* ☁️ CLOUDINARY CONFIGURATION (ensures multer uses the correct credentials)  */
/* -------------------------------------------------------------------------- */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/* -------------------------------------------------------------------------- */
/* ☁️ MULTER CLOUDINARY STORAGE (supports up to 3 banners)                    */
/* -------------------------------------------------------------------------- */
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "ulf_about",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ width: 1600, height: 800, crop: "fill", quality: "auto" }],
  },
});

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
    const uploadedImages = req.files?.map((file) => file.path) || [];

    console.log("📸 Uploaded images:", uploadedImages);

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
        about.images = uploadedImages.slice(0, 3);
      }

      // 📝 Update text content
      if (content && content.trim()) {
        about.content = content.trim();
      }
    }

    await about.save();

    const validImages = (about.images || []).filter(
      (url) => typeof url === "string" && url.startsWith("http")
    );

    console.log("✅ About page updated successfully:", validImages);

    res.json({
      message: "✅ About page updated successfully!",
      content: about.content,
      images: validImages,
    });
  } catch (err) {
    console.error("❌ Error updating About content:", err);
    res.status(500).json({ message: "Failed to update About content" });
  }
});

export default router;
