import admin from "firebase-admin";
import crypto from "crypto";

import RSA from "./_lib/RSA.js";
import AES from "./_lib/AES.js";

/**
 * ======================================================
 * Firebase Admin Init (Netlify-safe)
 * ======================================================
 */
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(
          /\\n/g,
          "\n"
        ),
      }),
    });
  } catch (e) {
    console.error("Failed to initialize Firebase Admin:", e?.message || e);
  }
}

const db = admin.apps.length ? admin.firestore() : null;

/**
 * ======================================================
 * Cache Firestore secrets for warm lambda
 * ======================================================
 */
let cachedPrivateKey = null;
let cachedAt = 0;
const TTL_MS = 5 * 60 * 1000;

async function getMerchantPrivateKeyFromFirestore() {
  if (!db) throw new Error("Firestore not initialized. Check Firebase env vars.");

  const now = Date.now();
  if (cachedPrivateKey && now - cachedAt < TTL_MS) return cachedPrivateKey;

  const snap = await db.collection("secrets").doc("uba").get();
  if (!snap.exists) throw new Error("Missing Firestore doc: secrets/uba");

  const data = snap.data() || {};
  const privateKey = data.merchantPrivateKey_b64der;

  if (!privateKey) {
    throw new Error("Missing field secrets/uba.merchantPrivateKey_b64der");
  }

  cachedPrivateKey = String(privateKey).trim();
  cachedAt = now;
  return cachedPrivateKey;
}

/**
 * ======================================================
 * Helpers
 * ======================================================
 */
const pickHeader = (headers, name) => {
  if (!headers || typeof headers !== "object") return null;

  if (headers[name]) return headers[name];
  if (headers[name.toLowerCase()]) return headers[name.toLowerCase()];
  if (headers[name.toUpperCase()]) return headers[name.toUpperCase()];

  const foundKey = Object.keys(headers).find(
    (k) => k.toLowerCase() === name.toLowerCase()
  );
  if (foundKey) return headers[foundKey];
  return null;
};

const safeJsonParse = (str, fallback = null) => {
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
};

// handles padding / garbage before/after JSON
const extractJsonObjectString = (text) => {
  const s = String(text || "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return s.slice(first, last + 1);
  }
  return s;
};

const normStr = (v) => {
  if (v === null || v === undefined) return "";
  return String(v).trim();
};

const normLower = (v) => normStr(v).toLowerCase();

const toNumber = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const normalizeB64 = (v) => {
  let s = String(v || "").trim();

  s = s.replace(/\\u003d/g, "=");
  s = s.replace(/ /g, "+");
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  s = s.replace(/\r?\n|\r/g, "");

  return s;
};

const isHex = (s) => /^[0-9a-fA-F]+$/.test(s);
const looksLikeB64 = (s) => /^[A-Za-z0-9+/=_-]+$/.test(String(s || "").trim());

/**
 * ======================================================
 * AES key candidates
 *
 * ✅ IMPORTANT:
 * - Your request side uses AES.js with keyHex (64 chars)
 * - Webhook gets aesKeyBuf (32 bytes) from RSA decrypt
 * - Correct keyHex for AES.js is aesKeyBuf.toString("hex")
 * ======================================================
 */
const buildAesKeyCandidates = (aesKeyBuf) => {
  const candidates = [];

  const push = (keyBuf, label) => {
    if (Buffer.isBuffer(keyBuf) && keyBuf.length === 32) {
      candidates.push({
        keyBuf,
        keyHex: keyBuf.toString("hex"), // <-- matches AES.js expectations
        label,
      });
    }
  };

  // 1) RAW 32 bytes (most correct)
  push(aesKeyBuf, "raw32");

  // 2) If decrypted buffer is actually ASCII hex (rare), convert
  // e.g. decrypted text "a1b2...64hex"
  const asText = Buffer.isBuffer(aesKeyBuf) ? aesKeyBuf.toString("utf8").trim() : "";
  if (asText.length === 64 && isHex(asText)) {
    push(Buffer.from(asText, "hex"), "decrypted_text_hex64");
  }

  // 3) If decrypted buffer is base64 that decodes to 32 bytes (rare)
  if (asText.length >= 40 && asText.length <= 80 && looksLikeB64(asText)) {
    try {
      const b = Buffer.from(normalizeB64(asText), "base64");
      push(b, "decrypted_text_base64_to_32");
    } catch (_) {}
  }

  // de-dupe
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const sig = c.keyHex;
    if (!seen.has(sig)) {
      seen.add(sig);
      out.push(c);
    }
  }
  return out;
};

/**
 * ======================================================
 * Crypto AES multi-format decrypt (optional)
 * ======================================================
 */
const tryAes256CbcDecrypt = ({ keyBuf, iv, ciphertext, label }) => {
  try {
    const decipher = crypto.createDecipheriv("aes-256-cbc", keyBuf, iv);
    const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return { ok: true, text: out.toString("utf8"), method: `${label}:pkcs7` };
  } catch (_) {}

  try {
    const decipher2 = crypto.createDecipheriv("aes-256-cbc", keyBuf, iv);
    decipher2.setAutoPadding(false);
    const out2 = Buffer.concat([decipher2.update(ciphertext), decipher2.final()]);
    return {
      ok: true,
      text: out2.toString("utf8").replace(/\0+$/g, ""),
      method: `${label}:nopad`,
    };
  } catch (e) {
    return { ok: false, error: e };
  }
};

const decryptUbaDataMultiFormat = (encryptedBase64, keyBuf) => {
  const s = normalizeB64(encryptedBase64);

  // A/B: packed base64( IV + ciphertext ) or base64(ciphertext + IV)
  const raw = Buffer.from(s, "base64");
  if (raw.length > 16) {
    // IV prefix
    {
      const iv = raw.slice(0, 16);
      const ct = raw.slice(16);
      const r = tryAes256CbcDecrypt({
        keyBuf,
        iv,
        ciphertext: ct,
        label: "packed_iv_prefix",
      });
      if (r.ok) return r;
    }

    // IV suffix
    {
      const iv = raw.slice(raw.length - 16);
      const ct = raw.slice(0, raw.length - 16);
      const r = tryAes256CbcDecrypt({
        keyBuf,
        iv,
        ciphertext: ct,
        label: "packed_iv_suffix",
      });
      if (r.ok) return r;
    }
  }

  // C: glued base64(iv)(24) + base64(cipher)(rest)
  if (s.length > 24) {
    try {
      const ivB64 = s.slice(0, 24);
      const ctB64 = s.slice(24);

      const iv = Buffer.from(ivB64, "base64");
      const ct = Buffer.from(ctB64, "base64");

      if (iv.length === 16 && ct.length > 0) {
        const r = tryAes256CbcDecrypt({
          keyBuf,
          iv,
          ciphertext: ct,
          label: "glued_b64_iv+ct",
        });
        if (r.ok) return r;
      }
    } catch (_) {}
  }

  throw new Error("AES decrypt failed in all formats");
};

/**
 * ======================================================
 * Order finder
 * ✅ ADD rawPayload.reference because your orders store it there
 * ======================================================
 */
async function findOrderDoc({ orderId, reference, vNUBAN }) {
  if (!db) return null;

  const oid = normStr(orderId);
  const ref = normStr(reference);
  const vn = normStr(vNUBAN);

  // 0) documentId match
  if (oid) {
    try {
      const snap = await db
        .collectionGroup("orders")
        .where(admin.firestore.FieldPath.documentId(), "==", oid)
        .limit(5)
        .get();

      if (!snap.empty) {
        let chosen = null;
        snap.forEach((docSnap) => {
          const d = docSnap.data() || {};
          if (!chosen && normLower(d.orderStatus) === "pending") chosen = docSnap;
        });
        return chosen || snap.docs[0];
      }
    } catch (e) {
      console.error("⚠️ collectionGroup query failed for docId:", e?.message || e);
    }
  }

  // 1) payment.reference
  if (ref) {
    try {
      const snap = await db
        .collectionGroup("orders")
        .where("payment.reference", "==", ref)
        .limit(5)
        .get();

      if (!snap.empty) {
        let chosen = null;
        snap.forEach((docSnap) => {
          const d = docSnap.data() || {};
          if (!chosen && normLower(d.orderStatus) === "pending") chosen = docSnap;
        });
        return chosen || snap.docs[0];
      }
    } catch (e) {
      console.error("⚠️ query failed for payment.reference:", e?.message || e);
    }
  }

  // ✅ 1b) rawPayload.reference (YOUR CURRENT SCHEMA)
  if (ref) {
    try {
      const snap = await db
        .collectionGroup("orders")
        .where("rawPayload.reference", "==", ref)
        .limit(5)
        .get();

      if (!snap.empty) {
        let chosen = null;
        snap.forEach((docSnap) => {
          const d = docSnap.data() || {};
          if (!chosen && normLower(d.orderStatus) === "pending") chosen = docSnap;
        });
        return chosen || snap.docs[0];
      }
    } catch (e) {
      console.error("⚠️ query failed for rawPayload.reference:", e?.message || e);
    }
  }

  // 2) payment.vaNuban fields
  if (vn) {
    const vnFields = ["payment.vaNuban", "payment.vNUBAN", "payment.vnuban"];
    for (const f of vnFields) {
      try {
        const snap = await db.collectionGroup("orders").where(f, "==", vn).limit(5).get();
        if (!snap.empty) {
          let chosen = null;
          snap.forEach((docSnap) => {
            const d = docSnap.data() || {};
            if (!chosen && normLower(d.orderStatus) === "pending") chosen = docSnap;
          });
          return chosen || snap.docs[0];
        }
      } catch (e) {
        console.error(`⚠️ query failed for ${f}:`, e?.message || e);
      }
    }
  }

  return null;
}

/**
 * ======================================================
 * Webhook Handler (UBA VAS)
 * ======================================================
 */
export const handler = async (event) => {
  console.log("🔥🔥 UBA VAS WEBHOOK RECEIVED 🔥🔥");

  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body || "";

    // SecureToken header
    const secureTokenRaw =
      pickHeader(event.headers, "SecureToken") ||
      pickHeader(event.headers, "secureToken") ||
      pickHeader(event.headers, "securetoken");

    if (!secureTokenRaw) {
      console.log("❌ Missing SecureToken header");
      return { statusCode: 400, body: "Missing SecureToken" };
    }

    const secureToken = normalizeB64(secureTokenRaw);

    // Body parse
    const body = safeJsonParse(rawBody);
    if (!body || !body.data) {
      console.log("❌ Missing body.data");
      return { statusCode: 400, body: "Missing body.data" };
    }

    // Load merchant private key
    let merchantPrivateKey = process.env.MERCHANT_PRIVATE_KEY || null;
    if (!merchantPrivateKey) {
      if (!db) {
        console.error("Firestore not initialized and MERCHANT_PRIVATE_KEY not supplied.");
        return { statusCode: 200, body: "Missing merchant private key" };
      }
      merchantPrivateKey = await getMerchantPrivateKeyFromFirestore();
    }

    // RSA decrypt SecureToken -> AES key buffer
    let aesKeyBuf;
    try {
      if (typeof RSA.decryptToBufferWithPrivateKey === "function") {
        aesKeyBuf = RSA.decryptToBufferWithPrivateKey(secureToken, merchantPrivateKey);
      } else if (typeof RSA.decryptSecureToken === "function") {
        aesKeyBuf = RSA.decryptSecureToken(secureToken, merchantPrivateKey);
      } else {
        throw new Error("RSA helper does not expose decrypt method");
      }
    } catch (err) {
      console.error("❌ SecureToken decrypt failed:", err?.message || err);
      return { statusCode: 200, body: "Invalid SecureToken" };
    }

    console.log("🔐 SecureToken length:", String(secureToken || "").length);
    console.log("🔑 AES key buf length:", aesKeyBuf?.length || null);
    console.log("📦 body.data length:", normalizeB64(body.data).length);

    if (!Buffer.isBuffer(aesKeyBuf) || aesKeyBuf.length === 0) {
      console.log("❌ Decrypted AES key invalid");
      return { statusCode: 200, body: "Invalid decrypted AES key" };
    }

    // Build key candidates
    const candidates = buildAesKeyCandidates(aesKeyBuf);
    console.log(
      "🔍 AES key candidates:",
      candidates.map((c) => `${c.label}`).join(", ")
    );

    /**
     * ✅ Decrypt payload
     *
     * IMPORTANT:
     * Your encrypt side is AES.js => base64(IV + ciphertext) using keyHex.
     * So try AES.js FIRST using keyHex derived from raw32.
     */
    let clearText = null;
    let usedKeyLabel = null;
    let usedDecryptMethod = null;
    let lastErr = null;

    for (const c of candidates) {
      // 1) AES.js decrypt (matches your encrypt)
      try {
        const t = AES.decrypt(normalizeB64(body.data), c.keyHex);
        const jsonish = extractJsonObjectString(t);
        const maybe = safeJsonParse(jsonish);
        if (maybe) {
          clearText = jsonish;
          usedKeyLabel = c.label;
          usedDecryptMethod = "AES.js";
          break;
        }
      } catch (e) {
        lastErr = e;
      }

      // 2) Crypto multi-format fallback
      try {
        const r = decryptUbaDataMultiFormat(body.data, c.keyBuf);
        const jsonish = extractJsonObjectString(r.text);
        const maybe = safeJsonParse(jsonish);
        if (maybe) {
          clearText = jsonish;
          usedKeyLabel = c.label;
          usedDecryptMethod = r.method;
          break;
        }
      } catch (e2) {
        lastErr = e2;
      }
    }

    if (!clearText) {
      console.error("❌ AES decrypt failed for all candidates");
      console.error("Last decrypt error:", lastErr?.message || lastErr);
      return { statusCode: 200, body: "Invalid encrypted payload" };
    }

    console.log("✅ AES decrypt OK:", { usedKeyLabel, usedDecryptMethod });

    const payload = safeJsonParse(clearText);
    if (!payload) {
      console.log("❌ Could not parse decrypted payload as JSON");
      return { statusCode: 200, body: "Invalid decrypted payload" };
    }

    console.log("✅ Decrypted payload keys:", Object.keys(payload || {}).slice(0, 30));

    // Extract
    const orderId =
      normStr(payload.orderId) ||
      normStr(payload.customerReference) ||
      normStr(payload.reference) ||
      null;

    const vNUBAN =
      payload.beneficiaryAccountNumber ||
      payload.beneficiaryAccount ||
      payload.vNUBAN ||
      payload.vnuban ||
      payload.vaNuban ||
      null;

    const providerStatusRaw =
      payload.status || payload.transactionStatus || payload.paymentStatus || null;
    const providerStatusLC = normLower(providerStatusRaw);

    const paymentReference =
      payload.paymentReference ||
      payload.stan ||
      payload.transactionRef ||
      payload.transactionReference ||
      payload.sessionID ||
      payload.sessionId ||
      payload.reference ||
      null;

    const amount =
      payload.amount ?? payload.amountPaid ?? payload.transactionAmount ?? null;

    console.log("📌 orderId:", orderId);
    console.log("📌 paymentReference:", paymentReference);
    console.log("📌 vNUBAN:", vNUBAN);
    console.log("📌 providerStatus:", providerStatusRaw);

    if (!db) {
      console.error("Firestore not initialized. Cannot update records.");
      return { statusCode: 200, body: "Firestore not available" };
    }

    // Success check
    const isSuccess =
      providerStatusLC === "successful" ||
      providerStatusLC === "paid" ||
      providerStatusLC === "completed" ||
      providerStatusLC === "success";

    if (!isSuccess) {
      console.log("ℹ️ Not success status, ignored:", providerStatusRaw);
      return { statusCode: 200, body: "Not successful, ignored" };
    }

    // Find order
    const orderDoc = await findOrderDoc({
      orderId,
      reference: normStr(paymentReference),
      vNUBAN,
    });

    if (!orderDoc) {
      console.log("❌ No order found to update", { orderId, paymentReference, vNUBAN });
      return { statusCode: 200, body: "No matching order" };
    }

    const orderRef = orderDoc.ref;
    const orderData = orderDoc.data() || {};

    console.log("✅ Found order:", orderRef.path);
    console.log("📦 Current orderStatus:", orderData.orderStatus);
    console.log("📦 Current payment.status:", orderData?.payment?.status);

    // Idempotency
    const currentOrderStatus = normLower(orderData.orderStatus);
    const currentPaymentStatus = normLower(orderData?.payment?.status);

    if (currentOrderStatus === "paid" && currentPaymentStatus === "paid") {
      console.log('🔁 Already "Paid"');
      return { statusCode: 200, body: "Already paid" };
    }

    // Update
    const nowTS = admin.firestore.FieldValue.serverTimestamp();

    await orderRef.set(
      {
        orderStatus: "Paid",
        updatedAt: nowTS,
        payment: {
          ...(orderData.payment || {}),
          status: "Paid",
          paidAt: nowTS,
          providerStatus: normStr(providerStatusRaw) || null,
          providerPaymentReference: normStr(paymentReference) || null,
          vaNuban: normStr(vNUBAN) || null,
          amountReceived: toNumber(amount),
          webhookDecrypt: { keyLabel: usedKeyLabel, method: usedDecryptMethod },
        },
        rawWebhook: payload,
      },
      { merge: true }
    );

    console.log("✅✅✅ FIRESTORE UPDATE COMPLETE ✅✅✅", orderRef.path);
    return { statusCode: 200, body: "Order updated to Paid" };
  } catch (error) {
    console.error("🔥 UBA WEBHOOK ERROR:", error);
    return { statusCode: 200, body: "Webhook received with error" };
  }
};
