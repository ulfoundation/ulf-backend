import express from "express";
import Team from "../models/Team.js";
import { requireAuth } from "../middleware/auth.js";
import { body, validationResult } from "express-validator";
import { ok, badRequest, forbidden, notFound, serverError } from "../utils/respond.js";
import logger from "../utils/logger.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import https from "https";
import fsSync from "fs";

const router = express.Router();

// Local directory for team photos
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsRoot = path.resolve(__dirname, "../../client/uploads");
const teamDir = path.join(uploadsRoot, "team");
try { fsSync.mkdirSync(teamDir, { recursive: true }); } catch {}

function stableFilenameFromUrl(u) {
  try {
    const p = new URL(u).pathname;
    const base = path.basename(p);
    const ext = path.extname(base) || ".jpg";
    const name = base.replace(ext, "").replace(/[^a-z0-9_-]+/gi, "-");
    return `${name}${ext.toLowerCase()}`;
  } catch {
    const ext = path.extname(u) || ".jpg";
    const name = path.basename(u, ext).replace(/[^a-z0-9_-]+/gi, "-");
    return `${name}${ext}`;
  }
}

async function ensureLocalPhoto(src, baseUrl) {
  if (!src || typeof src !== "string") return src;
  if (!src.includes("cloudinary")) return src;
  const filename = stableFilenameFromUrl(src);
  const dest = path.join(teamDir, filename);
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
  return `${baseUrl}/uploads/team/${filename}`;
}

/* -------------------------------------------------------------------------- */
/* 🔹 GET — Public (Fetch all team members)                                   */
/* -------------------------------------------------------------------------- */
router.get("/", async (req, res) => {
  try {
    const team = await Team.find().sort({ createdAt: -1 });
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const out = [];
    for (const m of team) {
      let photo = m.photo;
      let changed = false;
      try {
        const local = await ensureLocalPhoto(photo, baseUrl);
        if (local !== photo) { photo = local; changed = true; }
      } catch {}
      if (changed) {
        Team.updateOne({ _id: m._id }, { $set: { photo } }).catch(() => {});
      }
      out.push({ ...m.toObject(), photo });
    }
    ok(res, { team: out });
  } catch (err) {
    logger.error("Error fetching team", err);
    serverError(res, "Server error fetching team");
  }
});

/* -------------------------------------------------------------------------- */
/* 🔸 POST — Admin Only (Add new team member)                                 */
/* -------------------------------------------------------------------------- */
router.post(
  "/",
  requireAuth,
  [
    body("name")
      .isString().withMessage("Name must be text")
      .trim()
      .isLength({ min: 2 }).withMessage("Name must be at least 2 characters"),
    body("title")
      .isString().withMessage("Title must be text")
      .trim()
      .isLength({ min: 2 }).withMessage("Title must be at least 2 characters"),
    body("email")
      .optional({ checkFalsy: true })
      .isEmail().withMessage("Email must be valid"),
    body("phone")
      .optional({ checkFalsy: true })
      .isString().withMessage("Phone must be text")
      .trim(),
    body("photo")
      .optional({ checkFalsy: true })
      .isString().withMessage("Photo must be a URL string")
      .trim(),
    body("bio")
      .optional({ checkFalsy: true })
      .isString().withMessage("Bio must be text"),
    body("facebook")
      .optional({ checkFalsy: true })
      .isString().withMessage("Facebook must be a URL string")
      .trim(),
    body("instagram")
      .optional({ checkFalsy: true })
      .isString().withMessage("Instagram must be a URL string")
      .trim(),
    body("linkedin")
      .optional({ checkFalsy: true })
      .isString().withMessage("LinkedIn must be a URL string")
      .trim(),
    body("twitter")
      .optional({ checkFalsy: true })
      .isString().withMessage("Twitter must be a URL string")
      .trim(),
  ],
  async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, errors.array());
    const userRole = req.user?.role;
    if (userRole !== "admin") {
      return forbidden(res, "Access denied — Admins only");
    }

    const {
      name,
      title,
      email,
      phone,
      photo, // ✅ must match frontend
      bio,
      facebook,
      instagram,
      linkedin,
      twitter,
    } = req.body;

    if (!name || !title) {
      return res.status(400).json({ message: "Name and title are required" });
    }

    const newMember = await Team.create({
      name,
      title,
      email,
      phone,
      photo, // ✅ must match frontend
      bio,
      facebook,
      instagram,
      linkedin,
      twitter,
    });

    ok(res, { member: newMember });
  } catch (err) {
    logger.error("Error adding team member", err);
    serverError(res, "Failed to add team member");
  }
}
);

/* -------------------------------------------------------------------------- */
/* ✏️ PUT — Admin Only (Update team member)                                  */
/* -------------------------------------------------------------------------- */
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (userRole !== "admin") {
      return forbidden(res, "Access denied — Admins only");
    }

    const updated = await Team.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!updated) return notFound(res, "Member not found");

    ok(res, { member: updated });
  } catch (err) {
    logger.error("Error updating team member", err);
    serverError(res, "Failed to update member");
  }
});

/* -------------------------------------------------------------------------- */
/* 🗑️ DELETE — Admin Only (Remove team member)                               */
/* -------------------------------------------------------------------------- */
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (userRole !== "admin") {
      return forbidden(res, "Access denied — Admins only");
    }

    const member = await Team.findByIdAndDelete(req.params.id);
    if (!member) {
      return notFound(res, "Member not found");
    }

    ok(res, { message: "Team member deleted successfully" });
  } catch (err) {
    logger.error("Error deleting team member", err);
    serverError(res, "Failed to delete member");
  }
});

export default router;
