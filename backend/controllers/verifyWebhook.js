
import { db } from "../firebase.js"; // Firestore
import { verifySquadWebhook } from "./verifyWebhook.js";

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
    const { Event, Data } = json; // Adjust according to Squad payload
    const { transaction_ref, amount, email, orderId } = Data;

    console.log("Webhook Event:", Event, "Transaction Ref:", transaction_ref);

    // Only handle successful charges
    if (Event === "charge_successful") {
      console.log("✅ Charge successful event received!");

      // Update Firestore transaction
      const txRef = db.collection("squad_transactions").doc(transaction_ref);

      await txRef.set(
        {
          transaction_ref,
          orderId: orderId || null,
          email,
          amount,
          status: "paid",
          paidAt: new Date(),
        },
        { merge: true } // merge with existing document if it exists
      );
    }

    // Optional: handle failed charges
    if (Event === "charge_failed") {
      console.log("❌ Charge failed event received!");
      const txRef = db.collection("squad_transactions").doc(transaction_ref);
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
