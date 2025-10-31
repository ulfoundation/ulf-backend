import express from "express";
import multer from "multer";
import fs from "fs/promises";
import cloudinary from "../config/cloudinary.js";
import Member from "../models/Member.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* ☁️ Multer setup (temporary local upload before Cloudinary) */
/* -------------------------------------------------------------------------- */
const upload = multer({
  dest: "temp_uploads/",
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
});

/* ========================================================================== */
/* 📋 GET — Fetch all members */
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
/* 📆 FILTER — Get members by registration date range */
/* ========================================================================== */
router.get("/filter", async (req, res) => {
  try {
    const { start, end } = req.query;

    if (!start || !end) {
      return res
        .status(400)
        .json({ message: "Please provide both start and end dates (YYYY-MM-DD)" });
    }

    // Convert strings to Date objects
    const startDate = new Date(start);
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999); // include entire end day

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
/* 📊 ANALYTICS — Member statistics summary */
/* ========================================================================== */
router.get("/stats", async (req, res) => {
  try {
    const total = await Member.countDocuments();
    const active = await Member.countDocuments({ status: "active" });
    const banned = await Member.countDocuments({ status: "banned" });
    const inactive = await Member.countDocuments({ status: "inactive" });

    // Get this month’s registrations
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
/* ➕ POST — Add a new member (with optional avatar) */
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

    // 🧾 Basic validation
    if (!name || !email || !phone) {
      return res
        .status(400)
        .json({ message: "Name, email, and phone are required" });
    }

    // 🚫 Prevent duplicates
    const existing = await Member.findOne({
      $or: [{ email }, { phone }],
    });
    if (existing) {
      return res
        .status(400)
        .json({ message: "A member with this email or phone already exists" });
    }

    // ☁️ Upload avatar if provided
    let avatarUrl =
      "https://res.cloudinary.com/demo/image/upload/v1720000000/default-avatar.png";

    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "ulf_members",
        transformation: [
          { width: 400, height: 400, crop: "fill", gravity: "face" },
        ],
      });
      avatarUrl = result.secure_url;
      await fs.unlink(req.file.path);
    }

    // 🗓️ Auto-set date of registration if not provided
    const today = new Date();
    const formattedDate = dateOfRegistration
      ? dateOfRegistration
      : today.toISOString().split("T")[0]; // yyyy-mm-dd

    // ✅ Create and save new member
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

    console.log("✅ New member added:", savedMember.name);
    res.status(201).json(savedMember);
  } catch (err) {
    console.error("❌ Error adding member:", err);
    res.status(500).json({ message: "Failed to add member" });
  }
});

/* ========================================================================== */
/* ✏️ PUT — Update Member (details or avatar) */
/* ========================================================================== */
router.put("/:id", upload.single("avatar"), async (req, res) => {
  try {
    let updateData = { ...req.body };

    // ☁️ If new avatar uploaded
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "ulf_members",
        transformation: [
          { width: 400, height: 400, crop: "fill", gravity: "face" },
        ],
      });
      updateData.avatar = result.secure_url;
      await fs.unlink(req.file.path);
    }

    // 🗓️ Ensure dateOfRegistration exists
    if (!updateData.dateOfRegistration) {
      const existing = await Member.findById(req.params.id);
      if (existing && !existing.dateOfRegistration) {
        updateData.dateOfRegistration = new Date()
          .toISOString()
          .split("T")[0];
      }
    }

    const updated = await Member.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      return res.status(404).json({ message: "Member not found" });
    }

    console.log("✏️ Member updated:", updated.name);
    res.json(updated);
  } catch (err) {
    console.error("❌ Error updating member:", err);
    res.status(500).json({ message: "Failed to update member" });
  }
});

/* ========================================================================== */
/* ❌ DELETE — Remove Member */
/* ========================================================================== */
router.delete("/:id", async (req, res) => {
  try {
    const deleted = await Member.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: "Member not found" });
    }

    console.log("🗑️ Member deleted:", deleted.name);
    res.json({ message: "Member deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting member:", err);
    res.status(500).json({ message: "Failed to delete member" });
  }
});

export default router;
