// netlify/functions/init-monnify-virtual-account.js
//
// Monnify custom bank-transfer virtual account flow.
// Server-side only:
//   1. Authenticate with API key + secret key.
//   2. Initialize a transaction.
//   3. Initialize bank-transfer payment to receive the dynamic VA.
//
// Required environment variables:
//   MONNIFY_API_KEY
//   MONNIFY_SECRET_KEY
//   MONNIFY_CONTRACT_CODE
//
// Optional:
//   MONNIFY_BASE_URL       (defaults to sandbox)
//   MONNIFY_BANK_CODE      (defaults to Moniepoint MFB: 50515)
//   MONNIFY_REDIRECT_URL   (falls back to SITE_URL)
//
// Monnify credentials must NEVER be exposed to React.


let admin = null;

const initFirebaseAdminIfAvailable = () => {
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
  } catch (error) {
    console.error(
      "Monnify Firebase Admin init failed:",
      error?.message || error,
    );
    return null;
  }
};

const isSafeFirestoreId = (value) => {
  const v = String(value ?? "").trim();
  return !!v && !v.includes("/");
};

const MONNIFY_BASE_URL = String(
  process.env.MONNIFY_BASE_URL || "https://sandbox.monnify.com",
).replace(/\/+$/, "");

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  },
  body: JSON.stringify(body),
});

const clean = (value) => String(value ?? "").trim();

const toPositiveAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

const parseJsonSafe = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

const getAccessToken = async () => {
  const apiKey = clean(process.env.MONNIFY_API_KEY);
  const secretKey = clean(process.env.MONNIFY_SECRET_KEY);

  if (!apiKey || !secretKey) {
    throw new Error(
      "MONNIFY_API_KEY or MONNIFY_SECRET_KEY is missing from the server environment.",
    );
  }

  const credentials = Buffer.from(`${apiKey}:${secretKey}`).toString("base64");

  const response = await fetch(`${MONNIFY_BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  const data = await parseJsonSafe(response);
  const token = clean(data?.responseBody?.accessToken);

  if (!response.ok || !data?.requestSuccessful || !token) {
    const message =
      data?.responseMessage ||
      data?.responseBody?.message ||
      `Monnify authentication failed (${response.status}).`;

    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return token;
};

exports.handler = async (event) => {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (event.httpMethod !== "POST") {
    return json(405, {
      success: false,
      message: "Method Not Allowed",
      requestId,
    });
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    const amount = toPositiveAmount(body?.amount);
    const email = clean(body?.email);
    const paymentReference = clean(
      body?.paymentReference ||
        body?.payment_reference ||
        body?.reference,
    );
    const orderId = clean(body?.orderId);
    const userId = clean(body?.userId);
    const mode = ["shipment", "balance"].includes(
      clean(body?.mode).toLowerCase(),
    )
      ? clean(body?.mode).toLowerCase()
      : "order";
    const customerName =
      clean(body?.customerName) || "Import with Bliss Customer";

    if (!amount) {
      return json(400, {
        success: false,
        message: "A valid amount is required.",
        requestId,
      });
    }

    if (!email) {
      return json(400, {
        success: false,
        message: "Customer email is required.",
        requestId,
      });
    }

    if (!paymentReference) {
      return json(400, {
        success: false,
        message: "A unique paymentReference is required.",
        requestId,
      });
    }

    if (!isSafeFirestoreId(userId) || !isSafeFirestoreId(orderId)) {
      return json(400, {
        success: false,
        message:
          "A valid userId and orderId are required for Monnify payment linkage.",
        requestId,
      });
    }

    const contractCode = clean(process.env.MONNIFY_CONTRACT_CODE);

    if (!contractCode) {
      return json(500, {
        success: false,
        message: "MONNIFY_CONTRACT_CODE is missing from the server environment.",
        requestId,
      });
    }

    const adminSdk = initFirebaseAdminIfAvailable();

    if (!adminSdk) {
      return json(503, {
        success: false,
        message:
          "Firebase Admin is unavailable, so the Monnify payment cannot be safely linked to the order.",
        requestId,
      });
    }

    const db = adminSdk.firestore();
    const orderPath = `users/${userId}/orders/${orderId}`;
    const orderRef = db.doc(orderPath);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      return json(404, {
        success: false,
        message:
          "Order not found. Monnify account generation was stopped before creating an unlinked payment.",
        orderPath,
        requestId,
      });
    }

    const accessToken = await getAccessToken();

    const redirectUrl =
      clean(process.env.MONNIFY_REDIRECT_URL) ||
      clean(process.env.SITE_URL) ||
      "http://localhost:8888";

    const initPayload = {
      amount,
      customerEmail: email,
      paymentReference,
      paymentDescription: `Import with Bliss ${mode} payment`,
      currencyCode: "NGN",
      contractCode,
      redirectUrl,
      paymentMethods: ["ACCOUNT_TRANSFER"],
      metadata: {
        source: "ImportWithBliss",
        userId,
        orderId,
        orderPath,
        mode,
        customerName,
      },
    };

    console.log("Monnify initialize transaction request:", {
      requestId,
      baseUrl: MONNIFY_BASE_URL,
      amount,
      email,
      paymentReference,
      orderId,
      mode,
    });

    const initResponse = await fetch(
      `${MONNIFY_BASE_URL}/api/v1/merchant/transactions/init-transaction`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(initPayload),
      },
    );

    const initData = await parseJsonSafe(initResponse);

    if (!initResponse.ok || !initData?.requestSuccessful) {
      const message =
        initData?.responseMessage ||
        initData?.responseBody?.message ||
        `Monnify transaction initialization failed (${initResponse.status}).`;

      console.error("Monnify initialize transaction failed:", {
        requestId,
        status: initResponse.status,
        response: initData,
      });

      return json(initResponse.status || 502, {
        success: false,
        message,
        providerStatus: initResponse.status,
        providerResponse: initData,
        requestId,
      });
    }

    const initBody = initData?.responseBody || {};
    const transactionReference = clean(
      initBody?.transactionReference ||
        initBody?.transaction_reference,
    );

    if (!transactionReference) {
      return json(502, {
        success: false,
        message:
          "Monnify initialized the payment but did not return a transaction reference.",
        providerResponse: initData,
        requestId,
      });
    }

    const bankCode = clean(process.env.MONNIFY_BANK_CODE || "50515");

    const transferResponse = await fetch(
      `${MONNIFY_BASE_URL}/api/v1/merchant/bank-transfer/init-payment`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          transactionReference,
          ...(bankCode ? { bankCode } : {}),
        }),
      },
    );

    const transferData = await parseJsonSafe(transferResponse);

    if (!transferResponse.ok || !transferData?.requestSuccessful) {
      const message =
        transferData?.responseMessage ||
        transferData?.responseBody?.message ||
        `Monnify bank-transfer initialization failed (${transferResponse.status}).`;

      console.error("Monnify bank-transfer init failed:", {
        requestId,
        status: transferResponse.status,
        transactionReference,
        response: transferData,
      });

      return json(transferResponse.status || 502, {
        success: false,
        message,
        transactionReference,
        providerStatus: transferResponse.status,
        providerResponse: transferData,
        requestId,
      });
    }

    const transferBody = transferData?.responseBody || {};

    const accountNumber = clean(
      transferBody?.accountNumber ||
        transferBody?.account_number,
    );

    if (!accountNumber) {
      return json(502, {
        success: false,
        message:
          "Monnify bank-transfer initialization succeeded but no account number was returned.",
        transactionReference,
        providerResponse: transferData,
        requestId,
      });
    }

    const accountDurationSeconds = Number(
      transferBody?.accountDurationSeconds ??
        transferBody?.account_duration_seconds ??
        2400,
    );

    const safeDurationSeconds =
      Number.isFinite(accountDurationSeconds) && accountDurationSeconds > 0
        ? Math.min(accountDurationSeconds, 2400)
        : 2400;

    const expireAt = new Date(
      Date.now() + safeDurationSeconds * 1000,
    ).toISOString();


    // =========================================================
    // DIRECT MONNIFY -> ORDER LINK
    // =========================================================
    // The webhook reads this exact document by paymentReference.
    // This avoids collectionGroup("orders") queries and therefore
    // requires no Firestore collection-group index.
    const fieldValue = adminSdk.firestore.FieldValue;

    const monnifyLinkRef = db
      .collection("monnify_transactions")
      .doc(paymentReference);

    await monnifyLinkRef.set(
      {
        provider: "MONNIFY",
        status: "pending",
        verified: false,

        userId,
        orderId,
        orderPath,
        mode,

        paymentReference,
        transactionReference,

        amount,
        expectedAmount: amount,
        currency:
          clean(transferBody?.currencyCode) ||
          clean(transferBody?.currency) ||
          "NGN",

        accountNumber,
        accountName:
          clean(transferBody?.accountName) ||
          clean(transferBody?.account_name) ||
          customerName,
        bankName:
          clean(transferBody?.bankName) ||
          clean(transferBody?.bank_name) ||
          "Moniepoint MFB",

        expireAt,
        accountDurationSeconds: safeDurationSeconds,

        customerEmail: email,
        customerName,

        environment: MONNIFY_BASE_URL.includes("sandbox.monnify.com")
          ? "sandbox"
          : "live",

        requestId,

        createdAt: fieldValue.serverTimestamp(),
        updatedAt: fieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const responsePayload = {
      success: true,
      provider: "MONNIFY",
      type: "DYNAMIC",
      accountNumber,
      accountName:
        clean(transferBody?.accountName) ||
        clean(transferBody?.account_name) ||
        customerName,
      bankName:
        clean(transferBody?.bankName) ||
        clean(transferBody?.bank_name) ||
        "Moniepoint MFB",
      amount,
      expectedAmount: amount,
      currency:
        clean(transferBody?.currencyCode) ||
        clean(transferBody?.currency) ||
        "NGN",
      paymentReference,
      transactionReference,
      accountDurationSeconds: safeDurationSeconds,
      expireAt,
      ussdPayment:
        transferBody?.ussdPayment ||
        transferBody?.ussd_payment ||
        null,
      requestId,
    };

    console.log("Monnify dynamic VA success:", {
      requestId,
      accountNumber,
      bankName: responsePayload.bankName,
      amount,
      paymentReference,
      transactionReference,
      orderPath,
      expireAt,
      linkageSaved: true,
    });

    return json(200, responsePayload);
  } catch (error) {
    console.error("Monnify VA function error:", {
      requestId,
      message: error?.message || String(error),
      status: error?.status || null,
      data: error?.data || null,
    });

    return json(error?.status || 500, {
      success: false,
      message:
        error?.message ||
        "Unable to generate Monnify virtual account.",
      requestId,
    });
  }
};