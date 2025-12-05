import express from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Member from "../models/Member.js";
import { ok, badRequest, notFound, serverError } from "../utils/respond.js";
import logger from "../utils/logger.js";
import { UPLOADS_ROOT, getPublicBase, generateFilename, extractUploadsRel } from "../utils/media.js";
import { body, param, query, validationResult } from "express-validator";
import https from "https";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* 💾 Local storage directories                                               */
/* -------------------------------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const avatarsDir = path.join(UPLOADS_ROOT, "members");
import fsSync from "fs";
fsSync.mkdirSync(avatarsDir, { recursive: true });

/* -------------------------------------------------------------------------- */
/* 📦 Multer setup (temporary local upload before Cloudinary)                 */
/* -------------------------------------------------------------------------- */
const upload = multer({
  dest: "temp_uploads/",
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
});

/* -------------------------------------------------------------------------- */
/* 🧱 Ensure temp_uploads exists (important for Render/Linux)                  */
/* -------------------------------------------------------------------------- */
if (!fsSync.existsSync("temp_uploads")) {
  fsSync.mkdirSync("temp_uploads");
}

/* ========================================================================== */
/* 📋 GET — Fetch all members                                                 */
/* ========================================================================== */
router.get("/", async (req, res) => {
  try {
    const members = await Member.find().sort({ createdAt: -1 });
    const baseUrl = getPublicBase(req);
    const out = [];
    for (const m of members) {
      let avatar = m.avatar;
      let changed = false;
      try {
        const local = await ensureLocalAvatar(avatar, baseUrl);
        if (local !== avatar) { avatar = local; changed = true; }
      } catch {}
      if (changed) {
        Member.updateOne({ _id: m._id }, { $set: { avatar } }).catch(() => {});
      }
      out.push({ ...m.toObject(), avatar });
    }
    ok(res, { members: out });
  } catch (err) {
    logger.error("Error fetching members", err);
    serverError(res, "Failed to fetch members");
  }
});

/* ========================================================================== */
/* 📆 FILTER — Get members by registration date range                         */
/* ========================================================================== */
router.get(
  "/filter",
  [query("start").isISO8601(), query("end").isISO8601()],
  async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, errors.array());
    const { start, end } = req.query;

    const members = await Member.find({
      dateOfRegistration: { $gte: start, $lte: end },
    }).sort({ dateOfRegistration: -1 });

    if (!members.length) {
      return ok(res, { message: `No members found between ${start} and ${end}`, members: [] });
    }

    ok(res, {
      message: `Found ${members.length} members registered between ${start} and ${end}`,
      count: members.length,
      members,
    });
  } catch (err) {
    logger.error("Error filtering members", err);
    serverError(res, "Failed to filter members");
  }
}
);

/* ========================================================================== */
/* 📊 ANALYTICS — Member statistics summary                                   */
/* ========================================================================== */
router.get("/stats", async (req, res) => {
  try {
    const total = await Member.countDocuments();
    const active = await Member.countDocuments({ status: "active" });
    const banned = await Member.countDocuments({ status: "banned" });
    const inactive = await Member.countDocuments({ status: "inactive" });

    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .split("T")[0];
    const endOfMonth = new Date().toISOString().split("T")[0];

    const monthly = await Member.countDocuments({
      dateOfRegistration: { $gte: startOfMonth, $lte: endOfMonth },
    });

    ok(res, {
      totalMembers: total,
      activeMembers: active,
      bannedMembers: banned,
      inactiveMembers: inactive,
      registeredThisMonth: monthly,
      dateRange: { startOfMonth, endOfMonth },
    });
  } catch (err) {
    logger.error("Error getting stats", err);
    serverError(res, "Failed to load member statistics");
  }
});

/* ========================================================================== */
/* ➕ POST — Add a new member (with optional avatar)                           */
/* ========================================================================== */
router.post(
  "/",
  upload.single("avatar"),
  [
    body("name").isString().trim().isLength({ min: 2 }),
    body("email").isEmail(),
    body("phone").isString().trim().isLength({ min: 7 }),
    body("dateOfRegistration").optional().isISO8601(),
  ],
  async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, errors.array());
    const {
      name,
      role,
      email,
      phone,
      address,
      lga,
      state,
      nationality,
      maritalStatus,
      dateOfBirth,
      occupation,
      educationLevel,
      skills,
      healthStatus,
      numberOfDependents,
      supportNeeded,
      status,
      dateOfRegistration,
    } = req.body;

    // 🚫 Prevent duplicates
    const existing = await Member.findOne({ $or: [{ email }, { phone }] });
    if (existing) {
      return badRequest(res, "A member with this email or phone already exists");
    }

    // 💾 Save avatar locally if provided
    let avatarUrl = "";
    if (req.file) {
      try {
        const filename = generateFilename(req.file.originalname);
        const targetPath = path.join(avatarsDir, filename);
        await fs.rename(req.file.path, targetPath);
        avatarUrl = `${getPublicBase(req)}/uploads/members/${filename}`;
      } catch (uploadErr) {
        logger.error("Local avatar save failed", { message: uploadErr.message });
        await fs.unlink(req.file.path).catch(() => {});
      }
    }

    // 🗓️ Registration date
    const today = new Date().toISOString().split("T")[0];
    const formattedDate = dateOfRegistration || today;

    // ✅ Save member
    const newMember = new Member({
      name,
      role: role || "Member",
      email,
      phone,
      address,
      lga,
      state,
      nationality,
      maritalStatus,
      dateOfBirth,
      occupation,
      educationLevel,
      skills,
      healthStatus,
      numberOfDependents,
      supportNeeded,
      avatar: avatarUrl,
      status: status || "active",
      dateOfRegistration: formattedDate,
    });

    const savedMember = await newMember.save();
    logger.info("Member saved", { name: savedMember.name });
    return ok(res, { member: savedMember });
  } catch (err) {
    logger.error("Error adding member", err);
    serverError(res, "Failed to add member");
  }
}
);

/* ========================================================================== */
/* ✏️ PUT — Update Member (details or avatar)                                 */
/* ========================================================================== */
router.put(
  "/:id",
  upload.single("avatar"),
  [param("id").isString()],
  async (req, res) => {
  try {
    const updateData = { ...req.body };
  
    // 💾 New avatar uploaded
    if (req.file) {
      try {
        const filename = generateFilename(req.file.originalname);
        const targetPath = path.join(avatarsDir, filename);
        await fs.rename(req.file.path, targetPath);
        updateData.avatar = `${getPublicBase(req)}/uploads/members/${filename}`;
      } catch (uploadErr) {
        logger.warn("Avatar save failed", { message: uploadErr.message });
        await fs.unlink(req.file.path).catch(() => {});
      }
    }

    // Ensure registration date exists
    const existing = await Member.findById(req.params.id);
    if (!existing) return notFound(res, "Member not found");

    if (!updateData.dateOfRegistration && !existing.dateOfRegistration) {
      updateData.dateOfRegistration = new Date().toISOString().split("T")[0];
    }

    Object.assign(existing, updateData);
    await existing.save();

    logger.info("Member updated", { name: existing.name });
    ok(res, { member: existing });
  } catch (err) {
    logger.error("Error updating member", err);
    serverError(res, "Failed to update member");
  }
}
);

/* ========================================================================== */
/* ❌ DELETE — Remove Member                                                  */
/* ========================================================================== */
router.delete(
  "/:id",
  [param("id").isString()],
  async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) return notFound(res, "Member not found");

    if (member.avatar && member.avatar.includes("/uploads/")) {
      const rel = extractUploadsRel(member.avatar);
      const filePath = path.join(UPLOADS_ROOT, rel);
      await fs.unlink(filePath).catch(() => {});
    }

    await member.deleteOne();
    logger.info("Member deleted", { name: member.name });
    ok(res, { message: "Member deleted successfully" });
  } catch (err) {
    logger.error("Error deleting member", err);
    serverError(res, "Failed to delete member");
  }
}
);

export default router;
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

async function ensureLocalAvatar(src, baseUrl) {
  if (!src || typeof src !== "string") return src;
  if (!src.includes("cloudinary")) return src;
  const filename = stableFilenameFromUrl(src);
  const dest = path.join(avatarsDir, filename);
  try { await fs.access(dest); } catch {
    await new Promise((resolve, reject) => {
      const file = fsSync.createWriteStream(dest);
      const fetchWithRedirect = (url, redirectsLeft = 3) => {
        https.get(url, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
            const next = res.headers.location.startsWith("http") ? res.headers.location : new URL(res.headers.location, url).toString();
            return fetchWithRedirect(next, redirectsLeft - 1);
          }
          if (res.statusCode !== 200) {
            file.close();
            fsSync.unlink(dest, () => {});
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          res.pipe(file);
          file.on("finish", () => file.close(resolve));
        }).on("error", (err) => {
          file.close();
          fsSync.unlink(dest, () => {});
          reject(err);
        });
      };
      fetchWithRedirect(src);
    });
  }
  return `${baseUrl}/uploads/members/${filename}`;
}
