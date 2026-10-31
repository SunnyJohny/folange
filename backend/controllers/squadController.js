// import axios from "axios";
// import dotenv from "dotenv";
// import verifySquadWebhook from "../utils/verifyWebhook.js";

// dotenv.config();

// // INITIATE PAYMENT -----------------------------------
// export const initPayment = async (req, res) => {
//   try {
//     const { amount, email } = req.body;

//     const payload = {
//       amount,
//       email,
//       currency: "NGN",
//       transaction_ref: "TX-" + Date.now(),
//       callback_url: "https://your-frontend.com/verify"
//     };

//     const response = await axios.post(
//       "https://sandbox-api-d.squadco.com/transaction/initiate",
//       payload,
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.SQUAD_SECRET_KEY}`,
//           "Content-Type": "application/json"
//         }
//       }
//     );

//     res.json(response.data);
//   } catch (err) {
//     console.error(err.response?.data || err);
//     res.status(500).json({ error: "Payment initialization failed" });
//   }
// };

// // VERIFY TRANSACTION -----------------------------------
// export const verifyTransaction = async (req, res) => {
//   try {
//     const { reference } = req.body;

//     const response = await axios.get(
//       `https://sandbox-api-d.squadco.com/transaction/verify/${reference}`,
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.SQUAD_SECRET_KEY}`
//         }
//       }
//     );

//     const data = response.data;

//     return res.json(data);
//   } catch (err) {
//     console.error(err.response?.data || err);
//     res.status(500).json({ error: "Transaction verification failed" });
//   }
// };

// // WEBHOOK -----------------------------------
// export const squadWebhook = async (req, res) => {
//   try {
//     const signature = req.headers["x-squad-encrypted-body"];
//     const rawBody = req.body.toString();  // ensure raw

//     const isValid = verifySquadWebhook(rawBody, signature);

//     if (!isValid) return res.status(401).send("Invalid webhook signature");

//     const json = JSON.parse(rawBody);

//     console.log("💬 WEBHOOK RECEIVED:", json);

//     res.status(200).send("Webhook received");
//   } catch (error) {
//     console.error("WEBHOOK ERROR:", error);
//     res.status(400).send("Webhook processing failed");
//   }
// };

// import { db } from "../firebase.js";
// import { doc, collection, getDocs, query, where, updateDoc } from "firebase/firestore";
// import verifySquadWebhook from "../utils/verifyWebhook.js";


// export const squadWebhook = async (req, res) => {
//   console.log("🔥 SQUAD WEBHOOK HIT");

//   try {
//     const signature = req.headers["x-squad-encrypted-body"];
//     const rawBody = req.body.toString();

//     console.log("📦 Raw Body:", rawBody);
//     console.log("🔐 Signature:", signature);

//     // Verify webhook
//     const isValid = verifySquadWebhook(rawBody, signature);
//     if (!isValid) {
//       console.warn("⚠️ Invalid webhook signature");
//       return res.status(400).send("Invalid signature");
//     }

//     const payload = JSON.parse(rawBody);

//     if (payload.Event === "charge_successful") {
//       const transactionRef = payload.TransactionRef;

//       // Query Firestore to find the order with this payment reference
//       const ordersRef = collection(db, "orders");
//       const q = query(ordersRef, where("paymentReference", "==", transactionRef));
//       const orderSnap = await getDocs(q);

//       if (!orderSnap.empty) {
//         // Update each matching order
//         orderSnap.forEach(async (docSnap) => {
//           await updateDoc(docSnap.ref, {
//             paymentStatus: "Paid",
//             orderStatus: "Confirmed",
//             paymentResponse: payload.Body || {},
//           });
//         });
//         console.log(`✅ Order with reference ${transactionRef} marked as Paid`);
//       } else {
//         console.warn(`⚠️ No order found with reference ${transactionRef}`);
//       }
//     }

//     res.status(200).send("Webhook processed");
//   } catch (error) {
//     console.error("WEBHOOK ERROR:", error);
//     res.status(500).send("Webhook failed");
//   }
// };

// controllers/squadController.js
import fetch from "node-fetch"; // or native fetch if using Node 18+
import crypto from "crypto";
import { db } from "../firebase.js"; // Firestore
// import { verifySquadWebhook } from "../utils/verifyWebhook.js";

// ----------------------------
// INIT PAYMENT
// ----------------------------
export const initPayment = async (req, res) => {
  try {
    const { amount, email, orderId } = req.body;

    // Generate a unique transaction reference
    const transaction_ref = crypto.randomBytes(10).toString("hex");

    // Build the payload for Squad API
    const payload = {
  amount, // already in kobo
  email,
  currency: "NGN",
  initiate_type: "inline",
  transaction_ref,
  callback_url: "https://www.importwithbliss.com/payment/callback",
};


    // Call Squad sandbox API
    const response = await fetch(
      "https://sandbox-api-d.squadco.com/transaction/initiate",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            "sk_e55177d7d34e3825e4820485ded0d90eac363da3", // your sandbox key
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Squad API error:", data);
      return res.status(response.status).json(data);
    }

    // Store transaction in new collection: squad_transactions
    await db.collection("squad_transactions").doc(transaction_ref).set({
      transaction_ref,
      orderId: orderId || null,
      email,
      amount,
      currency: "NGN",
      status: "pending",
      createdAt: new Date(),
    });

    // Determine checkout URL
    const checkoutUrl =
      data.data?.checkout_url || `https://sandbox-api-d.squadco.com/checkout/${transaction_ref}`;

    // Send response to frontend
    res.json({
      paymentReference: transaction_ref,
      checkoutUrl,
      rawResponse: data,
    });
  } catch (err) {
    console.error("Init Payment Error:", err);
    res.status(500).json({ error: "Payment initialization failed" });
  }
};

// ----------------------------
// SQUAD WEBHOOK
// ----------------------------
export const squadWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-squad-encrypted-body"];
    const rawBody = req.body.toString();

    console.log("🔥 Incoming Webhook! 🔥");
    console.log("Headers:", req.headers);
    console.log("Raw Body:", rawBody);

    // Validate webhook signature
    const isValid = verifySquadWebhook(rawBody, signature);
    if (!isValid) {
      console.log("❌ Webhook signature invalid!");
      return res.status(401).send("Invalid webhook signature");
    }

    const json = JSON.parse(rawBody);
    const { Event, Data } = json;
    const { transaction_ref, amount, email, orderId } = Data;

    console.log("Webhook Event:", Event, "Transaction Ref:", transaction_ref);

    const txRef = db.collection("squad_transactions").doc(transaction_ref);

    // Handle successful charges
    if (Event === "charge_successful") {
      await txRef.set(
        {
          transaction_ref,
          orderId: orderId || null,
          email,
          amount,
          status: "paid",
          paidAt: new Date(),
        },
        { merge: true }
      );
    }

    // Handle failed charges
    if (Event === "charge_failed") {
      await txRef.set(
        {
          transaction_ref,
          status: "failed",
          updatedAt: new Date(),
        },
        { merge: true }
      );
    }

    res.status(200).send("Webhook received");
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.status(400).send("Webhook processing failed");
  }
};
