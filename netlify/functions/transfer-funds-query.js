const vasClient = require("./_lib/vasClient");

/**
 * POST /.netlify/functions/transfer-funds-query
 * Body: { transactionRef, stan? }
 *
 * Calls UBA VAS:
 * POST /api/v1/transactions/transfer-funds/query
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

    const { transactionRef, stan } = body;

    if (!transactionRef) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Missing required field",
          missing: ["transactionRef"],
        }),
      };
    }

    const payload = { transactionRef };
    if (stan) payload.stan = stan; // optional

    const result = await vasClient.request({
      method: "POST",
      path: "/api/v1/transactions/transfer-funds/query",
      payload,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error("transfer-funds-query error:", err);

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
