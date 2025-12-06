import admin from "firebase-admin";
import fs from "fs";
import path from "path";

let initialized = false;
export function initFirebase() {
  if (initialized) return admin;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
  const credsPath = process.env.FIREBASE_CREDENTIALS_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!storageBucket) {
    throw new Error("Firebase env var missing: FIREBASE_STORAGE_BUCKET");
  }

  let credential;
  if (credsPath && fs.existsSync(credsPath)) {
    const raw = fs.readFileSync(path.resolve(credsPath), "utf8");
    const json = JSON.parse(raw);
    credential = admin.credential.cert(json);
  } else {
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("Firebase env vars missing: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY");
    }
    // Handle escaped newlines in env
    privateKey = privateKey.replace(/\\n/g, "\n");
    credential = admin.credential.cert({ project_id: projectId, client_email: clientEmail, private_key: privateKey });
  }

  admin.initializeApp({ credential, storageBucket });
  initialized = true;
  return admin;
}

export function getBucket() {
  initFirebase();
  return admin.storage().bucket();
}

export async function uploadFileToFirebase(localPath, destinationPath, contentType, makePublic = true) {
  const bucket = getBucket();
  const [file] = await bucket.upload(localPath, {
    destination: destinationPath,
    gzip: true,
    metadata: {
      contentType: contentType || undefined,
      cacheControl: "public, max-age=31536000",
    },
  });
  if (makePublic) {
    await file.makePublic().catch(() => {});
  }
  return `https://storage.googleapis.com/${bucket.name}/${destinationPath}`;
}

export async function deleteFirebaseFile(destinationPath) {
  const bucket = getBucket();
  const file = bucket.file(destinationPath);
  await file.delete().catch(() => {});
}

export function gcsPathFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "storage.googleapis.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length < 2) return null;
      return parts.slice(1).join("/");
    }
    if (u.hostname === "firebasestorage.googleapis.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      // expected: v0/b/<bucket>/o/<object>
      const idx = parts.findIndex((p) => p === "o");
      if (idx === -1 || idx + 1 >= parts.length) return null;
      const objectPart = parts.slice(idx + 1).join("/");
      return decodeURIComponent(objectPart);
    }
    return null;
  } catch {
    return null;
  }
}
