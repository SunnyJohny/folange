// import express from "express";
// import { initPayment, verifyTransaction, squadWebhook } from "../controllers/squadController.js";

// const router = express.Router();

// router.post("/init", initPayment);
// router.post("/verify", verifyTransaction);
// router.post("/webhook/squad", squadWebhook);

// export default router;


import express from "express";
import { initPayment } from "../controllers/squadController.js";

const router = express.Router();

router.post("/init", initPayment);

export default router;
