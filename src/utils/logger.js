function mask(val) {
  if (val == null) return val;
  const s = String(val);
  if (s.length <= 4) return "***";
  return s.slice(0, 2) + "***" + s.slice(-2);
}

function sanitize(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const keysToMask = new Set([
    "password",
    "passwordHash",
    "token",
    "resetToken",
    "JWT_SECRET",
    "EMAIL_PASS",
    "SMTP_PASS",
  ]);
  const out = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (keysToMask.has(k)) out[k] = mask(v);
    else if (v && typeof v === "object") out[k] = sanitize(v);
    else out[k] = v;
  }
  return out;
}

function ts() {
  return new Date().toISOString();
}

export function info(msg, meta) {
  if (meta) console.log(`[INFO] ${ts()} ${msg}`, sanitize(meta));
  else console.log(`[INFO] ${ts()} ${msg}`);
}

export function warn(msg, meta) {
  if (meta) console.warn(`[WARN] ${ts()} ${msg}`, sanitize(meta));
  else console.warn(`[WARN] ${ts()} ${msg}`);
}

export function error(msg, meta) {
  if (meta) console.error(`[ERROR] ${ts()} ${msg}`, sanitize(meta));
  else console.error(`[ERROR] ${ts()} ${msg}`);
}

export default { info, warn, error };
