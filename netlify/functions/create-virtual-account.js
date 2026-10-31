// const vasClient = require("./_lib/vasClient");

// exports.handler = async (event) => {
//   if (event.httpMethod !== "POST") {
//     return {
//       statusCode: 405,
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ message: "Method Not Allowed" }),
//     };
//   }

//   // useful request id to match browser response with Netlify logs
//   const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

//   // ✅ DEBUG SWITCH
//   const debugOn =
//     event.queryStringParameters?.debug === "1" ||
//     event.headers?.["x-debug"] === "1" ||
//     event.headers?.["X-Debug"] === "1";

//   try {
//     // ✅ Parse body safely
//     let body = null;
//     try {
//       body = event.body ? JSON.parse(event.body) : null;
//     } catch (e) {
//       return {
//         statusCode: 400,
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ ok: false, message: "Invalid JSON body", requestId }),
//       };
//     }

//     if (!body || typeof body !== "object") {
//       return {
//         statusCode: 400,
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ ok: false, message: "Invalid JSON body", requestId }),
//       };
//     }

//     // ✅ minimal validations (avoid silent VAS failures)
//     const bvn = String(body?.bvn || "").replace(/\D/g, ""); // strip non-digits
//     if (!/^\d{11}$/.test(bvn)) {
//       return {
//         statusCode: 400,
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ ok: false, message: "BVN must be 11 digits", requestId }),
//       };
//     }

//     if (!body?.customerReference) {
//       return {
//         statusCode: 400,
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify(
//           { ok: false, message: "customerReference is required", requestId }
//         ),
//       };
//     }

//     if (!body?.merchant?.code) {
//       return {
//         statusCode: 400,
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify(
//           { ok: false, message: "merchant.code is required", requestId }
//         ),
//       };
//     }

//     // ✅ OPTIONAL normalizers (helps common VAS validation)
//     const phoneDigits = body?.phone ? String(body.phone).replace(/\D/g, "") : "";
//     const normalizedBody = {
//       ...body,
//       bvn,
//       ...(body?.phone ? { phone: phoneDigits } : {}),
//       ...(body?.email ? { email: String(body.email).trim() } : {}),
//       ...(body?.accountName
//         ? {}
//         : {
//             accountName: `${String(body.firstName || "").trim()} ${String(
//               body.lastName || ""
//             ).trim()}`.trim(),
//           }),
//     };

//     // ✅ Call VAS
//     const result = await vasClient.openVirtualAccount(normalizedBody);

//     console.log("VAS create-virtual-account success:", {
//       requestId,
//       status: result?.status,
//       message: result?.message,
//       provider_code: result?.data?.provider_response_code,
//       hasVA: !!result?.data?.provider_response?.virtualAccount?.vNUBAN,
//     });

//     return {
//       statusCode: 200,
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ requestId, ...result }),
//     };
//   } catch (err) {
//     const upstreamStatus = err?.response?.status || err?.status || null;
//     const upstreamData = err?.response?.data || err?.data || null;

//     console.error("create-virtual-account error:", {
//       requestId,
//       message: err?.message || String(err),
//       name: err?.name,
//       code: err?.code,
//       upstreamStatus,
//       upstreamData,
//       signatureMode: err?.signatureMode || null, // ✅ ADD THIS
//       decrypted: err?.decrypted,
//       decryptedJson: err?.decryptedJson,
//       decryptError: err?.decryptError,
//       stack: err?.stack,
//       debugOn,
//     });

//     const responseBody = {
//       ok: false,
//       requestId,
//       message: "VAS error",
//       upstreamStatus,
//       upstreamData: upstreamData || null,

//       // ✅ always include internal/debug for now
//       internal: {
//         name: err?.name,
//         code: err?.code,
//         message: err?.message || String(err),
//         signatureMode: err?.signatureMode || null, // ✅ ADD THIS
//         stackTop: (err?.stack || "").split("\n").slice(0, 8).join("\n"),
//       },

//       // ✅ THESE are the important fields from vasClient:
//       decrypted: err?.decrypted || null,
//       decryptedJson: err?.decryptedJson || null,
//       decryptError: err?.decryptError || null,

//       // helpful for confirming debug path
//       debugOn,
//     };

//     return {
//       statusCode: upstreamStatus || 500,
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify(responseBody),
//     };
//   }
// };


// const vasClient = require("./_lib/vasClient");

// function toTitleCase(value = "") {
//   return String(value)
//     .trim()
//     .toLowerCase()
//     .replace(/\s+/g, " ")
//     .replace(/\b\w/g, (c) => c.toUpperCase());
// }

// function normalizeNgPhone(phone) {
//   const digits = String(phone || "").replace(/\D/g, "");
//   if (!digits) return "";

//   // 234XXXXXXXXXX -> 0XXXXXXXXXX
//   if (/^234\d{10}$/.test(digits)) return `0${digits.slice(3)}`;

//   // already local NG format
//   if (/^0\d{10}$/.test(digits)) return digits;

//   // fallback (leave as digits so we can inspect in logs)
//   return digits;
// }

// exports.handler = async (event) => {
//   if (event.httpMethod !== "POST") {
//     return {
//       statusCode: 405,
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ message: "Method Not Allowed" }),
//     };
//   }

//   // useful request id to match browser response with Netlify logs
//   const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

//   // ✅ DEBUG SWITCH
//   const debugOn =
//     event.queryStringParameters?.debug === "1" ||
//     event.headers?.["x-debug"] === "1" ||
//     event.headers?.["X-Debug"] === "1";

//   try {
//     // ✅ Parse body safely
//     let body = null;
//     try {
//       body = event.body ? JSON.parse(event.body) : null;
//     } catch (e) {
//       return {
//         statusCode: 400,
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ ok: false, message: "Invalid JSON body", requestId }),
//       };
//     }

//     if (!body || typeof body !== "object") {
//       return {
//         statusCode: 400,
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ ok: false, message: "Invalid JSON body", requestId }),
//       };
//     }

//     // ✅ minimal validations (doc-aligned)
//     const bvn = String(body?.bvn || "").replace(/\D/g, ""); // strip non-digits
//     if (!/^\d{11}$/.test(bvn)) {
//       return {
//         statusCode: 400,
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ ok: false, message: "BVN must be 11 digits", requestId }),
//       };
//     }

//     if (!String(body?.firstName || "").trim()) {
//       return {
//         statusCode: 400,
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ ok: false, message: "firstName is required", requestId }),
//       };
//     }

//     if (!String(body?.lastName || "").trim()) {
//       return {
//         statusCode: 400,
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ ok: false, message: "lastName is required", requestId }),
//       };
//     }

//     if (!body?.customerReference) {
//       return {
//         statusCode: 400,
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify(
//           { ok: false, message: "customerReference is required", requestId }
//         ),
//       };
//     }

//     if (!body?.merchant?.code) {
//       return {
//         statusCode: 400,
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify(
//           { ok: false, message: "merchant.code is required", requestId }
//         ),
//       };
//     }

//     // ✅ STATIC / DYNAMIC support (same endpoint per official doc)
//     const accountType = String(body?.accountType || "DYNAMIC").toUpperCase();
//     const isStatic = accountType === "STATIC";

//     const hasSingleDepositLimit =
//       body?.singleDepositLimit !== undefined &&
//       body?.singleDepositLimit !== null &&
//       String(body.singleDepositLimit).trim() !== "";

//     const hasExpireAt =
//       body?.expireAt !== undefined &&
//       body?.expireAt !== null &&
//       String(body.expireAt).trim() !== "";

//     if (!isStatic && hasSingleDepositLimit !== hasExpireAt) {
//       return {
//         statusCode: 400,
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           ok: false,
//           message: "singleDepositLimit and expireAt must be provided together for dynamic account",
//           requestId,
//         }),
//       };
//     }

//     // ✅ normalizers (helps common VAS validation)
//     const firstName = toTitleCase(body.firstName);
//     const lastName = toTitleCase(body.lastName);
//     const middleName =
//       body?.middleName !== undefined && body?.middleName !== null
//         ? toTitleCase(body.middleName)
//         : "";
//     const phone = body?.phone ? normalizeNgPhone(body.phone) : "";
//     const email = body?.email ? String(body.email).trim().toLowerCase() : "";
//     const accountName = String(body?.accountName || "").trim()
//       ? toTitleCase(body.accountName)
//       : `${firstName} ${lastName}`.trim();

//     if (phone && !/^0\d{10}$/.test(phone)) {
//       console.warn("VAS create-virtual-account phone warning:", {
//         requestId,
//         rawPhone: body.phone,
//         normalizedPhone: phone,
//       });
//     }

//     const normalizedBody = {
//       ...body,
//       bvn,
//       firstName,
//       lastName,
//       middleName,
//       accountName,
//       ...(phone ? { phone } : {}),
//       ...(email ? { email } : {}),
//       customerReference: String(body.customerReference).trim(),
//       merchant: {
//         ...(body.merchant || {}),
//         code: String(body.merchant.code).trim(),
//       },
//     };

//     // Remove app-only helper field before upstream call
//     delete normalizedBody.accountType;

//     // ✅ static vs dynamic payload shaping
//     if (isStatic) {
//       delete normalizedBody.singleDepositLimit;
//       delete normalizedBody.expireAt;
//     } else {
//       if (hasSingleDepositLimit) {
//         normalizedBody.singleDepositLimit = String(body.singleDepositLimit).trim();
//       }
//       if (hasExpireAt) {
//         normalizedBody.expireAt = String(body.expireAt).trim();
//       }
//     }

//     // ✅ Request preview log (masked)
//     console.log("VAS create-virtual-account request preview:", {
//       requestId,
//       accountType: isStatic ? "STATIC" : "DYNAMIC",
//       customerReference: normalizedBody.customerReference,
//       merchantCode: normalizedBody.merchant?.code,
//       productType: normalizedBody.productType,
//       hasBvn: true,
//       bvnLen: normalizedBody.bvn?.length,
//       firstName: normalizedBody.firstName,
//       lastName: normalizedBody.lastName,
//       phone: normalizedBody.phone,
//       hasSingleDepositLimit: Object.prototype.hasOwnProperty.call(
//         normalizedBody,
//         "singleDepositLimit"
//       ),
//       hasExpireAt: Object.prototype.hasOwnProperty.call(normalizedBody, "expireAt"),
//       singleDepositLimit: normalizedBody.singleDepositLimit,
//       expireAt: normalizedBody.expireAt,
//     });

//     // ✅ Call VAS
//     const result = await vasClient.openVirtualAccount(normalizedBody);

//     const providerCode = result?.data?.provider_response_code || null;
//     const providerErrorCode = result?.data?.error?.code || null;
//     const providerErrorMessage = result?.data?.error?.message || null;
//     const hasVA = !!result?.data?.provider_response?.virtualAccount?.vNUBAN;

//     console.log("VAS create-virtual-account response:", {
//       requestId,
//       status: result?.status,
//       message: result?.message,
//       provider_code: providerCode,
//       provider_error_code: providerErrorCode,
//       provider_error_message: providerErrorMessage,
//       hasVA,
//     });

//     // ✅ Handle business failures even when vasClient does NOT throw
//     const failedByProvider =
//       String(result?.status || "").toLowerCase() === "failed" ||
//       (providerCode && providerCode !== "00") ||
//       (!hasVA && providerCode !== "00");

//     if (failedByProvider) {
//       return {
//         statusCode: 400,
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           ok: false,
//           requestId,
//           message: "Virtual account creation failed",
//           providerStatus: result?.status ?? null,
//           providerMessage: result?.message ?? null,
//           providerCode,
//           providerErrorCode,
//           providerErrorMessage,
//           providerError: result?.data?.error ?? null,
//           providerErrors: result?.data?.errors ?? null,
//           result, // keep for debugging now; can remove later
//         }),
//       };
//     }

//     return {
//       statusCode: 200,
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ ok: true, requestId, ...result }),
//     };
//   } catch (err) {
//     const upstreamStatus = err?.response?.status || err?.status || null;
//     const upstreamData = err?.response?.data || err?.data || null;

//     console.error("create-virtual-account error:", {
//       requestId,
//       message: err?.message || String(err),
//       name: err?.name,
//       code: err?.code,
//       upstreamStatus,
//       upstreamData,
//       signatureMode: err?.signatureMode || null, // ✅ ADD THIS
//       decrypted: err?.decrypted,
//       decryptedJson: err?.decryptedJson,
//       decryptError: err?.decryptError,
//       stack: err?.stack,
//       debugOn,
//     });

//     const responseBody = {
//       ok: false,
//       requestId,
//       message: "VAS error",
//       upstreamStatus,
//       upstreamData: upstreamData || null,

//       // ✅ always include internal/debug for now
//       internal: {
//         name: err?.name,
//         code: err?.code,
//         message: err?.message || String(err),
//         signatureMode: err?.signatureMode || null, // ✅ ADD THIS
//         stackTop: (err?.stack || "").split("\n").slice(0, 8).join("\n"),
//       },

//       // ✅ THESE are the important fields from vasClient:
//       decrypted: err?.decrypted || null,
//       decryptedJson: err?.decryptedJson || null,
//       decryptError: err?.decryptError || null,

//       // helpful for confirming debug path
//       debugOn,
//     };

//     return {
//       statusCode: upstreamStatus || 500,
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify(responseBody),
//     };
//   }
// };

const vasClient = require("./_lib/vasClient");

function toTitleCase(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeNgPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";

  // 234XXXXXXXXXX -> 0XXXXXXXXXX
  if (/^234\d{10}$/.test(digits)) return `0${digits.slice(3)}`;

  // already local NG format
  if (/^0\d{10}$/.test(digits)) return digits;

  // fallback (leave as digits so we can inspect in logs)
  return digits;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Method Not Allowed" }),
    };
  }

  // useful request id to match browser response with Netlify logs
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // ✅ DEBUG SWITCH
  const debugOn =
    event.queryStringParameters?.debug === "1" ||
    event.headers?.["x-debug"] === "1" ||
    event.headers?.["X-Debug"] === "1";

  try {
    // ✅ Parse body safely
    let body = null;
    try {
      body = event.body ? JSON.parse(event.body) : null;
    } catch (e) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: false, message: "Invalid JSON body", requestId }),
      };
    }

    if (!body || typeof body !== "object") {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: false, message: "Invalid JSON body", requestId }),
      };
    }

    // ✅ minimal validations (doc-aligned)
    const bvn = String(body?.bvn || "").replace(/\D/g, ""); // strip non-digits
    if (!/^\d{11}$/.test(bvn)) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: false, message: "BVN must be 11 digits", requestId }),
      };
    }

    if (!String(body?.firstName || "").trim()) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: false, message: "firstName is required", requestId }),
      };
    }

    if (!String(body?.lastName || "").trim()) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: false, message: "lastName is required", requestId }),
      };
    }

    if (!body?.customerReference) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          { ok: false, message: "customerReference is required", requestId }
        ),
      };
    }

    if (!body?.merchant?.code) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          { ok: false, message: "merchant.code is required", requestId }
        ),
      };
    }

    // ✅ STATIC / DYNAMIC support (same endpoint per official doc)
    const accountType = String(body?.accountType || "DYNAMIC").toUpperCase();
    const isStatic = accountType === "STATIC";

    const hasSingleDepositLimit =
      body?.singleDepositLimit !== undefined &&
      body?.singleDepositLimit !== null &&
      String(body.singleDepositLimit).trim() !== "";

    const hasExpireAt =
      body?.expireAt !== undefined &&
      body?.expireAt !== null &&
      String(body.expireAt).trim() !== "";

    if (!isStatic && hasSingleDepositLimit !== hasExpireAt) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: false,
          message: "singleDepositLimit and expireAt must be provided together for dynamic account",
          requestId,
        }),
      };
    }

    // ✅ normalizers (helps common VAS validation)
    const firstName = toTitleCase(body.firstName);
    const lastName = toTitleCase(body.lastName);
    const middleName =
      body?.middleName !== undefined && body?.middleName !== null
        ? toTitleCase(body.middleName)
        : "";
    const phone = body?.phone ? normalizeNgPhone(body.phone) : "";
    const email = body?.email ? String(body.email).trim().toLowerCase() : "";
    const accountName = String(body?.accountName || "").trim()
      ? toTitleCase(body.accountName)
      : `${firstName} ${lastName}`.trim();

    if (phone && !/^0\d{10}$/.test(phone)) {
      console.warn("VAS create-virtual-account phone warning:", {
        requestId,
        rawPhone: body.phone,
        normalizedPhone: phone,
      });
    }

    const normalizedBody = {
      ...body,
      bvn,
      firstName,
      lastName,
      middleName,
      accountName,
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      customerReference: String(body.customerReference).trim(),
      merchant: {
        ...(body.merchant || {}),
        code: String(body.merchant.code).trim(),
      },
    };

    // Remove app-only helper field before upstream call
    delete normalizedBody.accountType;

    // ✅ static vs dynamic payload shaping
    if (isStatic) {
      delete normalizedBody.singleDepositLimit;
      delete normalizedBody.expireAt;
    } else {
      if (hasSingleDepositLimit) {
        normalizedBody.singleDepositLimit = String(body.singleDepositLimit).trim();
      }
      if (hasExpireAt) {
        normalizedBody.expireAt = String(body.expireAt).trim();
      }
    }

    // ✅ Request preview log (masked-ish)
    console.log("VAS create-virtual-account request preview:", {
      requestId,
      accountType: isStatic ? "STATIC" : "DYNAMIC",
      customerReference: normalizedBody.customerReference,
      merchantCode: normalizedBody.merchant?.code,
      productType: normalizedBody.productType,
      hasBvn: true,
      bvnLen: normalizedBody.bvn?.length,
      firstName: normalizedBody.firstName,
      lastName: normalizedBody.lastName,
      phone: normalizedBody.phone,
      hasSingleDepositLimit: Object.prototype.hasOwnProperty.call(
        normalizedBody,
        "singleDepositLimit"
      ),
      hasExpireAt: Object.prototype.hasOwnProperty.call(normalizedBody, "expireAt"),
      singleDepositLimit: normalizedBody.singleDepositLimit,
      expireAt: normalizedBody.expireAt,
    });

    // ✅ Call VAS
    const result = await vasClient.openVirtualAccount(normalizedBody);

    const providerCode = result?.data?.provider_response_code || null;
    const providerErrorCode = result?.data?.error?.code || null;
    const providerErrorMessage = result?.data?.error?.message || null;
    const hasVA = !!result?.data?.provider_response?.virtualAccount?.vNUBAN;

    console.log("VAS create-virtual-account response:", {
      requestId,
      status: result?.status,
      message: result?.message,
      provider_code: providerCode,
      provider_error_code: providerErrorCode,
      provider_error_message: providerErrorMessage,
      hasVA,
      signatureMode: result?._signatureMode || null,
      requestMeta: result?._requestMeta || null,
    });

    // ✅ Handle business failures even when vasClient does NOT throw
    const failedByProvider =
      String(result?.status || "").toLowerCase() === "failed" ||
      (providerCode && providerCode !== "00") ||
      (!hasVA && providerCode !== "00");

    if (failedByProvider) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: false,
          requestId,
          message: "Virtual account creation failed",
          providerStatus: result?.status ?? null,
          providerMessage: result?.message ?? null,
          providerCode,
          providerErrorCode,
          providerErrorMessage,
          providerError: result?.data?.error ?? null,
          providerErrors: result?.data?.errors ?? null,

          // ✅ passthrough from vasClient (useful for tracing signature mode / request type)
          signatureMode: result?._signatureMode || null,
          requestMeta: result?._requestMeta || null,

          result, // keep for debugging now; can remove later
        }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        requestId,

        // ✅ passthrough from vasClient
        signatureMode: result?._signatureMode || null,
        requestMeta: result?._requestMeta || null,

        ...result,
      }),
    };
  } catch (err) {
    const upstreamStatus = err?.response?.status || err?.status || null;
    const upstreamData = err?.response?.data || err?.data || null;

    console.error("create-virtual-account error:", {
      requestId,
      message: err?.message || String(err),
      name: err?.name,
      code: err?.code,
      upstreamStatus,
      upstreamData,
      signatureMode: err?.signatureMode || null,
      requestMeta: err?.requestMeta || null,   // ✅ ADDED
      payloadShape: err?.payloadShape || null, // ✅ ADDED
      decrypted: err?.decrypted,
      decryptedJson: err?.decryptedJson,
      decryptError: err?.decryptError,
      stack: err?.stack,
      debugOn,
    });

    const responseBody = {
      ok: false,
      requestId,
      message: "VAS error",
      upstreamStatus,
      upstreamData: upstreamData || null,

      // ✅ always include internal/debug for now
      internal: {
        name: err?.name,
        code: err?.code,
        message: err?.message || String(err),
        signatureMode: err?.signatureMode || null,
        requestMeta: err?.requestMeta || null,   // ✅ ADDED
        payloadShape: err?.payloadShape || null, // ✅ ADDED
        stackTop: (err?.stack || "").split("\n").slice(0, 8).join("\n"),
      },

      // ✅ THESE are the important fields from vasClient:
      decrypted: err?.decrypted || null,
      decryptedJson: err?.decryptedJson || null,
      decryptError: err?.decryptError || null,

      // ✅ extra debug passthrough from patched vasClient
      requestMeta: err?.requestMeta || null,
      payloadShape: err?.payloadShape || null,

      // helpful for confirming debug path
      debugOn,
    };

    return {
      statusCode: upstreamStatus || 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(responseBody),
    };
  }
};