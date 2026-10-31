const vasClient = require("./_lib/vasClient");

/**
 * PUT /.netlify/functions/update-virtual-account
 * Body: { accountNumber: "6200000044", ...updateFields }
 *
 * This function:
 * 1) expects accountNumber in body
 * 2) encrypts the remaining payload with AES
 * 3) calls UBA VAS: PUT /api/v1/virtual/accounts/{account-number}
 * 4) decrypts response and returns clear JSON to frontend
 */
exports.handler = async (event) => {
  if (event.httpMethod !== "PUT") {
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

    const { accountNumber, ...updatePayload } = body;

    if (!accountNumber) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "accountNumber is required" }),
      };
    }

    const result = await vasClient.request({
      method: "PUT",
      path: `/api/v1/virtual/accounts/${encodeURIComponent(accountNumber)}`,
      payload: updatePayload,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error("update-virtual-account error:", err);

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
