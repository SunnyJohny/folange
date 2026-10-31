const vasClient = require("./_lib/vasClient");

/**
 * GET /.netlify/functions/get-virtual-account?accountNumber=6200000044
 *
 * This function:
 * 1) reads accountNumber from queryStringParameters
 * 2) calls UBA VAS: GET /api/v1/virtual/accounts/{account-number}
 * 3) decrypts response and returns clear JSON to frontend
 */
exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: "Method Not Allowed" }),
    };
  }

  try {
    const accountNumber =
      event.queryStringParameters?.accountNumber ||
      event.queryStringParameters?.account ||
      null;

    if (!accountNumber) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "accountNumber is required" }),
      };
    }

    const result = await vasClient.request({
      method: "GET",
      path: `/api/v1/virtual/accounts/${encodeURIComponent(accountNumber)}`,
      payload: null, // GET has no body
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error("get-virtual-account error:", err);

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
