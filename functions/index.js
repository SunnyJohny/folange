// 🔥 FIREBASE FUNCTIONS v2 IMPORTS
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

// OTHER DEPENDENCIES
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ⭐ Load TEST KEYS as Firebase Secrets
const PUBLIC_KEY = defineSecret("UBA_TEST_PUBLIC_KEY");
const SECRET_KEY = defineSecret("UBA_TEST_SECRET_KEY");

// Helpers to get real values
const getPublicKey = () => PUBLIC_KEY.value();
const getSecretKey = () => SECRET_KEY.value();

// 💬 DEBUG: Print values when emulator starts
console.log("🔥 Firebase Secrets Loaded:");
console.log("PUBLIC_KEY:", getPublicKey() ? "✔ Loaded" : "❌ Not Loaded");
console.log("SECRET_KEY:", getSecretKey() ? "✔ Loaded" : "❌ Not Loaded");

// ------------------------------------------------------
// 0️⃣ DEFAULT ROUTE
app.get("/", (req, res) => {
  res.send("UBA Standard Checkout API is running!");
});

// ------------------------------------------------------
// 🔎 0.5️⃣ CHECK ENV ENDPOINT (Important for Testing)
app.get("/check-env", (req, res) => {
  res.json({
    PUBLIC_KEY: getPublicKey() || "Not Found",
    SECRET_KEY: getSecretKey() || "Not Found"
  });
});

// ------------------------------------------------------
// 1️⃣ GET ENCRYPTED KEY
const getSeerbitToken = async () => {
  const combinedKey = `${getSecretKey()}.${getPublicKey()}`;

  const response = await axios.post(
    "https://seerbitapi.com/api/v2/encrypt/key",
    { key: combinedKey },
    { headers: { "Content-Type": "application/json" } }
  );

  return response.data?.data?.EncryptedSecKey?.encryptedKey;
};

// ------------------------------------------------------
// 2️⃣ CREATE UBA STANDARD CHECKOUT TRANSACTION
app.post("/create-uba-transaction", async (req, res) => {
  try {
    const { amount, email, productId, productDescription, fullName } = req.body;

    if (!amount || !email) {
      return res.status(400).json({ message: "Amount and Email are required" });
    }

    const paymentReference = `UBATX-${Date.now()}`;
    const encryptedKey = await getSeerbitToken();

    const payload = {
      publicKey: getPublicKey(),
      amount: Number(amount).toFixed(2),
      currency: "NGN",
      country: "NG",
      paymentReference,
      email,
      fullName: fullName || email,
      productId: productId || "64310880-2708933-427",
      productDescription: productDescription || "Food Order",
      channelType: "UBA",
      callbackUrl: "https://us-central1-loan-c02d1.cloudfunctions.net/api/uba-webhook",
      returnUrl: "https://www.importwithbliss.com/payment-success",
    };

    const { data } = await axios.post(
      "https://seerbitapi.com/api/v2/payments",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${encryptedKey}`,
        },
      }
    );

    const redirectLink = data?.data?.payments?.redirectLink;
    if (!redirectLink) {
      return res.status(500).json({
        message: "No redirect link returned",
        response: data,
      });
    }

    await db.collection("payments").doc(paymentReference).set({
      email,
      amount,
      paymentReference,
      status: "Pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ redirectLink, paymentReference });
  } catch (err) {
    console.error("Create Transaction Error:", err.response?.data || err.message);
    res.status(500).json({
      message: "Failed to create UBA transaction",
      error: err.response?.data || err.message,
    });
  }
});

// ------------------------------------------------------
// 3️⃣ UBA WEBHOOK HANDLER
app.post("/uba-webhook", async (req, res) => {
  try {
    const { paymentReference, code } = req.body;

    if (!paymentReference)
      return res.status(400).send("Missing paymentReference");

    await db.collection("payments").doc(paymentReference).update({
      status: code === "00" ? "Completed" : "Failed",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).send("Webhook processed");
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(500).send("Error processing webhook");
  }
});

// ⭐ EXPORT API (v2 FORMAT WITH SECRETS)
exports.api = onRequest(
  {
    secrets: [PUBLIC_KEY, SECRET_KEY]
  },
  app
);
