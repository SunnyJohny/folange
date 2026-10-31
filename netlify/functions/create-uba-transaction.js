// Netlify Function: create-uba-transaction.js
const admin = require("firebase-admin");

console.log("🔥 create-uba-transaction function loaded");

/* ---------------- FIREBASE INIT ---------------- */
let firebaseInitialized = false;

function initFirebase() {
  if (firebaseInitialized) return;

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT env variable missing");
  }

  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  firebaseInitialized = true;
  console.log("✅ Firebase initialized");
}

/* ---------------- FETCH SUPPORT ---------------- */
let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = require("node-fetch");
}

/* ---------------- CONFIG ---------------- */
const SEERBIT_BASE_URL = "https://seerbitapi.com";

function generatePaymentReference() {
  return `ref_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

/* ---------------- HANDLER ---------------- */
exports.handler = async (event) => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing request body" }),
      };
    }

    const body = JSON.parse(event.body);
    const {
      amount,
      email,
      fullName,
      productId,
      productDescription,
      userId,
      currency,
    } = body;

    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid amount" }),
      };
    }

    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Email is required" }),
      };
    }

    const publicKey = process.env.SEERBIT_PUBLIC_KEY;
    const secretKey = process.env.SEERBIT_SECRET_KEY;

    if (!publicKey || !secretKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Seerbit keys not configured" }),
      };
    }

    /* ---------- INIT FIREBASE ---------- */
    initFirebase();

    /* ---------- STEP 1: ENCRYPT KEYS (NO AUTH HEADER) ---------- */
    const encryptPayload = {
      key: `${secretKey}.${publicKey}`,
    };

    const encryptRes = await fetchFn(
      `${SEERBIT_BASE_URL}/api/v2/encrypt/keys`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(encryptPayload),
      }
    );

    const encryptText = await encryptRes.text();
    console.log("🔐 Encrypt response:", encryptText);

    let encryptJson;
    try {
      encryptJson = JSON.parse(encryptText);
    } catch {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: "Invalid encrypt response",
          raw: encryptText,
        }),
      };
    }

    if (!encryptRes.ok || !encryptJson?.data?.encryptedKey) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: "Failed to encrypt Seerbit keys",
          response: encryptJson,
        }),
      };
    }

    const encryptedKey = encryptJson.data.encryptedKey;
    console.log("✅ Encrypted key obtained");

    /* ---------- STEP 2: CREATE PAYMENT ---------- */
    const paymentReference = generatePaymentReference();

    const paymentPayload = {
      publicKey,
      amount: amount.toString(),
      currency: currency || "NGN",
      country: "NG",
      paymentReference,
      email,
      fullName: fullName || "",
      tokenize: "false",
      callbackUrl: `${process.env.SITE_URL}/callback`,
      splitCode: "",
      meta: {
        productId: productId || "",
        userId: userId || "",
      },
    };

    const paymentRes = await fetchFn(
      `${SEERBIT_BASE_URL}/api/v2/payments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${encryptedKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(paymentPayload),
      }
    );

    const paymentJson = await paymentRes.json();

    if (!paymentRes.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: "Payment creation failed",
          response: paymentJson,
        }),
      };
    }

    const redirectLink =
      paymentJson?.data?.payments?.redirectLink || null;

    /* ---------- SAVE TO FIRESTORE ---------- */
    const db = admin.firestore();
    await db.collection("payments").doc(paymentReference).set({
      amount,
      currency: paymentPayload.currency,
      email,
      fullName: fullName || "",
      productId,
      productDescription,
      userId: userId || null,
      status: "Pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      seerbit: paymentJson,
    });

    /* ---------- SUCCESS ---------- */
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        paymentReference,
        redirectLink,
      }),
    };
  } catch (err) {
    console.error("💥 ERROR:", err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal server error",
        message: err.message,
      }),
    };
  }
};
