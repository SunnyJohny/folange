// netlify/functions/monnify-webhook.js
//
// Monnify Transaction Completion webhook.
//
// PURPOSE:
// Keep Monnify payment writes aligned with the EXISTING working
// netlify/functions/query-inflow.js Firestore structure used by UBA.
//
// Same core fields are maintained:
// - paymentLogs
// - paymentAudit
// - paymentAuditHistory
// - payment.amountPaid / shipmentPayment.amountPaid / balancePayment.amountPaid
// - outstanding
// - inflow
// - state/status
// - paidAt
//
// Monnify-specific difference:
// - verifiedBy is "monnify-webhook"
// - payment source comes from Monnify's SUCCESSFUL_TRANSACTION webhook.
//
// Required production environment variables:
//   MONNIFY_SECRET_KEY
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY
//
// Optional:
//   MONNIFY_BASE_URL
//     Sandbox: https://sandbox.monnify.com
//     Live:    https://api.monnify.com
//
// IMPORTANT:
// Monnify sandbox webhook notifications do not include monnify-signature.
// Production notifications do, and this function verifies it using
// HMAC-SHA512 with MONNIFY_SECRET_KEY.

const crypto = require("crypto");

let admin = null;

function toNumberAmount(v) {
  if (v == null) return 0;

  if (typeof v === "number") {
    return Number.isFinite(v) ? v : 0;
  }

  const n = Number(
    String(v)
      .replace(/,/g, "")
      .replace(/[^\d.-]/g, "")
      .trim()
  );

  return Number.isFinite(n) ? n : 0;
}

function cleanString(v) {
  return String(v ?? "").trim();
}

function normalizeMode(v) {
  const mode = cleanString(v).toLowerCase();

  if (mode === "shipment") return "shipment";
  if (mode === "balance") return "balance";

  return "order";
}

function normalizeAccountNumber(v) {
  return cleanString(v)
    .replace(/\D/g, "")
    .trim();
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function getHeader(headers = {}, name = "") {
  const wanted = String(name).toLowerCase();

  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === wanted) {
      return cleanString(value);
    }
  }

  return "";
}

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
  } catch (e) {
    console.warn(
      "Firebase Admin init failed:",
      e?.message || e
    );

    return null;
  }
}

function isMonnifySandbox() {
  const baseUrl = cleanString(
    process.env.MONNIFY_BASE_URL ||
      "https://sandbox.monnify.com"
  ).toLowerCase();

  return baseUrl.includes("sandbox.monnify.com");
}

function verifyMonnifySignature(rawBody, signature) {
  const secretKey = cleanString(
    process.env.MONNIFY_SECRET_KEY
  );

  if (!secretKey || !signature) {
    return false;
  }

  const expected = crypto
    .createHmac("sha512", secretKey)
    .update(String(rawBody || ""))
    .digest("hex");

  const received = cleanString(signature).toLowerCase();

  if (
    expected.length !== received.length
  ) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(received, "utf8")
    );
  } catch {
    return false;
  }
}

function getEventMetadata(eventData = {}) {
  const meta =
    eventData?.metaData &&
    typeof eventData.metaData === "object"
      ? eventData.metaData
      : eventData?.metadata &&
          typeof eventData.metadata === "object"
        ? eventData.metadata
        : {};

  return meta;
}

function getStoredVNuban(
  docData,
  mode
) {
  return normalizeAccountNumber(
    mode === "balance"
      ? docData?.balancePayment?.payment?.vaNuban ||
          docData?.balancePayment?.payment?.vaNUBAN ||
          docData?.balancePayment?.payment?.vNUBAN ||
          ""
      : mode === "shipment"
        ? docData?.shipmentPayment?.payment?.vaNuban ||
            docData?.shipmentPayment?.payment?.vaNUBAN ||
            docData?.shipmentPayment?.payment?.vNUBAN ||
            ""
        : docData?.payment?.vaNuban ||
          docData?.payment?.vaNUBAN ||
          docData?.payment?.vNUBAN ||
          docData?.payment?.vNuban ||
          docData?.vasVirtualAccount?.vNUBAN ||
          docData?.vasVirtualAccount?.vaNuban ||
          ""
  );
}

function getStoredPaymentReference(
  docData,
  mode
) {
  const payment =
    mode === "balance"
      ? docData?.balancePayment?.payment || {}
      : mode === "shipment"
        ? docData?.shipmentPayment?.payment || {}
        : docData?.payment || {};

  return cleanString(
    payment?.paymentReference ||
      payment?.paymentRef ||
      payment?.reference ||
      ""
  );
}

function getStoredTransactionReference(
  docData,
  mode
) {
  const payment =
    mode === "balance"
      ? docData?.balancePayment?.payment || {}
      : mode === "shipment"
        ? docData?.shipmentPayment?.payment || {}
        : docData?.payment || {};

  return cleanString(
    payment?.transactionReference ||
      payment?.transaction_reference ||
      ""
  );
}

async function resolveLinkedOrder({
  db,
  paymentReference,
  transactionReference,
}) {
  if (!paymentReference) return null;

  const linkRef = db
    .collection("monnify_transactions")
    .doc(paymentReference);

  const linkSnap = await linkRef.get();

  if (!linkSnap.exists) {
    return null;
  }

  const linkData = linkSnap.data() || {};

  const userId = cleanString(linkData?.userId);
  const orderId = cleanString(linkData?.orderId);
  const mode = normalizeMode(linkData?.mode);
  const orderPath = cleanString(linkData?.orderPath);

  const linkedPaymentReference = cleanString(
    linkData?.paymentReference,
  );

  const linkedTransactionReference = cleanString(
    linkData?.transactionReference,
  );

  if (
    !userId ||
    !orderId ||
    userId.includes("/") ||
    orderId.includes("/")
  ) {
    throw new Error(
      "Stored Monnify transaction linkage has an invalid userId/orderId.",
    );
  }

  const canonicalOrderPath =
    `users/${userId}/orders/${orderId}`;

  if (
    orderPath &&
    orderPath !== canonicalOrderPath
  ) {
    throw new Error(
      "Stored Monnify transaction orderPath does not match userId/orderId.",
    );
  }

  if (
    linkedPaymentReference &&
    linkedPaymentReference !== paymentReference
  ) {
    throw new Error(
      "Stored Monnify paymentReference does not match the webhook paymentReference.",
    );
  }

  if (
    linkedTransactionReference &&
    transactionReference &&
    linkedTransactionReference !== transactionReference
  ) {
    throw new Error(
      "Stored Monnify transactionReference does not match the webhook transactionReference.",
    );
  }

  const ref = db.doc(canonicalOrderPath);
  const snap = await ref.get();

  if (!snap.exists) {
    return null;
  }

  return {
    ref,
    snap,
    userId,
    orderId,
    mode,
    linkRef,
    linkData,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, {
      ok: false,
      message: "Method Not Allowed",
    });
  }

  const requestId =
    `${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;

  try {
    const rawBody = String(
      event.body || ""
    );

    if (!rawBody) {
      return json(400, {
        ok: false,
        message:
          "Webhook body is required",
        requestId,
      });
    }

    /**
     * =====================================================
     * MONNIFY SIGNATURE VALIDATION
     * =====================================================
     *
     * Monnify documents that sandbox notifications do NOT
     * include the monnify-signature header.
     *
     * Live notifications DO include it, so live processing
     * must never proceed without a valid signature.
     */
    const signature =
      getHeader(
        event.headers,
        "monnify-signature"
      );

    const sandbox =
      isMonnifySandbox();

    if (!sandbox) {
      if (!signature) {
        return json(401, {
          ok: false,
          message:
            "Missing Monnify signature",
          requestId,
        });
      }

      if (
        !verifyMonnifySignature(
          rawBody,
          signature
        )
      ) {
        return json(401, {
          ok: false,
          message:
            "Invalid Monnify signature",
          requestId,
        });
      }
    }

    let body;

    try {
      body = JSON.parse(rawBody);
    } catch {
      return json(400, {
        ok: false,
        message:
          "Invalid JSON webhook payload",
        requestId,
      });
    }

    const eventType =
      cleanString(
        body?.eventType ||
          body?.event_type
      ).toUpperCase();

    const eventData =
      body?.eventData &&
      typeof body.eventData === "object"
        ? body.eventData
        : body?.event_data &&
            typeof body.event_data === "object"
          ? body.event_data
          : {};

    /**
     * We only use the Transaction Completion webhook
     * to alter order payment state.
     */
    if (
      eventType !==
      "SUCCESSFUL_TRANSACTION"
    ) {
      console.log(
        "Monnify webhook ignored:",
        {
          requestId,
          eventType,
        }
      );

      return json(200, {
        ok: true,
        ignored: true,
        eventType,
        requestId,
      });
    }

    const paymentStatus =
      cleanString(
        eventData?.paymentStatus ||
          eventData?.payment_status
      ).toUpperCase();

    if (paymentStatus !== "PAID") {
      console.log(
        "Monnify transaction completion was not PAID:",
        {
          requestId,
          eventType,
          paymentStatus,
        }
      );

      return json(200, {
        ok: true,
        ignored: true,
        eventType,
        paymentStatus,
        requestId,
      });
    }

    const paymentReference =
      cleanString(
        eventData?.paymentReference ||
          eventData?.payment_reference ||
          eventData?.product?.reference
      );

    const transactionReference =
      cleanString(
        eventData?.transactionReference ||
          eventData?.transaction_reference
      );

    const paidTotal =
      toNumberAmount(
        eventData?.amountPaid ||
          eventData?.amount_paid
      );

    const providerPayable =
      toNumberAmount(
        eventData?.totalPayable ||
          eventData?.total_payable
      );

    const destinationVNuban =
      normalizeAccountNumber(
        eventData
          ?.destinationAccountInformation
          ?.accountNumber ||
          eventData
            ?.destination_account_information
            ?.account_number ||
          ""
      );

    if (!paymentReference) {
      return json(400, {
        ok: false,
        message:
          "Monnify paymentReference is missing",
        requestId,
      });
    }

    if (!paidTotal) {
      return json(400, {
        ok: false,
        message:
          "Monnify amountPaid is missing or invalid",
        requestId,
      });
    }

    const adminSdk =
      initFirebaseAdminIfAvailable();

    if (!adminSdk) {
      return json(503, {
        ok: false,
        message:
          "Payment was received, but order verification is temporarily unavailable.",
        requestId,
      });
    }

    const db =
      adminSdk.firestore();

    /**
     * =====================================================
     * RESOLVE THE EXACT ORDER
     * =====================================================
     *
     * Direct lookup:
     * monnify_transactions/{paymentReference}
     * -> userId/orderId/mode/orderPath
     * -> users/{uid}/orders/{orderId}
     *
     * No collectionGroup query and no Firestore index required.
     */
    const linked =
      await resolveLinkedOrder({
        db,
        paymentReference,
        transactionReference,
      });

    if (!linked) {
      return json(404, {
        ok: false,
        message:
          "No order matched this Monnify payment.",
        paymentReference,
        transactionReference:
          transactionReference || null,
        requestId,
      });
    }

    const {
      ref,
      snap,
      userId,
      orderId,
      mode,
      linkRef,
      linkData,
    } = linked;

    if (
      !/^users\/[^/]+\/orders\/[^/]+$/.test(
        ref.path
      )
    ) {
      return json(400, {
        ok: false,
        message:
          "Resolved order path is not canonical.",
        requestId,
      });
    }

    const docData =
      snap.data() || {};

    /**
     * =====================================================
     * PROVIDER GUARD
     * =====================================================
     *
     * Never let a Monnify webhook overwrite a UBA or
     * SquadCo payment section.
     */
    const storedPayment =
      mode === "balance"
        ? docData?.balancePayment?.payment ||
          {}
        : mode === "shipment"
          ? docData?.shipmentPayment
              ?.payment || {}
          : docData?.payment || {};

    const storedProvider =
      cleanString(
        storedPayment?.provider
      ).toUpperCase();

    if (
      storedProvider &&
      storedProvider !== "MONNIFY"
    ) {
      return json(409, {
        ok: false,
        message:
          "This order payment is not assigned to Monnify.",
        orderRef: ref.path,
        storedProvider,
        requestId,
      });
    }

    /**
     * =====================================================
     * PAYMENT REFERENCE GUARD
     * =====================================================
     */
    const storedPaymentReference =
      getStoredPaymentReference(
        docData,
        mode
      );

    if (
      storedPaymentReference &&
      storedPaymentReference !==
        paymentReference
    ) {
      return json(409, {
        ok: false,
        message:
          "Monnify payment reference does not belong to this order.",
        orderRef: ref.path,
        requestId,
      });
    }

    const storedTransactionReference =
      getStoredTransactionReference(
        docData,
        mode
      );

    if (
      storedTransactionReference &&
      transactionReference &&
      storedTransactionReference !==
        transactionReference
    ) {
      return json(409, {
        ok: false,
        message:
          "Monnify transaction reference does not belong to this order.",
        orderRef: ref.path,
        requestId,
      });
    }

    /**
     * =====================================================
     * VIRTUAL ACCOUNT GUARD
     * =====================================================
     */
    const storedVNuban =
      getStoredVNuban(
        docData,
        mode
      );

    if (
      storedVNuban &&
      destinationVNuban &&
      storedVNuban !== destinationVNuban
    ) {
      return json(409, {
        ok: false,
        message:
          "The Monnify virtual account does not belong to this order.",
        orderRef: ref.path,
        requestId,
      });
    }

    const fieldValue =
      adminSdk.firestore.FieldValue;

    const serverTs =
      fieldValue.serverTimestamp();

    /**
     * =====================================================
     * SAME AMOUNT RESOLUTION AS query-inflow.js
     * =====================================================
     */
    let expected = 0;
    let alreadyPaid = 0;

    if (mode === "balance") {
      expected =
        toNumberAmount(
          docData?.balancePayment
            ?.payment?.amount ||
            docData?.balancePayment
              ?.payableTotal ||
            docData?.balancePayment
              ?.amount ||
            0
        );

      alreadyPaid =
        toNumberAmount(
          docData?.balancePayment
            ?.amountPaid ||
            docData?.balancePayment
              ?.payment?.inflow
              ?.paidTotal ||
            docData?.balancePayment
              ?.payment?.inflow
              ?.[
                "amount paid"
              ] ||
            0
        );
    } else if (
      mode === "shipment"
    ) {
      expected =
        toNumberAmount(
          docData?.shipmentPayment
            ?.payment?.amount ||
            docData?.shipmentPayment
              ?.amount ||
            docData?.shipmentFee ||
            0
        );

      alreadyPaid =
        toNumberAmount(
          docData?.shipmentPayment
            ?.amountPaid ||
            0
        );
    } else {
      expected =
        toNumberAmount(
          docData?.payment?.amount ||
            docData?.payment
              ?.payableTotal ||
            docData?.payableTotal ||
            0
        );

      alreadyPaid =
        toNumberAmount(
          docData?.payment?.amountPaid ||
            0
        );
    }

    /**
     * Extra amount-integrity guard:
     * Monnify recommends fulfilling only when amountPaid
     * matches the expected amount.
     *
     * We still preserve UBA's "partial" data shape when the
     * amount is below expected, but do not mark it fully paid.
     */
    const newPaidTotal =
      Math.max(
        alreadyPaid,
        paidTotal
      );

    const outstanding =
      Math.max(
        0,
        expected - newPaidTotal
      );

    const isFullyPaid =
      expected > 0 &&
      newPaidTotal >= expected;

    const nextState =
      isFullyPaid
        ? "paid"
        : newPaidTotal > 0
          ? "partial"
          : "pending";

    /**
     * =====================================================
     * IDEMPOTENCY GUARD
     * =====================================================
     *
     * If this exact Monnify transaction was already written
     * and the order is already fully paid, acknowledge it
     * without writing duplicate audit/log entries.
     */
    const existingAudit =
      docData?.paymentAudit?.[mode] ||
      {};

    const alreadyVerifiedTransaction =
      cleanString(
        existingAudit
          ?.transactionReference ||
          existingAudit
            ?.monnifyTransactionReference
      );

    if (
      isFullyPaid &&
      alreadyVerifiedTransaction &&
      transactionReference &&
      alreadyVerifiedTransaction ===
        transactionReference &&
      String(
        existingAudit?.state || ""
      ).toLowerCase() === "paid"
    ) {
      return json(200, {
        ok: true,
        duplicate: true,
        message:
          "Monnify payment already processed.",
        mode,
        paidTotal: newPaidTotal,
        orderRef: ref.path,
        requestId,
      });
    }

    /**
     * =====================================================
     * SAME INFLOW PAYLOAD SHAPE AS query-inflow.js
     * =====================================================
     */
    const first = {
      paymentReference:
        paymentReference || null,
      customerReference:
        cleanString(
          eventData?.product
            ?.reference ||
            eventData?.customerReference ||
            eventData
              ?.customer_reference
        ) || null,
    };

    const inflowPayload = {
      successfulCount: 1,
      expected,
      paidTotal: newPaidTotal,
      outstanding,
      paymentReference:
        first?.paymentReference ||
        null,
      customerReference:
        first?.customerReference ||
        null,
      amount: newPaidTotal,
      amountPaid: newPaidTotal,
      "amount paid": newPaidTotal,
      updatedAt:
        new Date().toISOString(),
    };

    /**
     * =====================================================
     * SAME PAYMENT LOG SHAPE AS query-inflow.js
     * =====================================================
     */
    const paymentLog = {
      at: new Date().toISOString(),
      mode,
      expected,
      paidTotal: newPaidTotal,
      outstanding,
      requestId,
      paymentReference:
        first?.paymentReference ||
        null,
      customerReference:
        first?.customerReference ||
        null,
    };

    /**
     * =====================================================
     * SAME PAYMENT AUDIT SHAPE AS query-inflow.js
     * =====================================================
     *
     * Provider-specific identifiers are added without
     * changing/removing any of the UBA audit keys.
     */
    const auditSnapshot = {
      mode,
      section: mode,
      state: nextState,
      lastKnownState:
        nextState,
      lastKnownStatus:
        isFullyPaid
          ? "Paid"
          : nextState,
      isFullyPaid,
      expected,
      paidTotal:
        newPaidTotal,
      amountPaid:
        newPaidTotal,
      amount:
        newPaidTotal,
      "amount paid":
        newPaidTotal,
      outstanding,
      vNUBAN:
        storedVNuban ||
        destinationVNuban ||
        "",
      vaNuban:
        storedVNuban ||
        destinationVNuban ||
        "",
      paymentReference:
        first?.paymentReference ||
        null,
      customerReference:
        first?.customerReference ||
        null,
      reference:
        paymentReference ||
        null,
      successfulCount: 1,
      inflow:
        inflowPayload,
      lastKnownInflow:
        inflowPayload,
      verifiedBy:
        "monnify-webhook",
      verifiedAt:
        serverTs,
      verifiedAtIso:
        new Date().toISOString(),
      requestId,

      // Monnify-only identifiers.
      provider: "MONNIFY",
      transactionReference:
        transactionReference ||
        null,
      monnifyTransactionReference:
        transactionReference ||
        null,
      monnifyPaymentStatus:
        paymentStatus,
      monnifyPaymentMethod:
        cleanString(
          eventData?.paymentMethod ||
            eventData?.payment_method
        ) || null,
      monnifyTotalPayable:
        providerPayable || null,
      monnifySettlementAmount:
        toNumberAmount(
          eventData?.settlementAmount ||
            eventData
              ?.settlement_amount
        ) || null,
    };

    const auditHistoryLog = {
      ...auditSnapshot,
      verifiedAt:
        new Date().toISOString(),
    };

    const existingPaymentAudit =
      docData?.paymentAudit &&
      typeof docData.paymentAudit ===
        "object"
        ? docData.paymentAudit
        : {};

    /**
     * =====================================================
     * SAME paymentAudit AGGREGATE SHAPE AS query-inflow.js
     * =====================================================
     */
    const nextPaymentAudit = {
      ...existingPaymentAudit,
      [mode]:
        auditSnapshot,
      lastUpdatedMode:
        mode,
      lastKnownMode:
        mode,
      lastKnownState:
        nextState,
      lastKnownStatus:
        isFullyPaid
          ? "Paid"
          : nextState,
      lastKnownPaidTotal:
        newPaidTotal,
      lastKnownAmountPaid:
        newPaidTotal,
      lastKnownOutstanding:
        outstanding,
      lastKnownExpected:
        expected,
      lastKnownInflow:
        inflowPayload,
      lastKnownPaymentReference:
        first?.paymentReference ||
        null,
      lastKnownCustomerReference:
        first?.customerReference ||
        null,
      lastVerifiedBy:
        "monnify-webhook",
      lastVerifiedAt:
        serverTs,
      lastVerifiedAtIso:
        new Date().toISOString(),
      requestId,
    };

    /**
     * =====================================================
     * BALANCE PAYMENT
     * EXACT SAME WRITE SHAPE AS query-inflow.js
     * =====================================================
     */
    if (mode === "balance") {
      await ref.set(
        {
          updatedAt:
            serverTs,

          paymentLogs:
            fieldValue.arrayUnion(
              paymentLog
            ),

          paymentAudit:
            nextPaymentAudit,

          paymentAuditHistory:
            fieldValue.arrayUnion(
              auditHistoryLog
            ),

          balancePayment: {
            ...(docData
              ?.balancePayment ||
              {}),

            enabled: true,

            state:
              nextState,

            amountPaid:
              newPaidTotal,

            outstanding,

            paidAt:
              isFullyPaid
                ? serverTs
                : docData
                    ?.balancePayment
                    ?.paidAt ||
                  null,

            payment: {
              ...(docData
                ?.balancePayment
                ?.payment ||
                {}),

              state:
                nextState,

              paidAt:
                isFullyPaid
                  ? serverTs
                  : docData
                      ?.balancePayment
                      ?.payment
                      ?.paidAt ||
                    null,

              inflow: {
                ...(docData
                  ?.balancePayment
                  ?.payment
                  ?.inflow ||
                  {}),

                ...inflowPayload,
              },
            },
          },
        },
        { merge: true }
      );
    }

    /**
     * =====================================================
     * SHIPMENT PAYMENT
     * EXACT SAME WRITE SHAPE AS query-inflow.js
     * =====================================================
     */
    else if (
      mode === "shipment"
    ) {
      await ref.set(
        {
          updatedAt:
            serverTs,

          paymentLogs:
            fieldValue.arrayUnion(
              paymentLog
            ),

          paymentAudit:
            nextPaymentAudit,

          paymentAuditHistory:
            fieldValue.arrayUnion(
              auditHistoryLog
            ),

          shipmentPayment: {
            ...(docData
              ?.shipmentPayment ||
              {}),

            enabled: true,

            state:
              nextState,

            amountPaid:
              newPaidTotal,

            outstanding,

            paidAt:
              isFullyPaid
                ? serverTs
                : docData
                    ?.shipmentPayment
                    ?.paidAt ||
                  null,

            payment: {
              ...(docData
                ?.shipmentPayment
                ?.payment ||
                {}),

              state:
                nextState,

              paidAt:
                isFullyPaid
                  ? serverTs
                  : docData
                      ?.shipmentPayment
                      ?.payment
                      ?.paidAt ||
                    null,

              inflow: {
                ...(docData
                  ?.shipmentPayment
                  ?.payment
                  ?.inflow ||
                  {}),

                ...inflowPayload,
              },
            },
          },
        },
        { merge: true }
      );
    }

    /**
     * =====================================================
     * MAIN ORDER PAYMENT
     * EXACT SAME WRITE SHAPE AS query-inflow.js
     * =====================================================
     */
    else {
      await ref.set(
        {
          updatedAt:
            serverTs,

          paymentLogs:
            fieldValue.arrayUnion(
              paymentLog
            ),

          paymentAudit:
            nextPaymentAudit,

          paymentAuditHistory:
            fieldValue.arrayUnion(
              auditHistoryLog
            ),

          orderStatus:
            isFullyPaid
              ? "Paid"
              : docData
                  ?.orderStatus ||
                "Pending",

          payment: {
            ...(docData
              ?.payment ||
              {}),

            status:
              isFullyPaid
                ? "Paid"
                : nextState,

            paidAt:
              isFullyPaid
                ? serverTs
                : docData
                    ?.payment
                    ?.paidAt ||
                  null,

            amountPaid:
              newPaidTotal,

            outstanding,

            inflow: {
              ...(docData
                ?.payment
                ?.inflow ||
                {}),

              ...inflowPayload,
            },
          },
        },
        { merge: true }
      );
    }


    // Keep the direct Monnify linkage in sync with the order.
    await linkRef.set(
      {
        status: isFullyPaid ? "paid" : nextState,
        verified: true,
        paymentStatus,
        amountPaid: newPaidTotal,
        outstanding,
        expected,
        verifiedTransactionReference:
          transactionReference || null,
        lastWebhookEventType: eventType,
        lastWebhookRequestId: requestId,
        rawWebhook: body,
        paidAt: isFullyPaid
          ? serverTs
          : linkData?.paidAt || null,
        verifiedAt: serverTs,
        verifiedAtIso: new Date().toISOString(),
        updatedAt: serverTs,
      },
      { merge: true },
    );

    const updated = {
      orderRef:
        ref.path,
      mode,
      state:
        nextState,
      paid:
        isFullyPaid,
      paidTotal:
        newPaidTotal,
      outstanding,
      expected,
      auditSaved: true,
      audit: {
        mode,
        state:
          nextState,
        paidTotal:
          newPaidTotal,
        outstanding,
        expected,
        paymentReference:
          first?.paymentReference ||
          null,
        customerReference:
          first?.customerReference ||
          null,
      },
    };

    console.log(
      "Monnify payment processed:",
      {
        requestId,
        userId,
        orderId,
        mode,
        orderRef:
          ref.path,
        paymentReference,
        transactionReference,
        expected,
        paidTotal:
          newPaidTotal,
        outstanding,
        state:
          nextState,
      }
    );

    return json(200, {
      ok: true,
      mode,
      paidTotal:
        newPaidTotal,
      successful: [
        {
          status:
            "successful",
          paymentReference,
          customerReference:
            first
              ?.customerReference ||
            null,
          amount:
            paidTotal,
          amountNormalized:
            paidTotal,
          transactionReference:
            transactionReference ||
            null,
          paymentStatus,
        },
      ],
      updated,
      requestId,
    });
  } catch (err) {
    console.error(
      "monnify-webhook error:",
      err
    );

    return json(500, {
      ok: false,
      message:
        err?.message ||
        "Server error",
      requestId,
    });
  }
};