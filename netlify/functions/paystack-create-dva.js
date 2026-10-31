// netlify/functions/paystack-create-dva.js

// netlify/functions/paystack-create-dva.js
const crypto = require("crypto");

// CHAREX-only Firestore records. Never fall back to another app's collections.
const CHAREX_ROOT_PATH = "charex/main";
const CHAREX_ASSIGNMENTS_COLLECTION = CHAREX_ROOT_PATH + "/paystackDvaAssignments";
const CHAREX_TRANSACTIONS_COLLECTION = CHAREX_ROOT_PATH + "/paystack_transactions";

const PAYSTACK_BASE_URL = "https://api.paystack.co";
let admin = null;
// ============================================================
// RESPONSE HELPER
// ============================================================
const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  },
  body: JSON.stringify(body),
});
// ============================================================
// GENERAL HELPERS
// ============================================================
const cleanString = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};
const normalizeEmail = (value) => {
  return cleanString(value).toLowerCase();
};
const normalizeNigerianPhone = (value) => {
  let phone = cleanString(value).replace(/\s+/g, "");
  phone = phone.replace(/[-()]/g, "");
  // 08012345678 -> +2348012345678
  if (/^0\d{10}$/.test(phone)) {
    return `+234${phone.slice(1)}`;
  }
  // 2348012345678 -> +2348012345678
  if (/^234\d{10}$/.test(phone)) {
    return `+${phone}`;
  }
  // Already international
  if (/^\+234\d{10}$/.test(phone)) {
    return phone;
  }
  return phone;
};
const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};
const isValidNigerianPhone = (phone) => {
  return /^\+234\d{10}$/.test(phone);
};
const toNumberAmount = (value) => {
  if (value === undefined || value === null) return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};
const roundAmount = (value) => {
  const amount = toNumberAmount(value);
  return Math.round(amount * 100) / 100;
};
const safeDocId = (value) => {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
};
// ============================================================
// FIREBASE ADMIN
//
// Same environment variable structure already used by
// query-inflow\\.js.
//
// FIREBASE_PROJECT_ID
// FIREBASE_CLIENT_EMAIL
// FIREBASE_PRIVATE_KEY
// ============================================================
function initFirebaseAdminIfAvailable() {
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (!projectId || !clientEmail || !privateKey) {
      return null;
    }
    if (!admin) {
      admin = require("firebase-admin");
    }
    if (admin.apps?.length) {
      return admin;
    }
    privateKey = String(privateKey).replace(/\\n/g, "\n");
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
    return admin;
  } catch (error) {
    console.warn("Firebase Admin init failed:", error?.message || error);
    return null;
  }
}
// ============================================================
// PAYMENT SECTION HELPERS
//
// Existing CHAREX structure:
//
// order
//   -> payment
//
// shipment
//   -> shipmentPayment.payment
//
// balance
//   -> balancePayment.payment
// ============================================================
function getPaymentForMode(order, mode) {
  if (mode === "shipment") {
    return order?.shipmentPayment?.payment || {};
  }
  if (mode === "balance") {
    return order?.balancePayment?.payment || {};
  }
  return order?.payment || {};
}
function getSectionForMode(order, mode) {
  if (mode === "shipment") {
    return order?.shipmentPayment || {};
  }
  if (mode === "balance") {
    return order?.balancePayment || {};
  }
  return order || {};
}
function getPaidTotalForMode(order, mode) {
  const payment = getPaymentForMode(order, mode);
  const section = getSectionForMode(order, mode);
  const values = [
    section?.amountPaid,
    payment?.amountPaid,
    payment?.inflow?.paidTotal,
    payment?.inflow?.amount,
    payment?.inflow?.amountPaid,
    payment?.inflow?.["amount paid"],
  ]
    .map(toNumberAmount)
    .filter((v) => Number.isFinite(v) && v >= 0);
  return values.length ? Math.max(...values) : 0;
}
function getObligationTotalForMode(order, mode) {
  const payment = getPaymentForMode(order, mode);
  const section = getSectionForMode(order, mode);
  const candidates =
    mode === "order"
      ? [
          order?.payableTotal,
          payment?.payableTotal,
          payment?.amount,
          payment?.inflow?.expected,
        ]
      : [
          section?.payableTotal,
          section?.amount,
          payment?.payableTotal,
          payment?.amount,
          payment?.inflow?.expected,
        ];
  const values = candidates
    .map(toNumberAmount)
    .filter((v) => Number.isFinite(v) && v > 0);
  return values.length ? Math.max(...values) : 0;
}
// ============================================================
// BUILD FIRESTORE PATCH
// ============================================================
function buildPendingPaymentPatch({
  order,
  mode,
  paymentReference,
  amount,
  obligationTotal,
  outstandingBefore,
  email,
  phone,
  preferredBank,
  assignmentKey,
  serverTimestamp,
}) {
  const existingPayment = getPaymentForMode(order, mode);
  const existingSection = getSectionForMode(order, mode);
  const paystackPayment = {
    ...existingPayment,
    provider: "PAYSTACK_DVA",
    paymentReference:
      paymentReference ||
      existingPayment?.paymentReference ||
      existingPayment?.reference ||
      null,
    reference:
      paymentReference ||
      existingPayment?.reference ||
      existingPayment?.paymentReference ||
      null,
    amount: obligationTotal,
    expectedAmount: obligationTotal,
    state: "assignment_pending",
    status: "assignment_pending",
    paystack: {
      ...(existingPayment?.paystack || {}),
      assignmentKey,
      paymentIntentAmount: amount,
      obligationTotal,
      outstandingBefore,
      assignmentStatus: "pending",
      email,
      phone,
      preferredBank,
      customerId: null,
      customerCode: null,
      dedicatedAccountId: null,
      accountNumber: null,
      accountName: null,
      bankName: null,
      bankSlug: null,
      currency: "NGN",
      assigned: false,
      active: false,
      requestedAt: serverTimestamp,
      assignedAt: null,
      lastWebhookEvent: null,
    },
  };
  if (mode === "shipment") {
    return {
      shipmentPayment: {
        ...existingSection,
        enabled: true,
        state: "assignment_pending",
        payment: paystackPayment,
      },
    };
  }
  if (mode === "balance") {
    return {
      balancePayment: {
        ...existingSection,
        enabled: true,
        state: "assignment_pending",
        payment: paystackPayment,
      },
    };
  }
  return {
    payment: paystackPayment,
  };
}
// ============================================================
// NETLIFY FUNCTION
// ============================================================
exports.handler = async (event) => {
  // ==========================================================
  // CORS PREFLIGHT
  // ==========================================================
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }
  // ==========================================================
  // METHOD GUARD
  // ==========================================================
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, {
      success: false,
      message: "Method not allowed. Use POST.",
    });
  }
  // ==========================================================
  // PAYSTACK SECRET KEY
  // ==========================================================
  const secretKey = cleanString(process.env.PAYSTACK_SECRET_KEY);
  if (!secretKey) {
    console.error("PAYSTACK_SECRET_KEY is missing from Netlify environment variables.");
    return jsonResponse(500, {
      success: false,
      message: "Paystack has not been configured on the server.",
    });
  }
  // ==========================================================
  // PARSE REQUEST BODY
  // ==========================================================
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (error) {
    return jsonResponse(400, {
      success: false,
      message: "Invalid request body.",
    });
  }
  // ==========================================================
  // CUSTOMER DETAILS
  // ==========================================================
  const email = normalizeEmail(body?.email);
  const firstName = cleanString(body?.firstName || body?.first_name);
  const middleName = cleanString(body?.middleName || body?.middle_name);
  const lastName = cleanString(body?.lastName || body?.last_name);
  const phone = normalizeNigerianPhone(
    body?.phone || body?.phoneNumber || body?.phone_number,
  );
  // ==========================================================
  // PAYSTACK PROVIDER
  // ==========================================================
  // The secret key determines Paystack's environment, including under netlify dev.
  // Do not rely on NODE_ENV or a browser-supplied bank to select live/test mode.
  const preferredBank = secretKey.startsWith("sk_test_")
    ? "test-bank"
    : "titan-paystack";
  // ==========================================================
  // CHAREX PAYMENT IDENTITY
  // ==========================================================
  const userId = cleanString(body?.userId);
  const orderId = cleanString(body?.orderId);
  const suppliedOrderPath = cleanString(body?.orderPath);
  const paymentMode = cleanString(
    body?.paymentMode || body?.mode || "order",
  ).toLowerCase();
  const paymentReference = cleanString(body?.paymentReference || body?.reference);
  const amount = roundAmount(body?.amount);
  // ==========================================================
  // BASIC CUSTOMER VALIDATION
  // ==========================================================
  if (!email) {
    return jsonResponse(400, {
      success: false,
      message: "Customer email is required.",
    });
  }
  if (!isValidEmail(email)) {
    return jsonResponse(400, {
      success: false,
      message: "Customer email is invalid.",
    });
  }
  if (!firstName) {
    return jsonResponse(400, {
      success: false,
      message: "Customer first name is required.",
    });
  }
  if (!lastName) {
    return jsonResponse(400, {
      success: false,
      message: "Customer last name is required.",
    });
  }
  if (!phone) {
    return jsonResponse(400, {
      success: false,
      message: "Customer phone number is required.",
    });
  }
  if (!isValidNigerianPhone(phone)) {
    return jsonResponse(400, {
      success: false,
      message: "Please provide a valid Nigerian phone number.",
    });
  }
  if (!preferredBank) {
    return jsonResponse(400, {
      success: false,
      message: "A Paystack preferred bank/provider is required.",
    });
  }
  // ==========================================================
  // PAYMENT MODE VALIDATION
  // ==========================================================
  const allowedPaymentModes = ["order", "shipment", "balance"];
  if (!allowedPaymentModes.includes(paymentMode)) {
    return jsonResponse(400, {
      success: false,
      message: "Invalid payment mode.",
    });
  }
  // ==========================================================
  // ORDER VALIDATION
  //
  // From this point onward Paystack assignment requests must
  // belong to a real CHAREX order.
  // ==========================================================
  if (!userId || !orderId || userId.includes("/") || orderId.includes("/")) {
    return jsonResponse(400, {
      success: false,
      message: "A valid userId and orderId are required for Paystack payment.",
    });
  }
  const canonicalOrderPath = `${CHAREX_ROOT_PATH}/users/${userId}/orders/${orderId}`;
  if (suppliedOrderPath && suppliedOrderPath !== canonicalOrderPath) {
    return jsonResponse(400, {
      success: false,
      message: "The supplied order path does not match the user and order.",
    });
  }
  if (!paymentReference) {
    return jsonResponse(400, {
      success: false,
      message: "A payment reference is required for Paystack payment.",
    });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return jsonResponse(400, {
      success: false,
      message: "A valid payment amount is required for Paystack payment.",
    });
  }
  // ==========================================================
  // FIREBASE ADMIN
  // ==========================================================
  const adminSdk = initFirebaseAdminIfAvailable();
  if (!adminSdk) {
    return jsonResponse(503, {
      success: false,
      message: "Paystack payment preparation is temporarily unavailable.",
    });
  }
  const db = adminSdk.firestore();
  const orderRef = db.doc(canonicalOrderPath);
  // ==========================================================
  // CONFIRM ORDER EXISTS
  // ==========================================================
  let orderSnapshot;
  try {
    orderSnapshot = await orderRef.get();
  } catch (error) {
    console.error("Could not read order before Paystack assignment:", error);
    return jsonResponse(500, {
      success: false,
      message: "Unable to prepare the order for Paystack payment.",
    });
  }
  if (!orderSnapshot.exists) {
    return jsonResponse(404, {
      success: false,
      message: "Order not found. Paystack account assignment was not started.",
    });
  }
  const orderData = orderSnapshot.data() || {};
  // Validate the chosen Paystack amount against Firestore, not the browser.
  const obligationTotal = roundAmount(
    getObligationTotalForMode(orderData, paymentMode),
  );
  const paidTotalBefore = roundAmount(getPaidTotalForMode(orderData, paymentMode));
  const outstandingBefore = roundAmount(Math.max(0, obligationTotal - paidTotalBefore));
  if (obligationTotal <= 0)
    return jsonResponse(400, {
      success: false,
      message: "Unable to determine the payment obligation for this order.",
    });
  if (outstandingBefore <= 0)
    return jsonResponse(409, {
      success: false,
      message: "This payment obligation has already been fully paid.",
    });
  if (amount > outstandingBefore)
    return jsonResponse(400, {
      success: false,
      message: `Payment amount cannot exceed the outstanding balance of ₦${outstandingBefore.toLocaleString("en-NG")}.`,
      outstanding: outstandingBefore,
    });
  // ==========================================================
  // ASSIGNMENT KEY
  //
  // This is OUR internal correlation identity.
  //
  // It is NOT sent to Paystack.
  //
  // The Paystack assignment webhook gives us customer
  // information such as email/customer_code. We maintain
  // our own pending assignment record so that the webhook
  // can safely resolve the correct CHAREX order.
  // ==========================================================
  const assignmentIdentity = [
    userId,
    orderId,
    paymentMode,
    paymentReference,
    email,
    preferredBank,
  ].join("|");
  const assignmentKey = safeDocId(assignmentIdentity);
  const serverTimestamp = adminSdk.firestore.FieldValue.serverTimestamp();
  // ==========================================================
  // CORRELATION INDEX
  //
  // DVA belongs to the Paystack CUSTOMER, not the order.
  //
  // We therefore keep:
  //
  // 1. Payment state inside the existing order structure.
  //
  // 2. A small server-side assignment index that allows the
  //    asynchronous Paystack webhook to find that order.
  //
  // No customer/order information is added to Paystack's
  // documented request payload.
  // ==========================================================
  const assignmentRef = db.collection(CHAREX_ASSIGNMENTS_COLLECTION).doc(assignmentKey);
  // ==========================================================
  // REUSE AN EXISTING ASSIGNED DVA FOR THIS CUSTOMER
  // A Paystack DVA belongs to the customer and is reusable.
  let reusableDva = null;
  try {
    const reusableSnapshot = await db
      .collection(CHAREX_ASSIGNMENTS_COLLECTION)
      .where("customer.email", "==", email)
      .get();
    reusableSnapshot.forEach((docSnapshot) => {
      if (reusableDva) return;
      const value = docSnapshot.data() || {};
      const state = cleanString(
        value.assignmentStatus || value.status || value.state,
      ).toLowerCase();
      const accountNumber = cleanString(value.accountNumber);
      const recordedPreferredBank = cleanString(value.preferredBank).toLowerCase();
      const recordedBankSlug = cleanString(value.bankSlug).toLowerCase();
      const wantedBank = cleanString(preferredBank).toLowerCase();
      // Never reuse a DVA created for a different Paystack provider/environment.
      // In live mode this prevents an old test-bank DVA from being reused.
      if (
        wantedBank &&
        recordedPreferredBank !== wantedBank &&
        recordedBankSlug !== wantedBank
      ) {
        return;
      }
      const wasAssigned =
        accountNumber &&
        (value.assigned === true ||
          state === "assigned" ||
          state === "assignment_success" ||
          cleanString(value.paystackCustomerCode));
      if (!wasAssigned) return;
      reusableDva = {
        sourceAssignmentKey: docSnapshot.id,
        accountNumber,
        accountName: cleanString(value.accountName),
        bankName: cleanString(value.bankName),
        bankSlug: cleanString(value.bankSlug),
        currency: cleanString(value.currency || "NGN") || "NGN",
        paystackCustomerId: value.paystackCustomerId ?? null,
        paystackCustomerCode: cleanString(value.paystackCustomerCode) || null,
        dedicatedAccountId: value.dedicatedAccountId ?? null,
        active: value.active !== false,
      };
    });
  } catch (error) {
    console.error("Could not search for reusable Paystack DVA:", error);
    return jsonResponse(500, {
      success: false,
      message: "Unable to check the customer's existing Paystack account.",
    });
  }
  if (reusableDva) {
    try {
      const existingIntentSnapshot = await db
        .collection(CHAREX_ASSIGNMENTS_COLLECTION)
        .where("customer.email", "==", email)
        .get();
      const batch = db.batch();
      let supersededCount = 0;
      existingIntentSnapshot.forEach((docSnapshot) => {
        if (docSnapshot.id === assignmentKey) return;
        const value = docSnapshot.data() || {};
        const state = cleanString(
          value.status || value.assignmentStatus || value.state,
        ).toLowerCase();
        const paymentStatus = cleanString(
          value.paymentStatus || value.chargeStatus,
        ).toLowerCase();
        const activeUnpaid =
          ["pending", "assignment_pending", "assigned", "assignment_success"].includes(
            state,
          ) &&
          paymentStatus !== "paid" &&
          paymentStatus !== "success";
        if (!activeUnpaid) return;
        batch.set(
          docSnapshot.ref,
          {
            status: "superseded",
            assignmentStatus: "superseded",
            supersededBy: assignmentKey,
            supersededAt: serverTimestamp,
            updatedAt: serverTimestamp,
          },
          { merge: true },
        );
        supersededCount += 1;
      });
      if (supersededCount > 0) await batch.commit();
      await db.runTransaction(async (transaction) => {
        const freshOrderSnapshot = await transaction.get(orderRef);
        if (!freshOrderSnapshot.exists) {
          const error = new Error("Order not found.");
          error.statusCode = 404;
          throw error;
        }
        const freshOrder = freshOrderSnapshot.data() || {};
        const existingPayment = getPaymentForMode(freshOrder, paymentMode);
        const existingSection = getSectionForMode(freshOrder, paymentMode);
        const reusedPayment = {
          ...existingPayment,
          provider: "PAYSTACK_DVA",
          paymentReference,
          reference: paymentReference,
          amount: obligationTotal,
          expectedAmount: obligationTotal,
          state: "awaiting_payment",
          status: "Awaiting Payment",
          assignmentStatus: "assigned",
          assignmentKey,
          accountNumber: reusableDva.accountNumber,
          accountName: reusableDva.accountName || "CHAREX Customer",
          bankName: reusableDva.bankName || "Paystack",
          bankSlug: reusableDva.bankSlug || "",
          currency: reusableDva.currency,
          paystackCustomerId: reusableDva.paystackCustomerId,
          paystackCustomerCode: reusableDva.paystackCustomerCode,
          paystackDvaId: reusableDva.dedicatedAccountId,
          assigned: true,
          active: reusableDva.active,
          assignedAt: serverTimestamp,
          updatedAt: serverTimestamp,
          paystack: {
            ...(existingPayment?.paystack || {}),
            assignmentKey,
            sourceAssignmentKey: reusableDva.sourceAssignmentKey,
            paymentIntentAmount: amount,
            obligationTotal,
            outstandingBefore,
            assignmentStatus: "assigned",
            email,
            phone,
            preferredBank,
            customerId: reusableDva.paystackCustomerId,
            customerCode: reusableDva.paystackCustomerCode,
            dedicatedAccountId: reusableDva.dedicatedAccountId,
            accountNumber: reusableDva.accountNumber,
            accountName: reusableDva.accountName || "CHAREX Customer",
            bankName: reusableDva.bankName || "Paystack",
            bankSlug: reusableDva.bankSlug || "",
            currency: reusableDva.currency,
            assigned: true,
            active: reusableDva.active,
            assignedAt: serverTimestamp,
            lastWebhookEvent: "reused_existing_dva",
            updatedAt: serverTimestamp,
          },
        };
        let paymentPatch;
        if (paymentMode === "shipment") {
          paymentPatch = {
            shipmentPayment: {
              ...existingSection,
              enabled: true,
              state: "awaiting_payment",
              payment: reusedPayment,
            },
          };
        } else if (paymentMode === "balance") {
          paymentPatch = {
            balancePayment: {
              ...existingSection,
              enabled: true,
              state: "awaiting_payment",
              payment: reusedPayment,
            },
          };
        } else {
          paymentPatch = { payment: reusedPayment };
        }
        transaction.set(
          orderRef,
          { ...paymentPatch, updatedAt: serverTimestamp },
          { merge: true },
        );
        transaction.set(
          assignmentRef,
          {
            assignmentKey,
            provider: "PAYSTACK_DVA",
            status: "assigned",
            assignmentStatus: "assigned",
            userId,
            orderId,
            orderPath: canonicalOrderPath,
            paymentMode,
            paymentReference,
            expectedAmount: amount,
            paymentIntentAmount: amount,
            obligationTotal,
            paidTotalBefore,
            outstandingBefore,
            customer: {
              email,
              firstName,
              middleName: middleName || null,
              lastName,
              phone,
            },
            preferredBank,
            paystackCustomerId: reusableDva.paystackCustomerId,
            paystackCustomerCode: reusableDva.paystackCustomerCode,
            dedicatedAccountId: reusableDva.dedicatedAccountId,
            accountNumber: reusableDva.accountNumber,
            accountName: reusableDva.accountName || null,
            bankName: reusableDva.bankName || null,
            bankSlug: reusableDva.bankSlug || null,
            currency: reusableDva.currency,
            assigned: true,
            active: reusableDva.active,
            sourceAssignmentKey: reusableDva.sourceAssignmentKey,
            createdAt: serverTimestamp,
            assignedAt: serverTimestamp,
            completedAt: serverTimestamp,
            updatedAt: serverTimestamp,
            lastWebhookEvent: "reused_existing_dva",
          },
          { merge: true },
        );
      });
      console.log("Reused existing Paystack DVA for new payment intent:", {
        userId,
        orderId,
        orderPath: canonicalOrderPath,
        paymentMode,
        paymentReference,
        amount,
        obligationTotal,
        outstandingBefore,
        assignmentKey,
        sourceAssignmentKey: reusableDva.sourceAssignmentKey,
        accountNumber: reusableDva.accountNumber,
      });
      return jsonResponse(200, {
        success: true,
        provider: "paystack",
        status: "assigned",
        message: "Existing Paystack dedicated account reused.",
        reused: true,
        data: {
          account_number: reusableDva.accountNumber,
          account_name: reusableDva.accountName || "CHAREX Customer",
          bank: {
            name: reusableDva.bankName || "Paystack",
            slug: reusableDva.bankSlug || "",
          },
          currency: reusableDva.currency,
        },
        checkout: {
          userId,
          orderId,
          orderPath: canonicalOrderPath,
          paymentMode,
          paymentReference,
          amount,
          paymentIntentAmount: amount,
          obligationTotal,
          paidTotalBefore,
          outstandingBefore,
          assignmentKey,
        },
      });
    } catch (error) {
      console.error("Could not reuse existing Paystack DVA:", error);
      return jsonResponse(error?.statusCode || 500, {
        success: false,
        provider: "paystack",
        message: error?.message || "Unable to reuse the existing Paystack account.",
      });
    }
  }
  // ==========================================================
  // PREPARE PAYSTACK REQUEST
  //
  // Official single-step DVA assignment fields:
  //
  // email
  // first_name
  // middle_name (optional)
  // last_name
  // phone
  // preferred_bank
  // country
  //
  // CHAREX order fields are NOT sent to Paystack.
  // ==========================================================
  const paystackPayload = {
    email,
    first_name: firstName,
    last_name: lastName,
    phone,
    preferred_bank: preferredBank,
    country: "NG",
  };
  if (middleName) {
    paystackPayload.middle_name = middleName;
  }
  // Keep exactly one active unpaid Paystack intent per customer.
  // Old intents remain in Firestore for audit, but cannot receive a new charge.
  try {
    const existingIntentSnapshot = await db
      .collection(CHAREX_ASSIGNMENTS_COLLECTION)
      .where("customer.email", "==", email)
      .get();
    const batch = db.batch();
    let count = 0;
    existingIntentSnapshot.forEach((doc) => {
      if (doc.id === assignmentKey) return;
      const value = doc.data() || {};
      const state = cleanString(
        value.status || value.assignmentStatus || value.state,
      ).toLowerCase();
      const paymentStatus = cleanString(
        value.paymentStatus || value.chargeStatus,
      ).toLowerCase();
      const activeUnpaid =
        ["pending", "assignment_pending", "assigned", "assignment_success"].includes(
          state,
        ) &&
        paymentStatus !== "paid" &&
        paymentStatus !== "success";
      if (!activeUnpaid) return;
      batch.set(
        doc.ref,
        {
          status: "superseded",
          assignmentStatus: "superseded",
          supersededBy: assignmentKey,
          supersededAt: serverTimestamp,
          updatedAt: serverTimestamp,
        },
        { merge: true },
      );
      count += 1;
    });
    if (count > 0) await batch.commit();
  } catch (error) {
    console.error("Could not supersede older Paystack payment intents:", error);
    return jsonResponse(500, {
      success: false,
      message: "Unable to prepare a safe Paystack payment intent.",
    });
  }
  // ==========================================================
  // SAVE PENDING STATE BEFORE CALLING PAYSTACK
  //
  // This must happen BEFORE the API call because Paystack may
  // deliver the webhook very quickly.
  // ==========================================================
  try {
    await db.runTransaction(async (transaction) => {
      const freshOrderSnapshot = await transaction.get(orderRef);
      if (!freshOrderSnapshot.exists) {
        const error = new Error("Order not found.");
        error.statusCode = 404;
        throw error;
      }
      const freshOrder = freshOrderSnapshot.data() || {};
      const paymentPatch = buildPendingPaymentPatch({
        order: freshOrder,
        mode: paymentMode,
        paymentReference,
        amount,
        obligationTotal,
        outstandingBefore,
        email,
        phone,
        preferredBank,
        assignmentKey,
        serverTimestamp,
      });
      transaction.set(
        orderRef,
        {
          ...paymentPatch,
          updatedAt: serverTimestamp,
        },
        {
          merge: true,
        },
      );
      transaction.set(
        assignmentRef,
        {
          assignmentKey,
          provider: "PAYSTACK_DVA",
          status: "pending",
          userId,
          orderId,
          orderPath: canonicalOrderPath,
          paymentMode,
          paymentReference,
          expectedAmount: amount,
          paymentIntentAmount: amount,
          obligationTotal,
          paidTotalBefore,
          outstandingBefore,
          customer: {
            email,
            firstName,
            middleName: middleName || null,
            lastName,
            phone,
          },
          preferredBank,
          paystackCustomerId: null,
          paystackCustomerCode: null,
          dedicatedAccountId: null,
          accountNumber: null,
          accountName: null,
          bankName: null,
          bankSlug: null,
          currency: "NGN",
          assigned: false,
          active: false,
          createdAt: serverTimestamp,
          updatedAt: serverTimestamp,
          assignedAt: null,
          lastWebhookEvent: null,
        },
        {
          merge: true,
        },
      );
    });
  } catch (error) {
    console.error("Could not save pending Paystack assignment:", error);
    return jsonResponse(error?.statusCode || 500, {
      success: false,
      provider: "paystack",
      message: error?.message || "Unable to prepare Paystack payment.",
    });
  }
  // ==========================================================
  // CALL PAYSTACK
  // ==========================================================
  try {
    console.log("Creating Paystack DVA assignment:", {
      email,
      firstName,
      lastName,
      phone,
      preferredBank,
      userId,
      orderId,
      orderPath: canonicalOrderPath,
      paymentMode,
      paymentReference,
      amount,
      assignmentKey,
    });
    const response = await fetch(`${PAYSTACK_BASE_URL}/dedicated_account/assign`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paystackPayload),
    });
    let paystackResponse;
    try {
      paystackResponse = await response.json();
    } catch (error) {
      console.error("Could not parse Paystack response:", error);
      // Mark the local assignment as failed/unreadable.
      await assignmentRef.set(
        {
          status: "request_failed",
          failureReason: "Paystack returned an unreadable response.",
          updatedAt: adminSdk.firestore.FieldValue.serverTimestamp(),
        },
        {
          merge: true,
        },
      );
      return jsonResponse(502, {
        success: false,
        provider: "paystack",
        message: "Paystack returned an unreadable response.",
      });
    }
    // ========================================================
    // PAYSTACK ERROR
    // ========================================================
    if (!response.ok || paystackResponse?.status !== true) {
      console.error("Paystack DVA assignment failed:", paystackResponse);
      const failureMessage =
        paystackResponse?.message ||
        "Paystack could not start the virtual account assignment.";
      // ------------------------------------------------------
      // Mark correlation record as failed.
      // ------------------------------------------------------
      await assignmentRef.set(
        {
          status: "request_failed",
          failureReason: failureMessage,
          paystackResponse: paystackResponse || null,
          updatedAt: adminSdk.firestore.FieldValue.serverTimestamp(),
        },
        {
          merge: true,
        },
      );
      // ------------------------------------------------------
      // Mark the appropriate order payment section failed.
      // ------------------------------------------------------
      const failedAt = adminSdk.firestore.FieldValue.serverTimestamp();
      if (paymentMode === "shipment") {
        await orderRef.set(
          {
            shipmentPayment: {
              ...(orderData?.shipmentPayment || {}),
              state: "assignment_failed",
              payment: {
                ...(orderData?.shipmentPayment?.payment || {}),
                provider: "PAYSTACK_DVA",
                state: "assignment_failed",
                status: "assignment_failed",
                paystack: {
                  ...(orderData?.shipmentPayment?.payment?.paystack || {}),
                  assignmentKey,
                  assignmentStatus: "failed",
                  failureReason: failureMessage,
                  failedAt,
                },
              },
            },
            updatedAt: failedAt,
          },
          {
            merge: true,
          },
        );
      } else if (paymentMode === "balance") {
        await orderRef.set(
          {
            balancePayment: {
              ...(orderData?.balancePayment || {}),
              state: "assignment_failed",
              payment: {
                ...(orderData?.balancePayment?.payment || {}),
                provider: "PAYSTACK_DVA",
                state: "assignment_failed",
                status: "assignment_failed",
                paystack: {
                  ...(orderData?.balancePayment?.payment?.paystack || {}),
                  assignmentKey,
                  assignmentStatus: "failed",
                  failureReason: failureMessage,
                  failedAt,
                },
              },
            },
            updatedAt: failedAt,
          },
          {
            merge: true,
          },
        );
      } else {
        await orderRef.set(
          {
            payment: {
              ...(orderData?.payment || {}),
              provider: "PAYSTACK_DVA",
              state: "assignment_failed",
              status: "assignment_failed",
              paystack: {
                ...(orderData?.payment?.paystack || {}),
                assignmentKey,
                assignmentStatus: "failed",
                failureReason: failureMessage,
                failedAt,
              },
            },
            updatedAt: failedAt,
          },
          {
            merge: true,
          },
        );
      }
      return jsonResponse(response.status >= 400 ? response.status : 502, {
        success: false,
        provider: "paystack",
        message: failureMessage,
      });
    }
    // ========================================================
    // ASSIGNMENT REQUEST ACCEPTED
    //
    // IMPORTANT:
    //
    // This DOES NOT mean the DVA has been assigned yet.
    //
    // Paystack will later send:
    //
    // dedicatedaccount.assign.success
    //
    // or
    //
    // dedicatedaccount.assign.failed
    //
    // to our webhook.
    // ========================================================
    await assignmentRef.set(
      {
        status: "assignment_pending",
        paystackMessage:
          paystackResponse?.message || "Assign dedicated account in progress",
        updatedAt: adminSdk.firestore.FieldValue.serverTimestamp(),
      },
      {
        merge: true,
      },
    );
    return jsonResponse(200, {
      success: true,
      provider: "paystack",
      status: "assignment_pending",
      message:
        paystackResponse?.message ||
        "Paystack dedicated account assignment is in progress.",
      data: paystackResponse?.data || null,
      checkout: {
        userId,
        orderId,
        orderPath: canonicalOrderPath,
        paymentMode,
        paymentReference,
        amount,
        paymentIntentAmount: amount,
        obligationTotal,
        paidTotalBefore,
        outstandingBefore,
        assignmentKey,
      },
    });
  } catch (error) {
    console.error("Paystack DVA network/server error:", error);
    // ========================================================
    // NETWORK / SERVER FAILURE
    // ========================================================
    try {
      await assignmentRef.set(
        {
          status: "request_error",
          failureReason: error?.message || "Unable to communicate with Paystack.",
          updatedAt: adminSdk.firestore.FieldValue.serverTimestamp(),
        },
        {
          merge: true,
        },
      );
    } catch (firestoreError) {
      console.error("Could not record Paystack request error:", firestoreError);
    }
    return jsonResponse(500, {
      success: false,
      provider: "paystack",
      message: "Unable to communicate with Paystack right now. Please try again.",
    });
  }
};