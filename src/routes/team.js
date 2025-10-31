import express from "express";
import Team from "../models/Team.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* 🔹 GET — Public (Fetch all team members)                                   */
/* -------------------------------------------------------------------------- */
router.get("/", async (req, res) => {
  try {
    const team = await Team.find().sort({ createdAt: -1 });
    res.json(team);
  } catch (err) {
    console.error("❌ Error fetching team:", err);
    res.status(500).json({ message: "Server error fetching team" });
  }
});

/* -------------------------------------------------------------------------- */
/* 🔸 POST — Admin Only (Add new team member)                                 */
/* -------------------------------------------------------------------------- */
router.post("/", requireAuth, async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Access denied — Admins only" });
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
      photo,
      bio,
      facebook,
      instagram,
      linkedin,
      twitter,
    });

    res.status(201).json(newMember);
  } catch (err) {
    console.error("❌ Error adding team member:", err);
    res.status(500).json({ message: "Failed to add team member" });
  }
});

/* -------------------------------------------------------------------------- */
/* ✏️ PUT — Admin Only (Update team member)                                  */
/* -------------------------------------------------------------------------- */
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Access denied — Admins only" });
    }

    const updated = await Team.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!updated) return res.status(404).json({ message: "Member not found" });

    res.json(updated);
  } catch (err) {
    console.error("❌ Error updating team member:", err);
    res.status(500).json({ message: "Failed to update member" });
  }
});

/* -------------------------------------------------------------------------- */
/* 🗑️ DELETE — Admin Only (Remove team member)                               */
/* -------------------------------------------------------------------------- */
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Access denied — Admins only" });
    }

    const member = await Team.findByIdAndDelete(req.params.id);
    if (!member) {
      return res.status(404).json({ message: "Member not found" });
    }

    res.json({ message: "Team member deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting team member:", err);
    res.status(500).json({ message: "Failed to delete member" });
  }
});

export default router;
