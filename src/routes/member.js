import express from "express";
import multer from "multer";
import fs from "fs/promises";
import { v2 as cloudinary } from "cloudinary";
import Member from "../models/Member.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* ☁️ Cloudinary Configuration (explicit)                                     */
/* -------------------------------------------------------------------------- */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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
import fsSync from "fs";
if (!fsSync.existsSync("temp_uploads")) {
  fsSync.mkdirSync("temp_uploads");
}

/* ========================================================================== */
/* 📋 GET — Fetch all members                                                 */
/* ========================================================================== */
router.get("/", async (req, res) => {
  try {
    const members = await Member.find().sort({ createdAt: -1 });
    res.json(members);
  } catch (err) {
    console.error("❌ Error fetching members:", err);
    res.status(500).json({ message: "Failed to fetch members" });
  }
});

/* ========================================================================== */
/* 📆 FILTER — Get members by registration date range                         */
/* ========================================================================== */
router.get("/filter", async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res
        .status(400)
        .json({ message: "Please provide both start and end dates (YYYY-MM-DD)" });
    }

    const members = await Member.find({
      dateOfRegistration: { $gte: start, $lte: end },
    }).sort({ dateOfRegistration: -1 });

    if (!members.length) {
      return res.json({
        message: `No members found between ${start} and ${end}`,
        members: [],
      });
    }

    res.json({
      message: `Found ${members.length} members registered between ${start} and ${end}`,
      count: members.length,
      members,
    });
  } catch (err) {
    console.error("❌ Error filtering members:", err);
    res.status(500).json({ message: "Failed to filter members" });
  }
});

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

    res.json({
      totalMembers: total,
      activeMembers: active,
      bannedMembers: banned,
      inactiveMembers: inactive,
      registeredThisMonth: monthly,
      dateRange: { startOfMonth, endOfMonth },
    });
  } catch (err) {
    console.error("❌ Error getting stats:", err);
    res.status(500).json({ message: "Failed to load member statistics" });
  }
});

/* ========================================================================== */
/* ➕ POST — Add a new member (with optional avatar)                           */
/* ========================================================================== */
router.post("/", upload.single("avatar"), async (req, res) => {
  try {
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

    // 🧾 Validation
    if (!name || !email || !phone) {
      return res.status(400).json({ message: "Name, email, and phone are required" });
    }

    // 🚫 Prevent duplicates
    const existing = await Member.findOne({ $or: [{ email }, { phone }] });
    if (existing) {
      return res.status(400).json({ message: "A member with this email or phone already exists" });
    }

    // ☁️ Upload avatar to Cloudinary if provided
    let avatarUrl = "https://res.cloudinary.com/demo/image/upload/v1720000000/default-avatar.png";

    if (req.file) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: "ulf_members",
          transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
        });
        avatarUrl = result.secure_url;
        await fs.unlink(req.file.path);
      } catch (uploadErr) {
        console.error("⚠️ Cloudinary upload failed:", uploadErr.message);
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
    console.log("✅ Member saved:", savedMember.name);
    res.status(201).json(savedMember);
  } catch (err) {
    console.error("❌ Error adding member:", err);
    res.status(500).json({ message: "Failed to add member" });
  }
});

/* ========================================================================== */
/* ✏️ PUT — Update Member (details or avatar)                                 */
/* ========================================================================== */
router.put("/:id", upload.single("avatar"), async (req, res) => {
  try {
    const updateData = { ...req.body };

    // ☁️ New avatar uploaded
    if (req.file) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: "ulf_members",
          transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
        });
        updateData.avatar = result.secure_url;
        await fs.unlink(req.file.path);
      } catch (uploadErr) {
        console.warn("⚠️ Avatar upload failed:", uploadErr.message);
      }
    }

    // Ensure registration date exists
    const existing = await Member.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Member not found" });

    if (!updateData.dateOfRegistration && !existing.dateOfRegistration) {
      updateData.dateOfRegistration = new Date().toISOString().split("T")[0];
    }

    Object.assign(existing, updateData);
    await existing.save();

    console.log("✏️ Member updated:", existing.name);
    res.json(existing);
  } catch (err) {
    console.error("❌ Error updating member:", err);
    res.status(500).json({ message: "Failed to update member" });
  }
});

/* ========================================================================== */
/* ❌ DELETE — Remove Member                                                  */
/* ========================================================================== */
router.delete("/:id", async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) return res.status(404).json({ message: "Member not found" });

    if (member.avatar && !member.avatar.includes("default-avatar.png")) {
      const publicId = member.avatar.split("/").slice(-1)[0].split(".")[0];
      try {
        await cloudinary.uploader.destroy(`ulf_members/${publicId}`);
      } catch (err) {
        console.warn("⚠️ Failed to delete avatar:", err.message);
      }
    }

    await member.deleteOne();
    console.log("🗑️ Member deleted:", member.name);
    res.json({ message: "Member deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting member:", err);
    res.status(500).json({ message: "Failed to delete member" });
  }
});

export default router;
