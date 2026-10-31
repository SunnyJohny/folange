// netlify/functions/paystack-webhook.js
const crypto = require("crypto");

// CHAREX-only Firestore records. Never fall back to another app's collections.
const CHAREX_ROOT_PATH = "charex/main";
const CHAREX_ASSIGNMENTS_COLLECTION = CHAREX_ROOT_PATH + "/paystackDvaAssignments";
const CHAREX_TRANSACTIONS_COLLECTION = CHAREX_ROOT_PATH + "/paystack_transactions";

const admin = require("firebase-admin");
// ============================================================
// FIREBASE ADMIN
// ============================================================
let firebaseApp = null;
const getFirebaseAdmin = () => {
  if (firebaseApp) {
    return admin;
  }
  if (admin.apps.length > 0) {
    firebaseApp = admin.app();
    return admin;
  }
  const projectId = String(process.env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || "")
    .replace(/\\n/g, "\n")
    .trim();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin environment variables are incomplete.");
  }
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
  return admin;
};
// ============================================================
// RESPONSE HELPER
// ============================================================
const response = (statusCode, body = "") => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
  },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
// ============================================================
// STRING HELPERS
// ============================================================
const cleanString = (value) => String(value ?? "").trim();
const normalizeEmail = (value) => cleanString(value).toLowerCase();
// ============================================================
// VERIFY PAYSTACK SIGNATURE
// ============================================================
const verifyPaystackSignature = (rawBody, signature, secretKey) => {
  if (!rawBody || !signature || !secretKey) {
    return false;
  }
  const hash = crypto.createHmac("sha512", secretKey).update(rawBody).digest("hex");
  if (hash.length !== signature.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hash, "utf8"),
      Buffer.from(signature, "utf8"),
    );
  } catch (error) {
    console.error("Paystack signature comparison error:", error);
    return false;
  }
};
// ============================================================
// PAYMENT MODE HELPERS
// ============================================================
const normalizePaymentMode = (value) => {
  const mode = cleanString(value).toLowerCase();
  if (mode === "order" || mode === "shipment" || mode === "balance") {
    return mode;
  }
  return "";
};
// ============================================================
// BUILD PAYMENT UPDATE
//
// IMPORTANT:
// We use dot-path updates so we do not replace an entire
// existing payment/shipmentPayment/balancePayment object.
// ============================================================
const buildDvaOrderUpdate = ({
  paymentMode,
  assignmentKey,
  paymentReference,
  expectedAmount,
  obligationTotal,
  customer,
  dedicatedAccount,
}) => {
  const mode = normalizePaymentMode(paymentMode);
  if (!mode) {
    throw new Error(`Unsupported payment mode: ${paymentMode}`);
  }
  let prefix = "payment";
  if (mode === "shipment") {
    prefix = "shipmentPayment.payment";
  }
  if (mode === "balance") {
    prefix = "balancePayment.payment";
  }
  const bank = dedicatedAccount?.bank || {};
  const accountNumber = cleanString(dedicatedAccount?.account_number);
  const accountName = cleanString(dedicatedAccount?.account_name);
  const bankName = cleanString(bank?.name);
  const bankSlug = cleanString(bank?.slug);
  const customerCode = cleanString(customer?.customer_code);
  const customerId =
    customer?.id !== undefined && customer?.id !== null ? customer.id : null;
  const dvaId =
    dedicatedAccount?.id !== undefined && dedicatedAccount?.id !== null
      ? dedicatedAccount.id
      : null;
  const update = {
    // Main payment state
    [`${prefix}.provider`]: "PAYSTACK_DVA",
    [`${prefix}.status`]: "Awaiting Payment",
    [`${prefix}.assignmentStatus`]: "assigned",
    [`${prefix}.assignmentKey`]: assignmentKey,
    [`${prefix}.reference`]: paymentReference,
    [`${prefix}.paymentReference`]: paymentReference,
    [`${prefix}.amount`]: Number(obligationTotal || expectedAmount),
    [`${prefix}.expectedAmount`]: Number(obligationTotal || expectedAmount),
    [`${prefix}.currency`]: cleanString(dedicatedAccount?.currency || "NGN"),
    [`${prefix}.paystackCustomerCode`]: customerCode,
    [`${prefix}.paystackCustomerId`]: customerId,
    [`${prefix}.paystackDvaId`]: dvaId,
    [`${prefix}.accountNumber`]: accountNumber,
    [`${prefix}.accountName`]: accountName,
    [`${prefix}.bankName`]: bankName,
    [`${prefix}.bankSlug`]: bankSlug,
    [`${prefix}.assigned`]: dedicatedAccount?.assigned === true,
    [`${prefix}.active`]: dedicatedAccount?.active === true,
    [`${prefix}.assignedAt`]: admin.firestore.FieldValue.serverTimestamp(),
    [`${prefix}.updatedAt`]: admin.firestore.FieldValue.serverTimestamp(),
    // Keep the nested Paystack state synchronized with the
    // top-level payment state created by paystack-create-dva.
    [`${prefix}.paystack.assignmentKey`]: assignmentKey,
    [`${prefix}.paystack.paymentIntentAmount`]: Number(expectedAmount),
    [`${prefix}.paystack.obligationTotal`]: Number(obligationTotal || expectedAmount),
    [`${prefix}.paystack.assignmentStatus`]: "assigned",
    [`${prefix}.paystack.accountNumber`]: accountNumber,
    [`${prefix}.paystack.accountName`]: accountName,
    [`${prefix}.paystack.bankName`]: bankName,
    [`${prefix}.paystack.bankSlug`]: bankSlug,
    [`${prefix}.paystack.currency`]: cleanString(dedicatedAccount?.currency || "NGN"),
    [`${prefix}.paystack.customerCode`]: customerCode || null,
    [`${prefix}.paystack.customerId`]: customerId,
    [`${prefix}.paystack.dedicatedAccountId`]: dvaId,
    [`${prefix}.paystack.assigned`]: dedicatedAccount?.assigned === true,
    [`${prefix}.paystack.active`]: dedicatedAccount?.active === true,
    [`${prefix}.paystack.assignedAt`]: admin.firestore.FieldValue.serverTimestamp(),
    [`${prefix}.paystack.lastWebhookEvent`]: "dedicatedaccount.assign.success",
    [`${prefix}.paystack.updatedAt`]: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  return update;
};
// ============================================================
// FIND ONE PENDING ASSIGNMENT
//
// Paystack's assignment-success event gives us the customer
// and DVA, but not our CHAREX assignmentKey.
//
// paystack-create-dva stores the email at:
//
// customer.email
//
// Therefore this function queries that exact nested Firestore
// field.
//
// SAFETY RULE:
// We proceed only when exactly ONE pending assignment matches.
// ============================================================
const findPendingAssignment = async ({ db, customerEmail }) => {
  const email = normalizeEmail(customerEmail);
  if (!email) {
    throw new Error("Paystack assignment event does not contain a customer email.");
  }
  const collectionRef = db.collection(CHAREX_ASSIGNMENTS_COLLECTION);
  // IMPORTANT:
  // The assignment document contains:
  //
  // customer: {
  //   email: "..."
  // }
  //
  // so the correct Firestore field path is customer.email.
  const snapshot = await collectionRef.where("customer.email", "==", email).get();
  if (snapshot.empty) {
    return {
      status: "not_found",
      assignment: null,
    };
  }
  const pending = [];
  snapshot.forEach((doc) => {
    const value = doc.data() || {};
    const state = cleanString(
      value.status || value.assignmentStatus || value.state,
    ).toLowerCase();
    if (state === "assignment_pending" || state === "pending") {
      pending.push({
        id: doc.id,
        ref: doc.ref,
        data: value,
      });
    }
  });
  if (pending.length === 0) {
    return {
      status: "not_found",
      assignment: null,
    };
  }
  if (pending.length > 1) {
    return {
      status: "ambiguous",
      count: pending.length,
      assignment: null,
    };
  }
  return {
    status: "found",
    assignment: pending[0],
  };
};
// ============================================================
// PROCESS DVA ASSIGNMENT SUCCESS
// ============================================================
const processDvaAssignmentSuccess = async (data) => {
  const firebase = getFirebaseAdmin();
  const db = firebase.firestore();
  const customer = data?.customer || {};
  const dedicatedAccount = data?.dedicated_account || {};
  const customerEmail = normalizeEmail(customer?.email);
  const customerCode = cleanString(customer?.customer_code);
  const accountNumber = cleanString(dedicatedAccount?.account_number);
  const accountName = cleanString(dedicatedAccount?.account_name);
  const bankName = cleanString(dedicatedAccount?.bank?.name);
  const bankSlug = cleanString(dedicatedAccount?.bank?.slug);
  // ==========================================================
  // VALIDATE PAYSTACK EVENT
  // ==========================================================
  if (!customerEmail) {
    throw new Error("DVA assignment success event is missing customer.email.");
  }
  if (!accountNumber) {
    throw new Error("DVA assignment success event is missing account_number.");
  }
  // ==========================================================
  // FIND THE CHAREX PENDING ASSIGNMENT
  // ==========================================================
  const lookup = await findPendingAssignment({
    db,
    customerEmail,
  });
  if (lookup.status === "not_found") {
    console.warn("No pending CHAREX Paystack assignment found for:", customerEmail);
    return {
      handled: false,
      reason: "pending_assignment_not_found",
    };
  }
  if (lookup.status === "ambiguous") {
    console.error(
      "Multiple pending Paystack assignments found for customer:",
      customerEmail,
      "count:",
      lookup.count,
    );
    return {
      handled: false,
      reason: "ambiguous_pending_assignments",
    };
  }
  const assignment = lookup.assignment;
  const assignmentData = assignment.data || {};
  const assignmentKey = assignment.id;
  const userId = cleanString(assignmentData.userId);
  const orderId = cleanString(assignmentData.orderId);
  const storedOrderPath = cleanString(assignmentData.orderPath);
  const paymentMode = normalizePaymentMode(assignmentData.paymentMode);
  const paymentReference = cleanString(assignmentData.paymentReference);
  const expectedAmount = Number(assignmentData.expectedAmount ?? assignmentData.amount);
  const obligationTotal = Number(
    assignmentData.obligationTotal ??
      assignmentData.expectedAmount ??
      assignmentData.amount,
  );
  // ==========================================================
  // VALIDATE INTERNAL ASSIGNMENT
  // ==========================================================
  if (!userId || !orderId) {
    throw new Error("Pending Paystack assignment is missing userId/orderId.");
  }
  if (!paymentMode) {
    throw new Error("Pending Paystack assignment has an invalid paymentMode.");
  }
  if (!paymentReference) {
    throw new Error("Pending Paystack assignment is missing paymentReference.");
  }
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    throw new Error("Pending Paystack assignment has an invalid expectedAmount.");
  }
  // ==========================================================
  // CANONICAL ORDER PATH
  // ==========================================================
  if (userId.includes("/") || orderId.includes("/")) {
    throw new Error("Invalid userId/orderId in Paystack assignment.");
  }
  const canonicalOrderPath = `${CHAREX_ROOT_PATH}/users/${userId}/orders/${orderId}`;
  if (storedOrderPath && storedOrderPath !== canonicalOrderPath) {
    throw new Error("Stored Paystack orderPath does not match canonical order path.");
  }
  const orderRef = db.doc(canonicalOrderPath);
  // ==========================================================
  // FIRESTORE TRANSACTION
  //
  // Updates:
  //
  // 1. charex/main/paystackDvaAssignments/{assignmentKey}
  // 2. correct order payment section
  //
  // This DOES NOT mark the order paid.
  // ==========================================================
  await db.runTransaction(async (transaction) => {
    const freshAssignmentSnapshot = await transaction.get(assignment.ref);
    const orderSnapshot = await transaction.get(orderRef);
    if (!freshAssignmentSnapshot.exists) {
      throw new Error("Paystack assignment disappeared before processing.");
    }
    if (!orderSnapshot.exists) {
      throw new Error(`Order not found: ${canonicalOrderPath}`);
    }
    const freshAssignment = freshAssignmentSnapshot.data() || {};
    const freshState = cleanString(
      freshAssignment.status ||
        freshAssignment.assignmentStatus ||
        freshAssignment.state,
    ).toLowerCase();
    // ======================================================
    // IDEMPOTENCY
    // ======================================================
    if (freshState === "assigned" || freshState === "assignment_success") {
      const storedAccountNumber = cleanString(freshAssignment.accountNumber);
      if (storedAccountNumber && storedAccountNumber === accountNumber) {
        console.log("Paystack DVA assignment already processed:", assignmentKey);
        return;
      }
      throw new Error("Assignment was already completed with a different DVA.");
    }
    if (freshState !== "assignment_pending" && freshState !== "pending") {
      throw new Error(
        `Paystack assignment is not pending. Current state: ${freshState}`,
      );
    }
    // ======================================================
    // UPDATE ORDER
    // ======================================================
    const orderUpdate = buildDvaOrderUpdate({
      paymentMode,
      assignmentKey,
      paymentReference,
      expectedAmount,
      obligationTotal,
      customer,
      dedicatedAccount,
    });
    transaction.update(orderRef, orderUpdate);
    // ======================================================
    // UPDATE ASSIGNMENT INDEX
    // ======================================================
    transaction.set(
      assignment.ref,
      {
        status: "assigned",
        assignmentStatus: "assigned",
        paystackCustomerId: customer?.id ?? null,
        paystackCustomerCode: customerCode || null,
        customerEmail,
        accountNumber,
        accountName: accountName || null,
        bankName: bankName || null,
        bankSlug: bankSlug || null,
        dedicatedAccountId: dedicatedAccount?.id ?? null,
        currency: cleanString(dedicatedAccount?.currency || "NGN"),
        active: dedicatedAccount?.active === true,
        assigned: dedicatedAccount?.assigned === true,
        paystackAssignedAt: dedicatedAccount?.assignment?.assigned_at || null,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {
        merge: true,
      },
    );
  });
  console.log("Paystack DVA linked to CHAREX order:", {
    assignmentKey,
    orderPath: canonicalOrderPath,
    paymentMode,
    paymentReference,
    expectedAmount,
    customerCode,
    accountNumber,
    bankSlug,
  });
  return {
    handled: true,
    assignmentKey,
    orderPath: canonicalOrderPath,
  };
};
// ============================================================
// CHARGE.SUCCESS HELPERS
// ============================================================
const getPaymentPrefix = (paymentMode) => {
  const mode = normalizePaymentMode(paymentMode);
  if (mode === "shipment") return "shipmentPayment.payment";
  if (mode === "balance") return "balancePayment.payment";
  if (mode === "order") return "payment";
  return "";
};
const getPaymentObject = (orderData, paymentMode) => {
  const mode = normalizePaymentMode(paymentMode);
  if (mode === "shipment") return orderData?.shipmentPayment?.payment || {};
  if (mode === "balance") return orderData?.balancePayment?.payment || {};
  if (mode === "order") return orderData?.payment || {};
  return {};
};
const getChargeReceiverAccountNumber = (data) =>
  cleanString(
    data?.authorization?.receiver_bank_account_number ||
      data?.authorization?.receiver_account_number ||
      data?.receiver_bank_account_number ||
      data?.receiver_account_number,
  );
const getChargeCustomerCode = (data) => cleanString(data?.customer?.customer_code);
const getChargeCustomerEmail = (data) => normalizeEmail(data?.customer?.email);
const findAssignedPaymentForCharge = async ({
  db,
  receiverAccountNumber,
  customerCode,
  customerEmail,
  amountMinor,
}) => {
  const collectionRef = db.collection(CHAREX_ASSIGNMENTS_COLLECTION);
  let snapshot = null;
  if (receiverAccountNumber) {
    snapshot = await collectionRef
      .where("accountNumber", "==", receiverAccountNumber)
      .get();
  }
  if ((!snapshot || snapshot.empty) && customerCode) {
    snapshot = await collectionRef
      .where("paystackCustomerCode", "==", customerCode)
      .get();
  }
  if ((!snapshot || snapshot.empty) && customerEmail) {
    snapshot = await collectionRef.where("customer.email", "==", customerEmail).get();
  }
  if (!snapshot || snapshot.empty) {
    return { status: "not_found", assignment: null };
  }
  const outstanding = [];
  snapshot.forEach((doc) => {
    const value = doc.data() || {};
    const state = cleanString(
      value.status || value.assignmentStatus || value.state,
    ).toLowerCase();
    const paymentStatus = cleanString(
      value.paymentStatus || value.chargeStatus,
    ).toLowerCase();
    if (
      (state === "assigned" || state === "assignment_success") &&
      paymentStatus !== "paid" &&
      paymentStatus !== "success"
    ) {
      outstanding.push({ id: doc.id, ref: doc.ref, data: value });
    }
  });
  if (outstanding.length === 0) {
    return { status: "not_found", assignment: null };
  }
  // A DVA is reusable per customer. Therefore account/customer identity alone
  // cannot identify an CHAREX obligation when several are open.
  // Narrow the outstanding assignments by the exact incoming transfer amount.
  const incomingMinor = Math.round(Number(amountMinor));
  const exactAmountMatches = outstanding.filter((entry) => {
    const expected = Number(entry?.data?.expectedAmount ?? entry?.data?.amount);
    if (!Number.isFinite(expected) || expected <= 0) return false;
    return Math.round(expected * 100) === incomingMinor;
  });
  if (exactAmountMatches.length === 0) {
    return {
      status: "amount_mismatch",
      assignment: null,
      count: outstanding.length,
      expectedAmounts: outstanding
        .map((entry) => Number(entry?.data?.expectedAmount ?? entry?.data?.amount))
        .filter((value) => Number.isFinite(value) && value > 0),
    };
  }
  if (exactAmountMatches.length > 1) {
    return {
      status: "ambiguous",
      count: exactAmountMatches.length,
      assignment: null,
    };
  }
  return { status: "found", assignment: exactAmountMatches[0] };
};
const processChargeSuccess = async (data) => {
  const firebase = getFirebaseAdmin();
  const db = firebase.firestore();
  const transactionId =
    data?.id !== undefined && data?.id !== null ? String(data.id) : "";
  const transactionReference = cleanString(data?.reference);
  const transactionStatus = cleanString(data?.status).toLowerCase();
  const currency = cleanString(data?.currency).toUpperCase();
  const channel = cleanString(data?.channel).toLowerCase();
  const authorizationChannel = cleanString(data?.authorization?.channel).toLowerCase();
  const receiverAccountNumber = getChargeReceiverAccountNumber(data);
  const customerCode = getChargeCustomerCode(data);
  const customerEmail = getChargeCustomerEmail(data);
  const amountMinor = Number(data?.amount);
  if (!transactionId || !transactionReference) {
    throw new Error("Paystack charge.success is missing transaction id/reference.");
  }
  if (transactionStatus !== "success") {
    throw new Error(`Paystack charge.success has invalid status: ${transactionStatus}`);
  }
  if (currency !== "NGN") {
    throw new Error(`Unsupported Paystack charge currency: ${currency}`);
  }
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw new Error("Paystack charge.success has an invalid amount.");
  }
  const isDvaCharge =
    authorizationChannel === "dedicated_nuban" ||
    channel === "dedicated_nuban" ||
    (channel === "bank_transfer" && (receiverAccountNumber || customerCode));
  if (!isDvaCharge) {
    console.log("Paystack charge.success is not a DVA transfer; ignored:", {
      transactionId,
      transactionReference,
      channel,
      authorizationChannel,
    });
    return { handled: false, reason: "not_dva_charge" };
  }
  if (!receiverAccountNumber && !customerCode && !customerEmail) {
    throw new Error("Paystack DVA charge has no receiver account/customer identifier.");
  }
  const lookup = await findAssignedPaymentForCharge({
    db,
    receiverAccountNumber,
    customerCode,
    customerEmail,
    amountMinor,
  });
  if (lookup.status === "not_found") {
    console.warn("No outstanding CHAREX Paystack assignment found for charge:", {
      receiverAccountNumber,
      customerCode,
      customerEmail,
      transactionReference,
    });
    return {
      handled: false,
      reason: "outstanding_assignment_not_found",
    };
  }
  if (lookup.status === "amount_mismatch") {
    console.error(
      "Paystack DVA transfer does not match any outstanding assignment amount:",
      {
        receiverAccountNumber,
        customerCode,
        customerEmail,
        receivedAmountMinor: amountMinor,
        receivedAmount: amountMinor / 100,
        expectedAmounts: lookup.expectedAmounts || [],
        transactionReference,
      },
    );
    await db
      .collection(CHAREX_TRANSACTIONS_COLLECTION)
      .doc(transactionReference)
      .set(
        {
          provider: "PAYSTACK_DVA",
          status: "amount_mismatch",
          transactionId,
          transactionReference,
          receivedAmountMinor: amountMinor,
          receivedAmount: amountMinor / 100,
          currency,
          receiverAccountNumber: receiverAccountNumber || null,
          customerCode: customerCode || null,
          customerEmail: customerEmail || null,
          expectedAmounts: lookup.expectedAmounts || [],
          recordedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    return { handled: false, reason: "amount_mismatch" };
  }
  if (lookup.status === "ambiguous") {
    console.error("Multiple outstanding Paystack assignments match charge:", {
      receiverAccountNumber,
      customerCode,
      customerEmail,
      count: lookup.count,
      transactionReference,
    });
    return {
      handled: false,
      reason: "ambiguous_outstanding_assignments",
    };
  }
  const assignment = lookup.assignment;
  const assignmentData = assignment.data || {};
  const assignmentKey = assignment.id;
  const userId = cleanString(assignmentData.userId);
  const orderId = cleanString(assignmentData.orderId);
  const storedOrderPath = cleanString(assignmentData.orderPath);
  const paymentMode = normalizePaymentMode(assignmentData.paymentMode);
  const expectedAmount = Number(assignmentData.expectedAmount ?? assignmentData.amount);
  const obligationTotal = Number(
    assignmentData.obligationTotal ??
      assignmentData.expectedAmount ??
      assignmentData.amount,
  );
  const paymentReference = cleanString(assignmentData.paymentReference);
  if (!userId || !orderId) {
    throw new Error("Assigned Paystack payment is missing userId/orderId.");
  }
  if (!paymentMode) {
    throw new Error("Assigned Paystack payment has an invalid paymentMode.");
  }
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    throw new Error("Assigned Paystack payment has an invalid expectedAmount.");
  }
  if (userId.includes("/") || orderId.includes("/")) {
    throw new Error("Invalid userId/orderId in Paystack assignment.");
  }
  const canonicalOrderPath = `${CHAREX_ROOT_PATH}/users/${userId}/orders/${orderId}`;
  if (storedOrderPath && storedOrderPath !== canonicalOrderPath) {
    throw new Error("Stored Paystack orderPath does not match canonical order path.");
  }
  const orderRef = db.doc(canonicalOrderPath);
  const transactionRef = db
    .collection(CHAREX_TRANSACTIONS_COLLECTION)
    .doc(transactionReference);
  // Paystack returns NGN transaction amounts in kobo.
  // CHAREX stores expectedAmount in naira.
  const expectedAmountMinor = Math.round(expectedAmount * 100);
  if (Math.round(amountMinor) !== expectedAmountMinor) {
    console.error("Paystack payment amount mismatch:", {
      assignmentKey,
      orderPath: canonicalOrderPath,
      expectedAmount,
      expectedAmountMinor,
      receivedAmountMinor: amountMinor,
      receivedAmount: amountMinor / 100,
      transactionReference,
    });
    await transactionRef.set(
      {
        provider: "PAYSTACK_DVA",
        status: "amount_mismatch",
        transactionId,
        transactionReference,
        assignmentKey,
        orderPath: canonicalOrderPath,
        paymentMode,
        expectedAmount,
        expectedAmountMinor,
        receivedAmountMinor: amountMinor,
        receivedAmount: amountMinor / 100,
        currency,
        receiverAccountNumber: receiverAccountNumber || null,
        customerCode: customerCode || null,
        customerEmail: customerEmail || null,
        recordedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { handled: false, reason: "amount_mismatch" };
  }
  await db.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef);
    const assignmentSnapshot = await transaction.get(assignment.ref);
    const transactionSnapshot = await transaction.get(transactionRef);
    if (!orderSnapshot.exists) {
      throw new Error(`Order not found: ${canonicalOrderPath}`);
    }
    if (!assignmentSnapshot.exists) {
      throw new Error("Paystack assignment disappeared before payment processing.");
    }
    if (transactionSnapshot.exists) {
      const existingTransaction = transactionSnapshot.data() || {};
      const existingStatus = cleanString(existingTransaction.status).toLowerCase();
      if (existingStatus === "success" || existingStatus === "paid") {
        console.log("Paystack charge already processed:", transactionReference);
        return;
      }
    }
    const freshAssignment = assignmentSnapshot.data() || {};
    const assignmentState = cleanString(
      freshAssignment.status ||
        freshAssignment.assignmentStatus ||
        freshAssignment.state,
    ).toLowerCase();
    if (assignmentState !== "assigned" && assignmentState !== "assignment_success") {
      throw new Error(
        `Paystack assignment is not ready for payment. Current state: ${assignmentState}`,
      );
    }
    const storedAccountNumber = cleanString(freshAssignment.accountNumber);
    if (
      receiverAccountNumber &&
      storedAccountNumber &&
      receiverAccountNumber !== storedAccountNumber
    ) {
      throw new Error(
        "Paystack charge receiver account does not match assignment DVA.",
      );
    }
    const orderData = orderSnapshot.data() || {};
    const paymentObject = getPaymentObject(orderData, paymentMode);
    const prefix = getPaymentPrefix(paymentMode);
    if (!prefix) {
      throw new Error("Unable to determine Paystack payment path.");
    }
    const currentProvider = cleanString(paymentObject?.provider).toUpperCase();
    if (currentProvider && currentProvider !== "PAYSTACK_DVA") {
      throw new Error(`Order payment provider mismatch: ${currentProvider}`);
    }
    const currentAssignmentKey = cleanString(
      paymentObject?.assignmentKey || paymentObject?.paystack?.assignmentKey,
    );
    if (currentAssignmentKey && currentAssignmentKey !== assignmentKey) {
      throw new Error(
        "Order payment assignmentKey does not match Paystack charge assignment.",
      );
    }
    const paidAt = cleanString(data?.paid_at) || cleanString(data?.paidAt) || null;
    const receivedAmount = amountMinor / 100;
    const serverTs = admin.firestore.FieldValue.serverTimestamp();
    const fieldValue = admin.firestore.FieldValue;
    const nowIso = new Date().toISOString();
    // ----------------------------------------------------------
    // QUERY-INFLOW COMPATIBLE ACCOUNTING
    // ----------------------------------------------------------
    // OrdersTable already understands this common accounting shape.
    // Paystack therefore updates the same amountPaid/outstanding/inflow/
    // history/audit fields that UBA query-inflow maintains, while keeping
    // Paystack-specific verification details under payment.paystack.
    const parentPayment =
      paymentMode === "shipment"
        ? orderData?.shipmentPayment || {}
        : paymentMode === "balance"
          ? orderData?.balancePayment || {}
          : null;
    const existingPaidCandidates = [
      parentPayment?.amountPaid,
      paymentObject?.amountPaid,
      paymentObject?.inflow?.paidTotal,
      paymentObject?.inflow?.amount,
      paymentObject?.inflow?.amountPaid,
      paymentObject?.inflow?.["amount paid"],
    ]
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const previousPaidTotal = existingPaidCandidates.length
      ? Math.max(...existingPaidCandidates)
      : 0;
    const sectionExpectedCandidates = [
      parentPayment?.payableTotal,
      parentPayment?.amount,
      paymentObject?.payableTotal,
      paymentObject?.amount,
      paymentObject?.expectedAmount,
      paymentObject?.inflow?.expected,
    ]
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);
    // expectedAmount is ONLY this Paystack payment intent. It must never
    // replace or inflate the full order/shipment/balance obligation.
    if (Number.isFinite(obligationTotal) && obligationTotal > 0) {
      sectionExpectedCandidates.push(obligationTotal);
    }
    const sectionExpected = sectionExpectedCandidates.length
      ? Math.max(...sectionExpectedCandidates)
      : previousPaidTotal + expectedAmount;
    const newPaidTotal = Math.min(sectionExpected, previousPaidTotal + receivedAmount);
    const outstanding = Math.max(0, sectionExpected - newPaidTotal);
    const isFullyPaid = outstanding <= 0;
    const nextState = isFullyPaid ? "paid" : "partial";
    const nextStatus = isFullyPaid ? "Paid" : "partial";
    const chargeKey = `PAYSTACK:${transactionReference}`;
    const previousSuccessfulCount = Number(paymentObject?.inflow?.successfulCount || 0);
    const successfulCount = previousSuccessfulCount + 1;
    const inflowPayload = {
      ...(paymentObject?.inflow || {}),
      provider: "PAYSTACK_DVA",
      source: "paystack-webhook",
      successfulCount,
      expected: sectionExpected,
      paidTotal: newPaidTotal,
      outstanding,
      paymentReference: paymentReference || transactionReference,
      customerReference: orderId,
      amount: newPaidTotal,
      amountPaid: newPaidTotal,
      "amount paid": newPaidTotal,
      receivedAmount,
      transactionId,
      transactionReference,
      chargeKey,
      updatedAt: nowIso,
    };
    const paymentHistoryEntry = {
      at: nowIso,
      mode: paymentMode,
      section: paymentMode,
      chargeKey,
      paymentIdentity: paymentReference || transactionReference,
      provider: "PAYSTACK_DVA",
      source: "paystack-webhook",
      account: storedAccountNumber || receiverAccountNumber || null,
      expected: sectionExpected,
      receivedAmount,
      paidTotal: newPaidTotal,
      outstanding,
      state: nextState,
      status: nextStatus,
      isFullyPaid,
      transactionIds: [transactionId],
      transactionReference,
      customerReference: orderId,
      paymentReference: paymentReference || transactionReference,
      hasVerifiedShipmentInflow: paymentMode === "shipment",
    };
    const paymentLog = {
      ...paymentHistoryEntry,
      requestId: transactionReference,
    };
    const auditSnapshot = {
      mode: paymentMode,
      state: nextState,
      status: nextStatus,
      provider: "PAYSTACK_DVA",
      chargeKey,
      expected: sectionExpected,
      paidTotal: newPaidTotal,
      amountPaid: newPaidTotal,
      outstanding,
      successfulCount,
      inflow: inflowPayload,
      lastKnownInflow: inflowPayload,
      paymentReference: paymentReference || transactionReference,
      customerReference: orderId,
      verifiedBy: "paystack-webhook",
      verifiedAt: serverTs,
      verifiedAtIso: nowIso,
      requestId: transactionReference,
    };
    const existingPaymentAudit =
      orderData?.paymentAudit && typeof orderData.paymentAudit === "object"
        ? orderData.paymentAudit
        : {};
    const nextPaymentAudit = {
      ...existingPaymentAudit,
      [paymentMode]: auditSnapshot,
      lastUpdatedMode: paymentMode,
      lastKnownMode: paymentMode,
      lastKnownState: nextState,
      lastKnownStatus: nextStatus,
      lastKnownPaidTotal: newPaidTotal,
      lastKnownAmountPaid: newPaidTotal,
      lastKnownOutstanding: outstanding,
      lastKnownExpected: sectionExpected,
      lastKnownInflow: inflowPayload,
      lastKnownPaymentReference: paymentReference || transactionReference,
      lastKnownCustomerReference: orderId,
      lastVerifiedBy: "paystack-webhook",
      lastVerifiedAt: serverTs,
      lastVerifiedAtIso: nowIso,
      requestId: transactionReference,
    };
    const paymentUpdate = {
      [`${prefix}.provider`]: "PAYSTACK_DVA",
      [`${prefix}.status`]: nextStatus,
      [`${prefix}.state`]: nextState,
      [`${prefix}.amountPaid`]: newPaidTotal,
      [`${prefix}.expectedAmount`]: sectionExpected,
      [`${prefix}.outstanding`]: outstanding,
      [`${prefix}.paidAt`]: isFullyPaid ? serverTs : null,
      [`${prefix}.inflow`]: inflowPayload,
      [`${prefix}.paystackVerified`]: {
        chargeKey,
        paidTotal: newPaidTotal,
        successfulCount,
        transactionId,
        transactionReference,
        verifiedAt: serverTs,
      },
      [`${prefix}.paystackPaidAt`]: paidAt,
      [`${prefix}.paystackTransactionId`]: transactionId,
      [`${prefix}.paystackTransactionReference`]: transactionReference,
      [`${prefix}.paystackChannel`]:
        channel || authorizationChannel || "dedicated_nuban",
      [`${prefix}.paystackGatewayResponse`]: cleanString(data?.gateway_response),
      [`${prefix}.paystackFeesMinor`]: Number.isFinite(Number(data?.fees))
        ? Number(data.fees)
        : null,
      [`${prefix}.updatedAt`]: serverTs,
      [`${prefix}.paystack.assignmentKey`]: assignmentKey,
      [`${prefix}.paystack.paymentIntentAmount`]: expectedAmount,
      [`${prefix}.paystack.obligationTotal`]: sectionExpected,
      [`${prefix}.paystack.assignmentStatus`]: "assigned",
      [`${prefix}.paystack.accountNumber`]:
        storedAccountNumber || receiverAccountNumber || null,
      [`${prefix}.paystack.accountName`]:
        cleanString(freshAssignment.accountName) ||
        cleanString(paymentObject?.accountName) ||
        null,
      [`${prefix}.paystack.bankName`]:
        cleanString(freshAssignment.bankName) ||
        cleanString(paymentObject?.bankName) ||
        null,
      [`${prefix}.paystack.bankSlug`]:
        cleanString(freshAssignment.bankSlug) ||
        cleanString(paymentObject?.bankSlug) ||
        null,
      [`${prefix}.paystack.customerCode`]:
        customerCode ||
        cleanString(freshAssignment.paystackCustomerCode) ||
        cleanString(paymentObject?.paystackCustomerCode) ||
        null,
      [`${prefix}.paystack.customerId`]:
        freshAssignment.paystackCustomerId ?? paymentObject?.paystackCustomerId ?? null,
      [`${prefix}.paystack.dedicatedAccountId`]:
        freshAssignment.dedicatedAccountId ?? paymentObject?.paystackDvaId ?? null,
      [`${prefix}.paystack.assigned`]: true,
      [`${prefix}.paystack.active`]: freshAssignment.active !== false,
      [`${prefix}.paystack.assignedAt`]:
        freshAssignment.completedAt || paymentObject?.assignedAt || serverTs,
      [`${prefix}.paystack.paymentStatus`]: nextState,
      [`${prefix}.paystack.transactionId`]: transactionId,
      [`${prefix}.paystack.transactionReference`]: transactionReference,
      [`${prefix}.paystack.amountMinor`]: amountMinor,
      [`${prefix}.paystack.amountPaid`]: newPaidTotal,
      [`${prefix}.paystack.receivedAmount`]: receivedAmount,
      [`${prefix}.paystack.currency`]: currency,
      [`${prefix}.paystack.channel`]:
        channel || authorizationChannel || "dedicated_nuban",
      [`${prefix}.paystack.receiverAccountNumber`]: receiverAccountNumber || null,
      [`${prefix}.paystack.customerEmail`]: customerEmail || null,
      [`${prefix}.paystack.paidAt`]: isFullyPaid ? serverTs : null,
      [`${prefix}.paystack.paystackPaidAt`]: paidAt,
      [`${prefix}.paystack.lastWebhookEvent`]: "charge.success",
      [`${prefix}.paystack.updatedAt`]: serverTs,
      paymentAudit: nextPaymentAudit,
      paymentLogs: fieldValue.arrayUnion(paymentLog),
      paymentAuditHistory: fieldValue.arrayUnion({
        ...auditSnapshot,
        verifiedAt: nowIso,
      }),
      paymentHistory: fieldValue.arrayUnion(paymentHistoryEntry),
      updatedAt: serverTs,
    };
    if (paymentMode === "order") {
      paymentUpdate.orderStatus = isFullyPaid
        ? "Paid"
        : nextState === "partial"
          ? "Partial"
          : "Pending";
    } else if (paymentMode === "shipment") {
      paymentUpdate["shipmentPayment.enabled"] = true;
      paymentUpdate["shipmentPayment.state"] = nextState;
      paymentUpdate["shipmentPayment.amountPaid"] = newPaidTotal;
      paymentUpdate["shipmentPayment.outstanding"] = outstanding;
      paymentUpdate["shipmentPayment.paidAt"] = isFullyPaid ? serverTs : null;
      paymentUpdate["shipmentPayment.history"] =
        fieldValue.arrayUnion(paymentHistoryEntry);
    } else if (paymentMode === "balance") {
      paymentUpdate["balancePayment.enabled"] = true;
      paymentUpdate["balancePayment.state"] = nextState;
      paymentUpdate["balancePayment.amountPaid"] = newPaidTotal;
      paymentUpdate["balancePayment.outstanding"] = outstanding;
      paymentUpdate["balancePayment.paidAt"] = isFullyPaid ? serverTs : null;
      paymentUpdate["balancePayment.history"] =
        fieldValue.arrayUnion(paymentHistoryEntry);
    }
    transaction.update(orderRef, paymentUpdate);
    transaction.set(
      assignment.ref,
      {
        status: "paid",
        assignmentStatus: "assigned",
        paymentStatus: "paid",
        chargeStatus: "success",
        paystackTransactionId: transactionId,
        paystackTransactionReference: transactionReference,
        paidAmount: receivedAmount,
        paymentIntentAmount: expectedAmount,
        obligationTotal: sectionExpected,
        cumulativePaidTotal: newPaidTotal,
        outstandingAfter: outstanding,
        paidAmountMinor: amountMinor,
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    transaction.set(
      transactionRef,
      {
        provider: "PAYSTACK_DVA",
        status: "success",
        transactionId,
        transactionReference,
        assignmentKey,
        paymentReference: paymentReference || null,
        orderPath: canonicalOrderPath,
        userId,
        orderId,
        paymentMode,
        expectedAmount,
        paymentIntentAmount: expectedAmount,
        obligationTotal: sectionExpected,
        expectedAmountMinor,
        amountPaid: newPaidTotal,
        receivedAmount,
        outstanding,
        state: nextState,
        amountMinor,
        currency,
        channel: channel || authorizationChannel || "dedicated_nuban",
        receiverAccountNumber: receiverAccountNumber || null,
        customerCode: customerCode || null,
        customerEmail: customerEmail || null,
        gatewayResponse: cleanString(data?.gateway_response),
        paystackPaidAt: cleanString(data?.paid_at) || null,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
  console.log("Paystack payment linked to CHAREX order:", {
    assignmentKey,
    orderPath: canonicalOrderPath,
    paymentMode,
    expectedAmount,
    receivedAmount: amountMinor / 100,
    transactionReference,
    receiverAccountNumber,
  });
  return {
    handled: true,
    assignmentKey,
    orderPath: canonicalOrderPath,
    transactionReference,
  };
};
// ============================================================
// NETLIFY HANDLER
// ============================================================
exports.handler = async (event) => {
  // ==========================================================
  // PAYSTACK SENDS WEBHOOKS USING POST
  // ==========================================================
  if (event.httpMethod !== "POST") {
    return response(405, {
      success: false,
      message: "Method not allowed.",
    });
  }
  // ==========================================================
  // SECRET KEY
  // ==========================================================
  const secretKey = String(process.env.PAYSTACK_SECRET_KEY || "").trim();
  if (!secretKey) {
    console.error("PAYSTACK_SECRET_KEY is missing.");
    return response(500, {
      success: false,
      message: "Server configuration error.",
    });
  }
  // ==========================================================
  // RAW REQUEST BODY
  //
  // IMPORTANT:
  // Paystack signs the original payload.
  // Signature verification therefore happens before JSON.parse.
  // ==========================================================
  const rawBody = event.body || "";
  const signature =
    event.headers?.["x-paystack-signature"] ||
    event.headers?.["X-Paystack-Signature"] ||
    "";
  // ==========================================================
  // VERIFY PAYSTACK SIGNATURE
  // ==========================================================
  const validSignature = verifyPaystackSignature(rawBody, signature, secretKey);
  if (!validSignature) {
    console.error("Rejected Paystack webhook: invalid signature.");
    return response(401, {
      success: false,
      message: "Invalid webhook signature.",
    });
  }
  // ==========================================================
  // PARSE VERIFIED EVENT
  // ==========================================================
  let paystackEvent;
  try {
    paystackEvent = JSON.parse(rawBody);
  } catch (error) {
    console.error("Unable to parse Paystack webhook:", error);
    return response(400, {
      success: false,
      message: "Invalid webhook payload.",
    });
  }
  const eventType = paystackEvent?.event;
  const data = paystackEvent?.data;
  console.log("Verified Paystack webhook:", eventType);
  // ==========================================================
  // DVA ASSIGNMENT SUCCESS
  // ==========================================================
  if (eventType === "dedicatedaccount.assign.success") {
    console.log("Paystack DVA assignment successful:", data);
    try {
      const result = await processDvaAssignmentSuccess(data);
      // ------------------------------------------------------
      // If we cannot safely identify exactly one assignment,
      // acknowledge the webhook but DO NOT modify an order.
      // ------------------------------------------------------
      if (!result.handled) {
        console.warn(
          "Paystack assignment event acknowledged without order update:",
          result.reason,
        );
        return response(200, {
          success: true,
          received: true,
          handled: false,
          reason: result.reason,
        });
      }
      return response(200, {
        success: true,
        received: true,
        handled: true,
      });
    } catch (error) {
      console.error("Failed to process Paystack DVA assignment:", error);
      return response(500, {
        success: false,
        received: true,
        message: "Unable to process DVA assignment.",
      });
    }
  }
  // ==========================================================
  // DVA ASSIGNMENT FAILED
  //
  // Still log only.
  // ==========================================================
  if (eventType === "dedicatedaccount.assign.failed") {
    console.error("Paystack DVA assignment failed:", data);
    return response(200, {
      success: true,
      received: true,
    });
  }
  // ==========================================================
  // SUCCESSFUL PAYMENT
  //
  // charge.success below applies verified transfers to their scoped CHAREX order.
  // ==========================================================
  // SUCCESSFUL PAYSTACK DVA PAYMENT
  // ==========================================================
  if (eventType === "charge.success") {
    console.log("Paystack charge.success received:", data);
    try {
      const result = await processChargeSuccess(data);
      if (!result.handled) {
        console.warn(
          "Paystack charge acknowledged without marking an order paid:",
          result.reason,
        );
        return response(200, {
          success: true,
          received: true,
          handled: false,
          reason: result.reason,
        });
      }
      return response(200, {
        success: true,
        received: true,
        handled: true,
        transactionReference: result.transactionReference,
      });
    } catch (error) {
      console.error("Failed to process Paystack charge.success:", error);
      return response(500, {
        success: false,
        received: true,
        message: "Unable to process Paystack payment.",
      });
    }
  }
  // ==========================================================
  // OTHER PAYSTACK EVENTS
  // ==========================================================
  console.log("Paystack webhook ignored:", eventType);
  return response(200, {
    success: true,
    received: true,
    ignored: true,
  });
};