import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import fsSync from "fs";
import { ensureBaseDirs, UPLOADS_ROOT } from "./utils/media.js";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import connectDB from "./config/db.js";

// 🧩 Routes
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import postRoutes from "./routes/posts.js";
import donationRoutes from "./routes/donations.js";
import searchRoutes from "./routes/search.js";
import aboutRoutes from "./routes/about.js";
import memberRoutes from "./routes/member.js";
import contactRoutes from "./routes/contact.js";
import teamRoutes from "./routes/team.js";
import uploadRoutes from "./routes/upload.js";
import { verifyFirebaseStorage } from "./utils/firebase.js";

// Initialize app
const app = express();
app.set("trust proxy", 1);

/* -------------------------------------------------------------------------- */
/* 🌐 CORS SETUP — Supports both local + production                           */
/* -------------------------------------------------------------------------- */
const defaultOrigins = [
  "http://localhost:5173",                // local dev (Vite)
  "http://localhost:5174",                // alt dev port (Vite)
  "https://unitedlinkfoundation.com",     // production main domain
  "https://www.unitedlinkfoundation.com", // optional www version
];

// 🔁 Allow extending via .env (comma-separated)
const extraOrigins = process.env.ORIGIN ? process.env.ORIGIN.split(",") : [];
const allowedOrigins = [...new Set([...defaultOrigins, ...extraOrigins])];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`🚫 Blocked by CORS: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// Security headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// Compression
app.use(compression());

// Basic rate limiting (global)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(generalLimiter);

/* -------------------------------------------------------------------------- */
/* 🧩 Core Middleware                                                         */
/* -------------------------------------------------------------------------- */
// Ensure Stripe webhook receives raw body before JSON parsing
app.use("/api/donations/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "20mb" }));
app.use(morgan("dev"));

/* -------------------------------------------------------------------------- */
/* 📁 Serve Uploaded Files                                                    */
/* -------------------------------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
ensureBaseDirs();
app.use(
  "/uploads",
  express.static(UPLOADS_ROOT, {
    etag: false,
    lastModified: false,
    cacheControl: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
    },
  })
);

/* -------------------------------------------------------------------------- */
/* 🚏 API Routes                                                              */
/* -------------------------------------------------------------------------- */
// Tighter limits for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/donations", donationRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/about", aboutRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/team", teamRoutes);
app.use("/api/members", memberRoutes);
app.use("/api/upload", uploadRoutes);

/* -------------------------------------------------------------------------- */
/* 🌍 Root Route                                                              */
/* -------------------------------------------------------------------------- */
app.get("/", (req, res) => {
  res.send("🌍 United Link Foundation API is running successfully.");
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("💥 Unhandled error:", err?.message || err);
  res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
});

/* -------------------------------------------------------------------------- */
/* 🚀 Server Bootstrap                                                        */
/* -------------------------------------------------------------------------- */
const PORT = process.env.PORT || 5020;

connectDB()
  .then(() => {
    verifyFirebaseStorage().catch(() => {});
    app.listen(PORT, () => {
      console.log(
        `✅ Server running on port ${PORT} — Allowed origins:\n${allowedOrigins.join(
          "\n"
        )}`
      );
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  });
