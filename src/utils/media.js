import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const UPLOADS_ROOT = path.resolve(__dirname, "../../client/uploads");

export function ensureBaseDirs() {
  const dirs = [
    UPLOADS_ROOT,
    path.join(UPLOADS_ROOT, "posts"),
    path.join(UPLOADS_ROOT, "posts", "images"),
    path.join(UPLOADS_ROOT, "posts", "videos"),
    path.join(UPLOADS_ROOT, "team"),
    path.join(UPLOADS_ROOT, "members"),
    path.join(UPLOADS_ROOT, "about"),
  ];
  for (const d of dirs) {
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch {}
  }
}

export function getPublicBase(req) {
  const raw = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).trim();
  return raw.replace(/\/+$/, "");
}

export function extractUploadsRel(u) {
  if (!u || typeof u !== "string") return null;
  const idx = u.indexOf("/uploads/");
  if (idx === -1) return null;
  return u.slice(idx + "/uploads/".length);
}

export function generateFilename(originalName) {
  const ext = path.extname(originalName || "").toLowerCase() || ".jpg";
  const base = path.basename(originalName || "file", ext).replace(/[^a-z0-9_-]+/gi, "-");
  return `${Date.now()}-${base}${ext}`;
}

