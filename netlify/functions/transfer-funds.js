const vasClient = require("./_lib/vasClient");

/**
 * POST /.netlify/functions/transfer-funds
 * Body: {
 *   transactionRef,
 *   sourceAccount,
 *   destinationAccount,
 *   transferAmount,
 *   narration,
 *   destinationAccountName,
 *   destinationBankCode? (optional)
 * }
 *
 * Calls UBA VAS:
 * POST /api/v1/transactions/transfer-funds
 */
exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: "Method Not Allowed" }),
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : null;

    if (!body || typeof body !== "object") {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Invalid JSON body" }),
      };
    }

    const {
      transactionRef,
      sourceAccount,
      destinationAccount,
      transferAmount,
      narration,
      destinationAccountName,
      destinationBankCode,
    } = body;

    // Basic validation for required fields
    const missing = [];
    if (!transactionRef) missing.push("transactionRef");
    if (!sourceAccount) missing.push("sourceAccount");
    if (!destinationAccount) missing.push("destinationAccount");
    if (!transferAmount) missing.push("transferAmount");
    if (!narration) missing.push("narration");
    if (!destinationAccountName) missing.push("destinationAccountName");

    if (missing.length) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Missing required fields",
          missing,
        }),
      };
    }

    const payload = {
      transactionRef,
      sourceAccount,
      destinationAccount,
      transferAmount,
      narration,
      destinationAccountName,
    };

    // Only include if provided
    if (destinationBankCode) payload.destinationBankCode = destinationBankCode;

    const result = await vasClient.request({
      method: "POST",
      path: "/api/v1/transactions/transfer-funds",
      payload,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error("transfer-funds error:", err);

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Server error",
        error: err.message || String(err),
      }),
    };
  }
};
