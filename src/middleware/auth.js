import jwt from "jsonwebtoken";

/* =============================================================================
   🧩 AUTHENTICATION MIDDLEWARE — ULF Secure Edition
   ============================================================================= */
export function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    // ✅ Allow dev-mode bypass (local testing only)
    if (token === "dev-mode" && process.env.NODE_ENV !== "production") {
      req.user = {
        id: "foundation-admin",
        fullname: "Foundation Admin",
        avatar: "/default-avatar.png",
        role: "admin",
      };
      return next();
    }

    // ✅ Reject if missing token (in production)
    if (!token) {
      return res.status(401).json({ error: "Authorization token required" });
    }

    // ✅ Fallback secret in dev mode
    if (!process.env.JWT_SECRET) {
      console.warn("⚠️ JWT_SECRET not set — using fallback secret (dev mode)");
    }

    // ✅ Verify token
    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");

    req.user = {
      id: payload.id || payload._id,
      fullname: payload.fullname || "Anonymous User",
      email: payload.email || null,
      avatar: payload.avatar || "/default-avatar.png",
      role: payload.role || "user",
    };

    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ error: "Session expired, please log in again." });
    }
    console.error("❌ JWT verification failed:", err.message);
    return res.status(401).json({ error: "Invalid or missing token" });
  }
}

/* =============================================================================
   🔐 ADMIN-ONLY MIDDLEWARE
   ============================================================================= */
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin privileges required" });
  }
  next();
}

/* =============================================================================
   🧠 DEV MODE FALLBACK — Injects a fake admin when no token (non-prod only)
   ============================================================================= */
export function devAuthFallback(req, res, next) {
  if (process.env.NODE_ENV !== "production") {
    if (!req.user && !req.headers.authorization) {
      req.user = {
        id: "foundation-admin",
        fullname: "Foundation Admin",
        avatar: "/default-avatar.png",
        role: "admin",
      };
      console.log("🧩 Dev auth fallback injected fake admin user");
    }
  }
  next();
}
