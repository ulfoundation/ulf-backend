import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { requireAuth } from "../middleware/auth.js";
import { ok, badRequest, serverError } from "../utils/respond.js";
import logger from "../utils/logger.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* 💾 Local Disk Storage — Team Photos                                        */
/* -------------------------------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const teamDir = path.resolve(__dirname, "../../client/uploads/team");
await fs.mkdir(teamDir, { recursive: true }).catch(() => {});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, teamDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]+/gi, "-");
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

/* -------------------------------------------------------------------------- */
/* 📤 POST /api/upload/team — Upload Team Photos                              */
/* -------------------------------------------------------------------------- */
router.post("/team", requireAuth, upload.single("image"), async (req, res) => {
  try {
    if (!req.file || !req.file.path) {
      return badRequest(res, "No image uploaded");
    }

    const url = `${req.protocol}://${req.get("host")}/uploads/team/${path.basename(req.file.path)}`;

    ok(res, { url });
  } catch (err) {
    logger.error("Upload failed", err);
    serverError(res, "Upload failed");
  }
});

export default router;
