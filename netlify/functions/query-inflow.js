// netlify/functions/query-inflow.js
const vasClient = require("./_lib/vasClient");

let admin = null;

function toNumberAmount(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function sumSuccessfulAmounts(successful = []) {
  if (!Array.isArray(successful)) return 0;

  return successful.reduce(
    (acc, x) =>
      acc +
      toNumberAmount(
        x?.amountNormalized ??
          x?.amount ??
          x?.Amount ??
          x?.paidAmount ??
          0
      ),
    0
  );
}

function initFirebaseAdminIfAvailable() {
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) return null;

    if (!admin) admin = require("firebase-admin");
    if (admin.apps?.length) return admin;

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
    console.warn("Firebase Admin init failed:", e?.message || e);
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({
        ok: false,
        message: "Method Not Allowed",
      }),
    };
  }

  const requestId = `${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    const modeRaw = String(body?.mode || "")
      .trim()
      .toLowerCase();

    const mode =
      modeRaw === "shipment"
        ? "shipment"
        : modeRaw === "balance"
        ? "balance"
        : "order";

    const vNUBAN = String(
      body?.vNUBAN ||
        body?.vaNuban ||
        ""
    )
      .replace(/\D/g, "")
      .trim();

    if (!vNUBAN) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          ok: false,
          message: "vNUBAN is required",
        }),
      };
    }

    const startDate = String(body?.startDate || "").trim();
    const endDate = String(body?.endDate || "").trim();

    const result = await vasClient.queryVirtualAccountInflow({
      vNUBAN,
      startDate,
      endDate,
    });

    const inflows =
      result?.data?.provider_response?.data ||
      result?.data?.provider_response?.inflows ||
      [];

    const successful = Array.isArray(inflows)
      ? inflows.filter(
          (x) =>
            String(x?.status || "")
              .trim()
              .toLowerCase() === "successful"
        )
      : [];

    const orderRefFromClient = String(
      body?.paymentReference ||
        body?.reference ||
        body?.customerReference ||
        ""
    ).trim();

    const filteredSuccessful = orderRefFromClient
      ? successful.filter(
          (x) =>
            String(x?.paymentReference || "").trim() ===
              orderRefFromClient ||
            String(x?.customerReference || "").trim() ===
              orderRefFromClient
        )
      : successful;

    const paidTotal = sumSuccessfulAmounts(filteredSuccessful);

    const first = filteredSuccessful[0] || null;

    let updated = null;

    const markPaid = body?.markPaid === true;

    const userId = String(body?.userId || "").trim();

    const orderId = String(body?.orderId || "").trim();

    const orderPath = String(body?.orderPath || "").trim();

    const firestoreNamespace = String(
      body?.firestoreNamespace || "charex/main"
    )
      .trim()
      .replace(/^\/+|\/+$/g, "");

    if (firestoreNamespace !== "charex/main") {
      return {
        statusCode: 400,
        body: JSON.stringify({
          ok: false,
          message: "Invalid Firestore namespace.",
          requestId,
        }),
      };
    }

    if (markPaid && filteredSuccessful.length) {
      const adminSdk = initFirebaseAdminIfAvailable();

      // SAFETY GUARD: reconciliation must never claim that it updated an order
      // when the server has no usable Firebase Admin connection.
      if (!adminSdk) {
        return {
          statusCode: 503,
          body: JSON.stringify({
            ok: false,
            message: "Payment was found, but order verification is temporarily unavailable.",
            requestId,
          }),
        };
      }

      // SAFETY GUARD: only accept a canonical charex/main/users/{uid}/orders/{orderId}
      // target. Firebase Admin bypasses client security rules, so the browser
      // must not be allowed to redirect this function to another document.
      if (
        !userId ||
        !orderId ||
        userId.includes("/") ||
        orderId.includes("/")
      ) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            ok: false,
            message: "A valid userId and orderId are required to update payment.",
            requestId,
          }),
        };
      }

      const canonicalOrderPath = `${firestoreNamespace}/users/${userId}/orders/${orderId}`;

      if (orderPath && orderPath !== canonicalOrderPath) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            ok: false,
            message: "The supplied order path does not match the user and order.",
            requestId,
          }),
        };
      }

      const db = adminSdk.firestore();

      const ref = db.doc(canonicalOrderPath);

      const snap = await ref.get();

      // SAFETY GUARD: set(..., { merge: true }) creates a document when it is
      // missing. Stop here so reconciliation can never create a partial/ghost
      // order when the original order was not successfully saved.
      if (!snap.exists) {
        return {
          statusCode: 404,
          body: JSON.stringify({
            ok: false,
            message: "Order not found. No payment update was written.",
            orderRef: canonicalOrderPath,
            requestId,
          }),
        };
      }

      const docData = snap.data() || {};

      // SAFETY GUARD: where an order already stores its VA, require it to match
      // the VA queried by this request. Legacy orders without a stored VA keep
      // the earlier working behaviour.
      const storedVNuban = String(
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
              "",
      )
        .replace(/\D/g, "")
        .trim();

      if (storedVNuban && storedVNuban !== vNUBAN) {
        return {
          statusCode: 409,
          body: JSON.stringify({
            ok: false,
            message: "The virtual account does not belong to this order.",
            orderRef: canonicalOrderPath,
            requestId,
          }),
        };
      }

        const fieldValue = adminSdk.firestore.FieldValue;

        const serverTs = fieldValue.serverTimestamp();

        let expected = 0;
        let alreadyPaid = 0;

        if (mode === "balance") {
          expected = toNumberAmount(
            docData?.balancePayment?.payment?.amount ||
              docData?.balancePayment?.payableTotal ||
              docData?.balancePayment?.amount ||
              0
          );

          alreadyPaid = toNumberAmount(
            docData?.balancePayment?.amountPaid ||
              docData?.balancePayment?.payment?.inflow?.paidTotal ||
              docData?.balancePayment?.payment?.inflow?.["amount paid"] ||
              0
          );
        } else if (mode === "shipment") {
          expected = toNumberAmount(
            docData?.shipmentPayment?.payment?.amount ||
              docData?.shipmentPayment?.amount ||
              docData?.shipmentFee ||
              0
          );

          alreadyPaid = toNumberAmount(
            docData?.shipmentPayment?.amountPaid || 0
          );
        } else {
          expected = toNumberAmount(
            docData?.payment?.amount ||
              docData?.payment?.payableTotal ||
              docData?.payableTotal ||
              0
          );

          alreadyPaid = toNumberAmount(
            docData?.payment?.amountPaid || 0
          );
        }

        const newPaidTotal = Math.max(
          alreadyPaid,
          paidTotal
        );

        const outstanding = Math.max(
          0,
          expected - newPaidTotal
        );

        const isFullyPaid =
          expected > 0 &&
          newPaidTotal >= expected;

        const nextState = isFullyPaid
          ? "paid"
          : newPaidTotal > 0
          ? "partial"
          : "pending";

        const inflowPayload = {
          successfulCount: filteredSuccessful.length,
          expected,
          paidTotal: newPaidTotal,
          outstanding,
          paymentReference:
            first?.paymentReference || null,
          customerReference:
            first?.customerReference || null,
          amount: newPaidTotal,
          amountPaid: newPaidTotal,
          "amount paid": newPaidTotal,
          updatedAt: new Date().toISOString(),
        };

        const paymentLog = {
          at: new Date().toISOString(),
          mode,
          expected,
          paidTotal: newPaidTotal,
          outstanding,
          requestId,
          paymentReference:
            first?.paymentReference || null,
          customerReference:
            first?.customerReference || null,
        };

        const auditSnapshot = {
          mode,
          section: mode,
          state: nextState,
          lastKnownState: nextState,
          lastKnownStatus: isFullyPaid ? "Paid" : nextState,
          isFullyPaid,
          expected,
          paidTotal: newPaidTotal,
          amountPaid: newPaidTotal,
          amount: newPaidTotal,
          "amount paid": newPaidTotal,
          outstanding,
          vNUBAN,
          vaNuban: vNUBAN,
          paymentReference:
            first?.paymentReference || null,
          customerReference:
            first?.customerReference || null,
          reference:
            orderRefFromClient || null,
          successfulCount: filteredSuccessful.length,
          inflow: inflowPayload,
          lastKnownInflow: inflowPayload,
          verifiedBy: "query-inflow",
          verifiedAt: serverTs,
          verifiedAtIso: new Date().toISOString(),
          requestId,
        };

        const auditHistoryLog = {
          ...auditSnapshot,
          verifiedAt: new Date().toISOString(),
        };

        const existingPaymentAudit =
          docData?.paymentAudit &&
          typeof docData.paymentAudit === "object"
            ? docData.paymentAudit
            : {};

        const nextPaymentAudit = {
          ...existingPaymentAudit,
          [mode]: auditSnapshot,
          lastUpdatedMode: mode,
          lastKnownMode: mode,
          lastKnownState: nextState,
          lastKnownStatus: isFullyPaid ? "Paid" : nextState,
          lastKnownPaidTotal: newPaidTotal,
          lastKnownAmountPaid: newPaidTotal,
          lastKnownOutstanding: outstanding,
          lastKnownExpected: expected,
          lastKnownInflow: inflowPayload,
          lastKnownPaymentReference:
            first?.paymentReference || null,
          lastKnownCustomerReference:
            first?.customerReference || null,
          lastVerifiedBy: "query-inflow",
          lastVerifiedAt: serverTs,
          lastVerifiedAtIso: new Date().toISOString(),
          requestId,
        };

        // =========================================================
        // BALANCE PAYMENT
        // =========================================================
        if (mode === "balance") {
          await ref.set(
            {
              updatedAt: serverTs,

              paymentLogs: fieldValue.arrayUnion(
                paymentLog
              ),

              paymentAudit: nextPaymentAudit,

              paymentAuditHistory: fieldValue.arrayUnion(
                auditHistoryLog
              ),

              balancePayment: {
                ...(docData?.balancePayment || {}),

                enabled: true,

                state: nextState,

                amountPaid: newPaidTotal,

                outstanding,

                paidAt: isFullyPaid
                  ? serverTs
                  : docData?.balancePayment?.paidAt ||
                    null,

                payment: {
                  ...(docData?.balancePayment?.payment ||
                    {}),

                  state: nextState,

                  paidAt: isFullyPaid
                    ? serverTs
                    : docData?.balancePayment?.payment
                        ?.paidAt || null,

                  inflow: {
                    ...(docData?.balancePayment?.payment
                      ?.inflow || {}),

                    ...inflowPayload,
                  },
                },
              },
            },
            { merge: true }
          );
        }

        // =========================================================
        // SHIPMENT PAYMENT
        // =========================================================
        else if (mode === "shipment") {
          await ref.set(
            {
              updatedAt: serverTs,

              paymentLogs: fieldValue.arrayUnion(
                paymentLog
              ),

              paymentAudit: nextPaymentAudit,

              paymentAuditHistory: fieldValue.arrayUnion(
                auditHistoryLog
              ),

              shipmentPayment: {
                ...(docData?.shipmentPayment || {}),

                enabled: true,

                state: nextState,

                amountPaid: newPaidTotal,

                outstanding,

                paidAt: isFullyPaid
                  ? serverTs
                  : docData?.shipmentPayment?.paidAt ||
                    null,

                payment: {
                  ...(docData?.shipmentPayment
                    ?.payment || {}),

                  state: nextState,

                  paidAt: isFullyPaid
                    ? serverTs
                    : docData?.shipmentPayment?.payment
                        ?.paidAt || null,

                  inflow: {
                    ...(docData?.shipmentPayment
                      ?.payment?.inflow || {}),

                    ...inflowPayload,
                  },
                },
              },
            },
            { merge: true }
          );
        }

        // =========================================================
        // MAIN ORDER PAYMENT
        // =========================================================
        else {
          await ref.set(
            {
              updatedAt: serverTs,

              paymentLogs: fieldValue.arrayUnion(
                paymentLog
              ),

              paymentAudit: nextPaymentAudit,

              paymentAuditHistory: fieldValue.arrayUnion(
                auditHistoryLog
              ),

              orderStatus: isFullyPaid
                ? "Paid"
                : docData?.orderStatus || "Pending",

              payment: {
                ...(docData?.payment || {}),

                status: isFullyPaid
                  ? "Paid"
                  : nextState,

                paidAt: isFullyPaid
                  ? serverTs
                  : docData?.payment?.paidAt || null,

                amountPaid: newPaidTotal,

                outstanding,

                inflow: {
                  ...(docData?.payment?.inflow || {}),

                  ...inflowPayload,
                },
              },
            },
            { merge: true }
          );
        }

        updated = {
          orderRef: ref.path,
          mode,
          state: nextState,
          paid: isFullyPaid,
          paidTotal: newPaidTotal,
          outstanding,
          expected,
          auditSaved: true,
          audit: {
            mode,
            state: nextState,
            paidTotal: newPaidTotal,
            outstanding,
            expected,
            paymentReference:
              first?.paymentReference || null,
            customerReference:
              first?.customerReference || null,
          },
        };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        mode,
        firestoreNamespace,
        paidTotal,
        successful: filteredSuccessful,
        updated,
      }),
    };
  } catch (err) {
    console.error("query-inflow error:", err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        message: err?.message || "Server error",
      }),
    };
  }
};