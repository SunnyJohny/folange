const vasClient = require("./_lib/vasClient");

/**
 * GET /.netlify/functions/list-virtual-accounts
 *
 * This function:
 * 1) calls UBA VAS: GET /api/v1/virtual/accounts
 * 2) decrypts response and returns clear JSON to frontend
 */
exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: "Method Not Allowed" }),
    };
  }

  try {
    const result = await vasClient.request({
      method: "GET",
      path: "/api/v1/virtual/accounts",
      payload: null, // GET has no body
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error("list-virtual-accounts error:", err);

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
