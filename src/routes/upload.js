import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { UPLOADS_ROOT, getPublicBase, generateFilename } from "../utils/media.js";
import { uploadFileToFirebase } from "../utils/firebase.js";
import { requireAuth } from "../middleware/auth.js";
import { ok, badRequest, serverError } from "../utils/respond.js";
import logger from "../utils/logger.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* 💾 Local Disk Storage — Team Photos                                        */
/* -------------------------------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const teamDir = path.join(UPLOADS_ROOT, "team");
await fs.mkdir(teamDir, { recursive: true }).catch(() => {});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, teamDir),
  filename: (_req, file, cb) => cb(null, generateFilename(file.originalname)),
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
    const filename = path.basename(req.file.path);
    const dest = `team/${filename}`;
    const url = await uploadFileToFirebase(req.file.path, dest, req.file.mimetype, true);
    await fs.unlink(req.file.path).catch(() => {});
    ok(res, { url });
  } catch (err) {
    logger.error("Upload failed", err);
    serverError(res, "Upload failed");
  }
});

export default router;
