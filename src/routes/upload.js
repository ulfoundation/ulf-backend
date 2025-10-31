import express from "express";
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* 📸 Cloudinary Storage — Smart Transformations                              */
/* -------------------------------------------------------------------------- */
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "ulf_team", // Folder name in Cloudinary
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      {
        width: 500,
        height: 500,
        crop: "fill",
        gravity: "face", // Focuses automatically on the face
        quality: "auto",
        fetch_format: "auto",
        dpr: "auto",
      },
    ],
    eager: [
      {
        width: 250,
        height: 250,
        crop: "fill",
        gravity: "face",
        quality: "auto",
        fetch_format: "auto",
      },
    ],
  },
});

const upload = multer({ storage });

/* -------------------------------------------------------------------------- */
/* 📤 POST /api/upload/team — Upload Team Photos                              */
/* -------------------------------------------------------------------------- */
router.post("/team", requireAuth, upload.single("image"), async (req, res) => {
  try {
    if (!req.file || !req.file.path) {
      return res.status(400).json({ message: "No image uploaded" });
    }

    // Create an optimized image URL using Cloudinary’s automatic format & quality
    const optimizedUrl = req.file.path.replace(
      "/upload/",
      "/upload/f_auto,q_auto,w_500,h_500,c_fill,g_face/"
    );

    res.json({ url: optimizedUrl });
  } catch (err) {
    console.error("❌ Upload failed:", err);
    res.status(500).json({
      message: "Upload failed",
      error: err.message,
    });
  }
});

export default router;
