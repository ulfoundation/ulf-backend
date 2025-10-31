import express from "express";
import {
  getAllSections,
  getSection,
  updateSection,
  seedSections,
} from "../controllers/aboutController.js";
import { requireAuth, devAuthFallback } from "../middleware/auth.js";

const router = express.Router();

// Public
router.get("/sections", getAllSections);
router.get("/:section", getSection);

// Admin only
router.put("/:section", devAuthFallback, requireAuth, updateSection);
router.post("/seed", devAuthFallback, requireAuth, seedSections);

export default router;
