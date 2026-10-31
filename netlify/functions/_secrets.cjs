const admin = require("firebase-admin");

let cachedUbaMerchantKey = null;

function initAdmin() {
  if (admin.apps.length) return;

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

// Firestore value is "MII...." base64 DER string.
// Convert to PEM.
function b64DerToPem(b64) {
  const lines = (b64 || "").match(/.{1,64}/g) || [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

async function getUbaMerchantPrivateKey() {
  if (cachedUbaMerchantKey) return cachedUbaMerchantKey;

  initAdmin();

  const snap = await admin.firestore().doc("secrets/uba").get();
  if (!snap.exists) throw new Error("Missing Firestore secret doc: secrets/uba");

  const b64 = snap.get("merchantPrivateKey_b64der");
  if (!b64) throw new Error("Missing field merchantPrivateKey_b64der in secrets/uba");

  cachedUbaMerchantKey = b64DerToPem(b64);
  return cachedUbaMerchantKey;
}

module.exports = { getUbaMerchantPrivateKey };
