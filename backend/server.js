// // import express from "express";
// // import cors from "cors";
// // import dotenv from "dotenv";
// // import paymentRoutes from "./routes/payments.js";
// // import bodyParser from "body-parser";

// // dotenv.config();

// // const app = express();
// // app.use(cors());
// // app.use(bodyParser.json());
// // app.use(bodyParser.urlencoded({ extended: true }));

// // // Squad sends webhook as raw body → VERY IMPORTANT
// // app.use("/api/webhook/squad", bodyParser.raw({ type: "*/*" }));

// // app.use("/api/payments", paymentRoutes);

// // app.get("/", (req, res) => {
// //   res.send("Squad Payment Backend Running...");
// // });

// // const PORT = process.env.PORT || 5000;
// // app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));


// import express from "express";
// import bodyParser from "body-parser";
// import dotenv from "dotenv";
// import { squadWebhook } from "./controllers/squadController.js";

// dotenv.config();

// const app = express();

// /**
//  * IMPORTANT
//  * Webhooks must use RAW body (for signature verification)
//  */
// app.post(
//   "/api/webhook/squad",
//   bodyParser.raw({ type: "*/*" }),
//   squadWebhook
// );

// app.get("/", (req, res) => {
//   res.send("Backend is running");
// });

// const PORT = 5000;
// app.listen(PORT, () => {
//   console.log(`Backend running on port ${PORT}`);
// });
// server.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import paymentRoutes from "./routes/payments.js";
import { initPayment, squadWebhook } from "./controllers/squadController.js";
import { db } from "./firebase.js"; // Firestore setup

const app = express();

// ----------------------------
// Middleware
// ----------------------------

// Allow frontend to access backend (replace with your frontend URL in production)
app.use(cors({ origin: "http://localhost:3000" }));

// JSON body parser for normal routes
app.use(bodyParser.json());

// ----------------------------
// Webhook route (Squad sends raw body)
// ----------------------------
// Squad expects raw body for signature verification
app.post(
  "/api/squad/webhook",
  bodyParser.raw({ type: "application/json" }),
  squadWebhook
);

// ----------------------------
// Payment routes
// ----------------------------
app.use("/api/payments", paymentRoutes);

// ----------------------------
// Optional: Verify transaction by reference
// ----------------------------
app.get("/api/transactions/verify/:ref", async (req, res) => {
  try {
    const { ref } = req.params;
    const txDoc = await db.collection("squad_transactions").doc(ref).get();

    if (!txDoc.exists) return res.status(404).json({ status: "not_found" });

    res.json({ status: txDoc.data().status, data: txDoc.data() });
  } catch (err) {
    console.error("Error verifying transaction:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----------------------------
// Root endpoint
// ----------------------------
app.get("/", (req, res) => res.send("Backend running"));

// ----------------------------
// Start server
// ----------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));

