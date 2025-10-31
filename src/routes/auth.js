import { Router } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { requireAuth, devAuthFallback } from "../middleware/auth.js";
import nodemailer from "nodemailer";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

const router = Router();

/* -------------------------------------------------------------------------- */
/* 🧱 1. Seed Initial Admin (first-time setup)                                */
/* -------------------------------------------------------------------------- */
router.post("/seed-admin", async (req, res) => {
  try {
    const { fullname, email, password } = req.body;
    const existing = await User.findOne({ email });
    if (existing)
      return res.status(400).json({ error: "Admin already exists" });

    const user = await User.create({
      fullname,
      email,
      passwordHash: password, // 🔒 auto-hashed via model pre-save hook
      role: "admin",
    });

    res.json({
      success: true,
      message: "Admin account created successfully",
      user: {
        id: user._id,
        fullname: user.fullname,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("❌ Error seeding admin:", err);
    res.status(500).json({ error: "Failed to seed admin" });
  }
});

/* -------------------------------------------------------------------------- */
/* 👤 2. Register (non-admin users)                                           */
/* -------------------------------------------------------------------------- */
router.post("/register", async (req, res) => {
  try {
    const { fullname, email, password } = req.body;
    if (!fullname || !email || !password)
      return res.status(400).json({ error: "All fields are required" });

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(400).json({ error: "Email already registered" });

    const user = await User.create({
      fullname,
      email,
      passwordHash: password, // 🔒 handled by pre-save hook
      role: "member",
    });

    const token = jwt.sign(
      { id: user._id, role: user.role, fullname: user.fullname, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      message: "Registration successful",
      token,
      user: {
        id: user._id,
        fullname: user.fullname,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("❌ Registration error:", err);
    res.status(500).json({ error: "Failed to register user" });
  }
});

/* -------------------------------------------------------------------------- */
/* 🔐 3. Login                                                                */
/* -------------------------------------------------------------------------- */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user)
      return res.status(401).json({ error: "Invalid email or password" });

    const ok = await user.verifyPassword(password);
    if (!ok)
      return res.status(401).json({ error: "Invalid email or password" });

    const token = jwt.sign(
      { id: user._id, role: user.role, fullname: user.fullname, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        fullname: user.fullname,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/* -------------------------------------------------------------------------- */
/* 🧠 4. Get Current Authenticated User                                       */
/* -------------------------------------------------------------------------- */
router.get("/me", devAuthFallback, requireAuth, async (req, res) => {
  try {
    const user = req.user;
    res.json({
      success: true,
      user: {
        id: user.id,
        fullname: user.fullname || "Dev User",
        email: user.email || "dev@localhost",
        role: user.role || "admin",
      },
    });
  } catch (err) {
    console.error("❌ Auth check failed:", err);
    res.status(500).json({ error: "Failed to verify authentication" });
  }
});

/* -------------------------------------------------------------------------- */
/* 🚪 5. Logout                                                               */
/* -------------------------------------------------------------------------- */
router.post("/logout", (_req, res) => {
  res.json({
    success: true,
    message: "User logged out successfully. Please clear your token on client.",
  });
});

/* -------------------------------------------------------------------------- */
/* 🔑 6. Forgot Password / Reset Password (Admin Only)                        */
/* -------------------------------------------------------------------------- */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email, role: "admin" });
    if (!user)
      return res.status(404).json({ message: "No admin found with that email" });

    const token = crypto.randomBytes(32).toString("hex");
    user.resetToken = token;
    user.resetTokenExpires = Date.now() + 1000 * 60 * 15; // 15 min expiry
    await user.save();

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${token}`;

    // 📨 Production-ready mail config
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // 💌 Send Reset Email
    await transporter.sendMail({
      from: `"United Link Foundation" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Password Reset Request",
      html: `
        <p>Hello ${user.fullname},</p>
        <p>We received a request to reset your admin password.</p>
        <p><a href="${resetUrl}" target="_blank">Click here to reset your password</a></p>
        <p>This link will expire in 15 minutes.</p>
        <br/>
        <p>If you didn’t request this, you can safely ignore this email.</p>
      `,
    });

    // 🧩 Local Development Fallback
    if (process.env.NODE_ENV !== "production") {
      console.log("🔗 Password reset link:", resetUrl);
    }

    res.json({ success: true, message: "Password reset link sent to your email" });
  } catch (err) {
    console.error("❌ Forgot-password error:", err);
    res.status(500).json({ message: "Failed to process request" });
  }
});

router.post("/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;

    const user = await User.findOne({
      resetToken: token,
      resetTokenExpires: { $gt: Date.now() },
    });

    if (!user)
      return res.status(400).json({ message: "Invalid or expired token" });

    user.passwordHash = newPassword; // 🔒 automatically hashed via pre-save hook
    user.resetToken = undefined;
    user.resetTokenExpires = undefined;
    await user.save();

    res.json({ success: true, message: "Password reset successful" });
  } catch (err) {
    console.error("❌ Reset-password error:", err);
    res.status(500).json({ message: "Failed to reset password" });
  }
});

export default router;
