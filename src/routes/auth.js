import { Router } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { requireAuth, devAuthFallback } from "../middleware/auth.js";
import nodemailer from "nodemailer";
import crypto from "crypto";
import dotenv from "dotenv";
import { body, param, validationResult } from "express-validator";
import { ok, created, badRequest, unauthorized, notFound, serverError } from "../utils/respond.js";
import logger from "../utils/logger.js";
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

    ok(res, {
      message: "Admin account created successfully",
      user: {
        id: user._id,
        fullname: user.fullname,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    logger.error("Error seeding admin", err);
    serverError(res, "Failed to seed admin");
  }
});

router.put("/seed-admin", async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ error: "Not allowed in production" });
    }
    const { fullname, email, password } = req.body;
    if (!email || !password) {
      return badRequest(res, "email and password are required");
    }
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ fullname, email, passwordHash: password, role: "admin" });
    } else {
      user.fullname = fullname || user.fullname;
      user.role = "admin";
      user.passwordHash = password;
      await user.save();
    }
    ok(res, {
      message: "Admin account seeded/updated successfully",
      user: {
        id: user._id,
        fullname: user.fullname,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    logger.error("Error updating admin via seed-admin", err);
    serverError(res, "Failed to update admin");
  }
});

/* -------------------------------------------------------------------------- */
/* 👤 2. Register (non-admin users)                                           */
/* -------------------------------------------------------------------------- */
router.post(
  "/register",
  [
    body("fullname").isString().trim().isLength({ min: 2 }),
    body("email").isEmail(),
    body("password").isString().isLength({ min: 6 }),
  ],
  async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, errors.array());
    const { fullname, email, password } = req.body;

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

    ok(res, {
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
    logger.error("Registration error", err);
    serverError(res, "Failed to register user");
  }
}
);

/* -------------------------------------------------------------------------- */
/* 🔐 3. Login                                                                */
/* -------------------------------------------------------------------------- */
router.post(
  "/login",
  [body("email").isEmail(), body("password").isString().isLength({ min: 1 })],
  async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, errors.array());
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user)
      return unauthorized(res, "Invalid email or password");

    const valid = await user.verifyPassword(password);
    if (!valid)
      return unauthorized(res, "Invalid email or password");

    const token = jwt.sign(
      { id: user._id, role: user.role, fullname: user.fullname, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    ok(res, {
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
    logger.error("Login error", err);
    serverError(res, "Login failed");
  }
}
);

/* -------------------------------------------------------------------------- */
/* 🧠 4. Get Current Authenticated User                                       */
/* -------------------------------------------------------------------------- */
router.get("/me", devAuthFallback, requireAuth, async (req, res) => {
  try {
    const user = req.user;
    ok(res, {
      user: {
        id: user.id,
        fullname: user.fullname || "Dev User",
        email: user.email || "dev@localhost",
        role: user.role || "admin",
      },
    });
  } catch (err) {
    logger.error("Auth check failed", err);
    serverError(res, "Failed to verify authentication");
  }
});

/* -------------------------------------------------------------------------- */
/* 🚪 5. Logout                                                               */
/* -------------------------------------------------------------------------- */
router.post("/logout", (_req, res) => {
  ok(res, { message: "User logged out successfully. Please clear your token on client." });
});

/* -------------------------------------------------------------------------- */
/* 🔑 6. Forgot Password / Reset Password (Admin Only)                        */
/* -------------------------------------------------------------------------- */
router.post(
  "/forgot-password",
  [body("email").isEmail()],
  async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, errors.array());
    const { email } = req.body;
    const user = await User.findOne({ email, role: "admin" });
    if (!user)
      return notFound(res, "No admin found with that email");

    const token = crypto.randomBytes(32).toString("hex");
    user.resetToken = token;
    user.resetTokenExpires = Date.now() + 1000 * 60 * 15; // 15 min expiry
    await user.save();

    const frontendBase = process.env.FRONTEND_URL || (process.env.NODE_ENV === "production" ? "https://unitedlinkfoundation.com" : "http://localhost:5173");
    const resetUrl = `${frontendBase}/#/reset-password/${token}`;

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
      logger.info("Password reset link", { resetUrl });
    }

    ok(res, { message: "Password reset link sent to your email" });
  } catch (err) {
    logger.error("Forgot-password error", err);
    serverError(res, "Failed to process request");
  }
}
);

router.post(
  "/reset-password/:token",
  [param("token").isString().isLength({ min: 32 }), body("newPassword").isString().isLength({ min: 6 })],
  async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, errors.array());
    const { token } = req.params;
    const { newPassword } = req.body;

    const user = await User.findOne({
      resetToken: token,
      resetTokenExpires: { $gt: Date.now() },
    });

    if (!user)
      return badRequest(res, "Invalid or expired token");

    user.passwordHash = newPassword; // 🔒 automatically hashed via pre-save hook
    user.resetToken = undefined;
    user.resetTokenExpires = undefined;
    await user.save();

    ok(res, { message: "Password reset successful" });
  } catch (err) {
    logger.error("Reset-password error", err);
    serverError(res, "Failed to reset password");
  }
}
);

export default router;
