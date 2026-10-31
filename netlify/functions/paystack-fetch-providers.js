// netlify/functions/paystack-fetch-providers.js
// This function has no Firestore reads or writes; provider values come from Paystack.
// For local testing, PAYSTACK_SECRET_KEY must contain your server-side test key.

const PAYSTACK_BASE_URL = "https://api.paystack.co";

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return jsonResponse(405, {
      success: false,
      message: "Method not allowed. Use GET.",
    });
  }

  const secretKey = String(process.env.PAYSTACK_SECRET_KEY || "").trim();

  if (!secretKey) {
    console.error("PAYSTACK_SECRET_KEY is missing from Netlify environment variables.");
    return jsonResponse(500, {
      success: false,
      message: "Paystack has not been configured on the server.",
    });
  }

  try {
    const response = await fetch(
      `${PAYSTACK_BASE_URL}/dedicated_account/available_providers`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${secretKey}` },
      },
    );

    let paystackResponse;

    try {
      paystackResponse = await response.json();
    } catch (error) {
      console.error("Unable to parse Paystack provider response:", error);
      return jsonResponse(502, {
        success: false,
        message: "Paystack returned an unreadable provider response.",
      });
    }

    if (!response.ok || paystackResponse?.status !== true) {
      console.error("Paystack Fetch Providers failed:", paystackResponse);
      return jsonResponse(response.status >= 400 ? response.status : 502, {
        success: false,
        message:
          paystackResponse?.message || "Unable to retrieve Paystack DVA providers.",
        provider: "paystack",
      });
    }

    const rawProviders = Array.isArray(paystackResponse?.data)
      ? paystackResponse.data
      : [];

    const providers = rawProviders
      .map((provider) => ({
        provider_slug: provider?.provider_slug || "",
        bank_id: provider?.bank_id ?? null,
        bank_name: provider?.bank_name || "",
        id: provider?.id ?? null,
      }))
      .filter((provider) => provider.provider_slug && provider.bank_name);

    if (!providers.length) {
      return jsonResponse(200, {
        success: true,
        provider: "paystack",
        message:
          paystackResponse?.message || "Dedicated account providers retrieved.",
        data: [],
      });
    }

    return jsonResponse(200, {
      success: true,
      provider: "paystack",
      message: paystackResponse?.message || "Dedicated account providers retrieved.",
      data: providers,
    });
  } catch (error) {
    console.error("Paystack Fetch Providers network error:", error);
    return jsonResponse(500, {
      success: false,
      provider: "paystack",
      message:
        "Unable to communicate with Paystack right now. Please try again.",
    });
  }
};