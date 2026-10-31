// import admin from "firebase-admin";
// import fetch from "node-fetch";

// // -------------------- Initialize Firebase Admin --------------------
// // if (!admin.apps.length) {
// //   admin.initializeApp({
// //     credential: admin.credential.cert({
// //       projectId: process.env.FIREBASE_PROJECT_ID,
// //       clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
// //       privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
// //     }),
// //   });
// // }

// // const db = admin.firestore();

// // -------------------- Helper: Generate unique transaction reference --------------------
// function generateTransactionRef() {
//   const merchantId = process.env.SQUAD_MERCHANT_ID || "MERCHANT"; // set in env
//   return `${merchantId}_${Date.now()}`;
// }

// // -------------------- Netlify Function --------------------
// export async function handler(event) {

//   console.log("==== ENV DEBUG START ====");
//   console.log("NODE_ENV:", process.env.NODE_ENV);
//   console.log("SQUAD_SECRET_KEY exists:", !!process.env.SQUAD_SECRET_KEY);
//   console.log("SQUAD_SECRET_KEY length:", process.env.SQUAD_SECRET_KEY?.length || 0);
//   console.log(
//     "SQUAD_SECRET_KEY prefix:",
//     process.env.SQUAD_SECRET_KEY
//       ? process.env.SQUAD_SECRET_KEY.slice(0, 4)
//       : "MISSING"
//   );
//   console.log("SQUAD_MERCHANT_ID:", process.env.SQUAD_MERCHANT_ID || "MISSING");
//   console.log("==== ENV DEBUG END ====");

//   try {
//     if (event.httpMethod !== "POST") {
//       return { statusCode: 405, body: "Method Not Allowed" };
//     }

//     const body = JSON.parse(event.body);

//     const amount = body.amount;
//     const currency = body.currency || "NGN";
//     const email = body.email;

//     if (!amount || !email) {
//       return {
//         statusCode: 400,
//         body: JSON.stringify({
//           error: "Missing required fields",
//           received: body,
//         }),
//       };
//     }

//     // -------------------- Squad Payment Initiation --------------------
//     const transactionRef = body.transaction_ref || generateTransactionRef();

//     const squadResponse = await fetch(
//       "https://api-d.squadco.com/transaction/initiate", // ✅ Production endpoint
//       {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           Authorization: `Bearer ${process.env.SQUAD_SECRET_KEY}`, // ✅ Live secret key
//         },
//         body: JSON.stringify({
//           amount,                       // integer in kobo (₦100.00 = 10000)
//           email,                        // customer email
//           currency,                     // "NGN"
//           initiate_type: "inline",      // required
//           transaction_ref: transactionRef,
//           callback_url: "https://www.importwithbliss.com/payment-success",
//         }),
//       }
//     );

//     const squadData = await squadResponse.json();

//     // -------------------- Save transaction to Firestore --------------------
//     // await db.collection("transactions").add({
//     //   amount,
//     //   currency,
//     //   email,
//     //   transaction_ref: transactionRef,
//     //   squad_response: squadData,
//     //   status: "initiated",
//     //   createdAt: admin.firestore.FieldValue.serverTimestamp(),
//     // });

//     return {
//       statusCode: squadResponse.status,
//       body: JSON.stringify(squadData),
//     };
//   } catch (error) {
//     console.error("Payment API error:", error);
//     return {
//       statusCode: 500,
//       body: JSON.stringify({ error: error.message }),
//     };
//   }
// }

// import admin from "firebase-admin";
// import fetch from "node-fetch";

// /**
//  * ======================================================
//  * Initialize Firebase Admin (SAFE for Netlify)
//  * Uses BASE64 encoded service account JSON
//  * ======================================================
//  */
// if (!admin.apps.length) {
//   if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
//     throw new Error("FIREBASE_SERVICE_ACCOUNT env var is missing");
//   }

//   const serviceAccount = JSON.parse(
//     Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, "base64").toString("utf8")
//   );

//   admin.initializeApp({
//     credential: admin.credential.cert(serviceAccount),
//   });
// }

// const db = admin.firestore();

// /**
//  * ======================================================
//  * Helper: Generate unique transaction reference
//  * ======================================================
//  */
// function generateTransactionRef() {
//   const merchantId = process.env.SQUAD_MERCHANT_ID || "MERCHANT";
//   return `${merchantId}_${Date.now()}`;
// }

// /**
//  * ======================================================
//  * Netlify Function
//  * ======================================================
//  */
// export async function handler(event) {
//   /**
//    * -------- ENV DEBUG (SAFE LOGGING) --------
//    * Remove or comment out in production
//    */
//   console.log("==== ENV DEBUG START ====");
//   console.log("NODE_ENV:", process.env.NODE_ENV);
//   console.log("SQUAD_SECRET_KEY exists:", !!process.env.SQUAD_SECRET_KEY);
//   console.log(
//     "SQUAD_SECRET_KEY prefix:",
//     process.env.SQUAD_SECRET_KEY
//       ? process.env.SQUAD_SECRET_KEY.slice(0, 4)
//       : "MISSING"
//   );
//   console.log("SQUAD_MERCHANT_ID:", process.env.SQUAD_MERCHANT_ID || "MISSING");
//   console.log("==== ENV DEBUG END ====");

//   try {
//     if (event.httpMethod !== "POST") {
//       return {
//         statusCode: 405,
//         body: "Method Not Allowed",
//       };
//     }

//     if (!process.env.SQUAD_SECRET_KEY) {
//       return {
//         statusCode: 500,
//         body: JSON.stringify({
//           error: "Server misconfiguration: SQUAD_SECRET_KEY missing",
//         }),
//       };
//     }

//     const body = JSON.parse(event.body);

//     const amount = body.amount;
//     const currency = body.currency || "NGN";
//     const email = body.email;

//     if (!amount || !email) {
//       return {
//         statusCode: 400,
//         body: JSON.stringify({
//           error: "Missing required fields",
//           received: body,
//         }),
//       };
//     }

//     /**
//      * -------- Squad Payment Initiation --------
//      */
//     const transactionRef =
//       body.transaction_ref || generateTransactionRef();

//     const squadResponse = await fetch(
//       "https://api-d.squadco.com/transaction/initiate",
//       {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           Authorization: `Bearer ${process.env.SQUAD_SECRET_KEY}`,
//         },
//         body: JSON.stringify({
//           amount: Number(amount) * 100, // convert ₦ → kobo
//           email,
//           currency,
//           initiate_type: "inline",
//           transaction_ref: transactionRef,
//           callback_url: "https://www.importwithbliss.com/payment-success",
//         }),
//       }
//     );

//     const squadData = await squadResponse.json();

//     /**
//      * -------- Save transaction to Firestore --------
//      */
//     await db.collection("transactions").add({
//       amount: Number(amount),
//       currency,
//       email,
//       transaction_ref: transactionRef,
//       squad_response: squadData,
//       status: "initiated",
//       createdAt: admin.firestore.FieldValue.serverTimestamp(),
//     });

//     return {
//       statusCode: squadResponse.status,
//       body: JSON.stringify(squadData),
//     };
//   } catch (error) {
//     console.error("Payment API error:", error);

//     return {
//       statusCode: 500,
//       body: JSON.stringify({
//         error: error.message,
//       }),
//     };
//   }
import { db } from "./firebaseAdmin.js"; // Admin SDK
import fetch from "node-fetch";

/**
 * Helper: Generate unique transaction reference
 */
function generateTransactionRef() {
  const merchantId = process.env.SQUAD_MERCHANT_ID || "MERCHANT";
  return `${merchantId}_${Date.now()}`;
}

/**
 * Netlify Function: initPayment
 */
export async function handler(event) {
  try {
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
    const { amount, currency = "NGN", email, orderId, userId } = body;

    if (!amount || !email) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Missing required fields",
          received: body,
        }),
      };
    }

    const transactionRef = generateTransactionRef();
    console.log(
      "🧾 Creating transaction:",
      transactionRef,
      "linked to order:",
      orderId,
      "userId:",
      userId
    );

    /**
     * --------------------------------------------------
     * 1️⃣ Create transaction in Firestore FIRST (pending)
     * --------------------------------------------------
     */
    await db.collection("transactions").doc(transactionRef).set({
      transaction_ref: transactionRef,
      email,
      userId: userId || null,    // optional
      orderId: orderId || null,  // link to Firestore order
      amount: Number(amount),    // store in NAIRA (not kobo)
      currency,
      status: "pending",         // 🔒 VERY IMPORTANT
      createdAt: new Date(),
    });

    console.log("💾 Transaction created in Firestore:", transactionRef);

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
          amount: Number(amount) * 100, // convert ₦ → kobo for Squad
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
      console.error("❌ Squad payment initiation failed", squadData);
      // mark transaction as failed
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
     * 3️⃣ Save Squad response to Firestore (still pending)
     * --------------------------------------------------
     */
    const transactionAmountKobo =
      squadData?.data?.recurring?.transaction_amount ??
      squadData?.data?.transaction_amount ??
      squadData?.transaction_amount ??
      null;

    const transactionAmountNaira =
      transactionAmountKobo !== null ? transactionAmountKobo / 100 : null;

    await db.collection("transactions").doc(transactionRef).update({
      squad_response: squadData,
      transaction_amount_naira: transactionAmountNaira, // normalized for clarity
    });

    console.log("✅ Squad response saved for transaction:", transactionRef);

    return {
      statusCode: 200,
      body: JSON.stringify({
        transaction_ref: transactionRef,
        orderId: orderId || null,
        userId: userId || null,
        transaction_amount_naira: transactionAmountNaira,
        ...squadData,
      }),
    };
  } catch (error) {
    console.error("🔥 Payment API error:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
}