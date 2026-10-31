import { db } from "./firebaseAdmin.js"; // Firebase Admin SDK
import fetch from "node-fetch";

/**
 * Helper: Generate unique transaction reference
 */
function generateTransactionRef() {
  const merchantId = process.env.SQUAD_MERCHANT_ID || "MERCHANT";
  return `${merchantId}_${Date.now()}`;
}

/**
 * Netlify Function: initShipmentPayment
 */
export async function handler(event) {
  try {
    // 🔒 Allow POST only
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    if (!process.env.SQUAD_SECRET_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Server misconfiguration: SQUAD_SECRET_KEY missing",
        }),
      };
    }

    const body = JSON.parse(event.body);

    const {
      amount,
      currency = "NGN",
      email,
      orderId,
      userId,
    } = body;

    // 🔍 Validation
    if (!amount || !email || !orderId || !userId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Missing required fields",
          required: ["amount", "email", "orderId", "userId"],
          received: body,
        }),
      };
    }

    const transactionRef = generateTransactionRef();

    // console.log(
    //   "🚚 Initializing SHIPMENT payment:",
    //   transactionRef,
    //   "Order:",
    //   orderId,
    //   "User:",
    //   userId
    // );

    /**
     * --------------------------------------------------
     * 1️⃣ Create transaction FIRST (PENDING)
     * --------------------------------------------------
     */
    await db.collection("transactions").doc(transactionRef).set({
      transaction_ref: transactionRef,
      email,
      userId,
      orderId,
      amount: Number(amount),          // NAIRA
      currency,
      paymentType: "shipment",         // 🔑 VERY IMPORTANT
      status: "pending",               // 🔒 webhook will change this
      createdAt: new Date(),
    });

    console.log("💾 Shipment transaction created:", transactionRef);

    /**
     * --------------------------------------------------
     * 2️⃣ Initiate payment with Squad
     * --------------------------------------------------
     */
    const squadResponse = await fetch(
      "https://api-d.squadco.com/transaction/initiate",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.SQUAD_SECRET_KEY}`,
        },
        body: JSON.stringify({
          amount: Number(amount) * 100, // ₦ → kobo
          email,
          currency,
          initiate_type: "inline",
          transaction_ref: transactionRef,
          callback_url: "https://www.importwithbliss.com/payment/callback",
        }),
      }
    );

    const squadData = await squadResponse.json();

    if (!squadResponse.ok) {
      console.error("❌ Squad shipment init failed:", squadData);

      await db.collection("transactions").doc(transactionRef).update({
        status: "failed",
        error: squadData,
      });

      return {
        statusCode: squadResponse.status,
        body: JSON.stringify(squadData),
      };
    }

    /**
     * --------------------------------------------------
     * 3️⃣ Save Squad response (still pending)
     * --------------------------------------------------
     */
    const transactionAmountKobo =
      squadData?.data?.recurring?.transaction_amount ??
      squadData?.data?.transaction_amount ??
      squadData?.transaction_amount ??
      null;

    const transactionAmountNaira =
      transactionAmountKobo !== null
        ? transactionAmountKobo / 100
        : null;

    await db.collection("transactions").doc(transactionRef).update({
      squad_response: squadData,
      transaction_amount_naira: transactionAmountNaira,
    });

    console.log("✅ Shipment payment initialized:", transactionRef);

    /**
     * --------------------------------------------------
     * 4️⃣ Return checkout URL
     * --------------------------------------------------
     */
    return {
      statusCode: 200,
      body: JSON.stringify({
        transaction_ref: transactionRef,
        orderId,
        userId,
        paymentType: "shipment",
        transaction_amount_naira: transactionAmountNaira,
        ...squadData,
      }),
    };
  } catch (error) {
    console.error("🔥 Shipment payment error:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
}
