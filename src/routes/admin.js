import { Router } from "express";
import User from "../models/User.js";
import Post from "../models/Post.js";
import Donation from "../models/Donation.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import bcrypt from "bcryptjs";

const router = Router();

// ✅ All routes below require authenticated admin
router.use(requireAuth, requireAdmin);

/* -------------------------------------------------------------------------- */
/* 👥 Register Members (bulk)                                                 */
/* -------------------------------------------------------------------------- */
router.post("/members", async (req, res) => {
  try {
    const { members } = req.body; // [{ fullname, email, password }]
    if (!Array.isArray(members)) {
      return res.status(400).json({ error: "members must be an array" });
    }

    const created = [];

    for (const m of members) {
      if (!m.fullname || !m.email) continue;

      const existing = await User.findOne({ email: m.email });
      if (existing) continue;

      const passwordHash = await bcrypt.hash(m.password || "password123", 10);
      const user = await User.create({
        fullname: m.fullname,
        email: m.email,
        passwordHash,
        role: "member",
      });

      created.push({
        id: user._id,
        email: user.email,
        fullname: user.fullname,
      });
    }

    res.json({
      success: true,
      message: `${created.length} member(s) registered successfully.`,
      created,
    });
  } catch (err) {
    console.error("❌ Error registering members:", err);
    res.status(500).json({ error: "Failed to register members" });
  }
});

/* -------------------------------------------------------------------------- */
/* 🧾 Get All Members                                                         */
/* -------------------------------------------------------------------------- */
router.get("/members", async (_req, res) => {
  try {
    const members = await User.find({ role: "member" })
      .select("fullname email role createdAt isActive")
      .sort({ createdAt: -1 });
    res.json({ success: true, members });
  } catch (err) {
    console.error("❌ Error fetching members:", err);
    res.status(500).json({ error: "Failed to fetch members" });
  }
});

/* -------------------------------------------------------------------------- */
/* 🔄 Toggle Member Active/Inactive                                           */
/* -------------------------------------------------------------------------- */
router.patch("/members/:id/toggle", async (req, res) => {
  try {
    const member = await User.findById(req.params.id);
    if (!member) return res.status(404).json({ error: "Member not found" });

    member.isActive = !member.isActive;
    await member.save();

    res.json({
      success: true,
      message: `Member ${member.isActive ? "activated" : "deactivated"} successfully.`,
      member,
    });
  } catch (err) {
    console.error("❌ Error toggling member:", err);
    res.status(500).json({ error: "Failed to update member status" });
  }
});

/* -------------------------------------------------------------------------- */
/* ❌ Delete Member                                                           */
/* -------------------------------------------------------------------------- */
router.delete("/members/:id", async (req, res) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Member not found" });

    res.json({ success: true, message: "Member deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting member:", err);
    res.status(500).json({ error: "Failed to delete member" });
  }
});

/* -------------------------------------------------------------------------- */
/* 📝 Create Post Assigned to a Member                                        */
/* -------------------------------------------------------------------------- */
router.post("/posts", async (req, res) => {
  try {
    const { title, content, imageUrl, memberId } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: "Title and content are required" });
    }

    const post = await Post.create({
      title,
      content,
      imageUrl,
      memberId,
      createdAt: new Date(),
    });

    res.json({ success: true, post });
  } catch (err) {
    console.error("❌ Error creating post:", err);
    res.status(500).json({ error: "Failed to create post" });
  }
});

/* -------------------------------------------------------------------------- */
/* 💰 Simple Donation Analytics                                              */
/* -------------------------------------------------------------------------- */
router.get("/stats/donations", async (_req, res) => {
  try {
    const byMember = await Donation.aggregate([
      {
        $group: {
          _id: "$memberId",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "member",
        },
      },
      {
        $unwind: {
          path: "$member",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          memberName: "$member.fullname",
          total: 1,
          count: 1,
        },
      },
      { $sort: { total: -1 } },
    ]);

    const total = await Donation.aggregate([
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    res.json({
      success: true,
      total: total[0]?.total || 0,
      breakdown: byMember,
    });
  } catch (err) {
    console.error("❌ Error fetching donation stats:", err);
    res.status(500).json({ error: "Failed to fetch donation stats" });
  }
});

export default router;
