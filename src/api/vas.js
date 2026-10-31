// // src/api/vas.js

// export async function createVirtualAccount(payload) {
//   // ✅ CRA-safe: no import.meta
//   // Optional: if you want local dev to hit a specific URL, set REACT_APP_FUNCTIONS_BASE_URL
//   // Example: REACT_APP_FUNCTIONS_BASE_URL=http://localhost:8888
//   const base = process.env.REACT_APP_FUNCTIONS_BASE_URL || "";
//   const url = `${base}/.netlify/functions/create-virtual-account`;

//   const headers = { "Content-Type": "application/json" };

//   // ✅ Optional debug toggle (no hardcoding)
//   // If you call createVirtualAccount({ ...payload, debug: true }) it will enable debug on server
//   if (payload?.debug === true) {
//     headers["X-Debug"] = "1";
//   }

//   const res = await fetch(url, {
//     method: "POST",
//     headers,
//     body: JSON.stringify(payload),
//   });

//   const rawText = await res.text(); // ✅ read raw text first

//   let data = {};
//   try {
//     data = rawText ? JSON.parse(rawText) : {};
//   } catch (e) {
//     data = { message: "Non-JSON response from server", raw: rawText };
//   }

//   if (!res.ok) {
//     const msg =
//       data?.message ||
//       data?.error ||
//       data?.details ||
//       `VAS request failed (HTTP ${res.status})`;

//     // ✅ include payload keys for debugging (not the full BVN)
//     const safePayloadInfo = {
//       hasBvn: !!payload?.bvn,
//       bvnLen: payload?.bvn ? String(payload.bvn).length : 0,
//       customerReference: payload?.customerReference,
//       productType: payload?.productType,
//       merchantCode: payload?.merchant?.code,
//     };

//     throw new Error(`${msg} | ${JSON.stringify(safePayloadInfo)}`);
//   }

//   return data;
// }



// src/api/vas.js

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

  // Convert 234XXXXXXXXXX -> 0XXXXXXXXXX
  if (/^234\d{10}$/.test(digits)) return `0${digits.slice(3)}`;

  // Keep local 11-digit number
  if (/^0\d{10}$/.test(digits)) return digits;

  // Fallback (backend will validate/log further)
  return digits;
}

function buildVasPayload(input = {}) {
  const accountType = String(input?.accountType || "DYNAMIC").toUpperCase();

  const firstName = input?.firstName ? toTitleCase(input.firstName) : "";
  const lastName = input?.lastName ? toTitleCase(input.lastName) : "";
  const middleName =
    input?.middleName !== undefined && input?.middleName !== null
      ? toTitleCase(input.middleName)
      : "";

  const email = input?.email ? String(input.email).trim().toLowerCase() : "";
  const phone = input?.phone ? normalizeNgPhone(input.phone) : "";

  const payload = {
    ...input,
    accountType, // backend uses this to shape STATIC vs DYNAMIC
    bvn: input?.bvn ? String(input.bvn).replace(/\D/g, "") : "",
    firstName,
    lastName,
    middleName,
    accountName: input?.accountName
      ? toTitleCase(input.accountName)
      : `${firstName} ${lastName}`.trim(),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    merchant: {
      ...(input?.merchant || {}),
      code: String(input?.merchant?.code || "").trim(),
    },
  };

  // ✅ STATIC: omit dynamic-only fields per official doc
  if (accountType === "STATIC") {
    delete payload.singleDepositLimit;
    delete payload.expireAt;
  } else {
    // ✅ DYNAMIC: include only if present (backend validates pairing)
    if (
      payload.singleDepositLimit !== undefined &&
      payload.singleDepositLimit !== null &&
      String(payload.singleDepositLimit).trim() !== ""
    ) {
      payload.singleDepositLimit = String(payload.singleDepositLimit).trim();
    } else {
      delete payload.singleDepositLimit;
    }

    if (
      payload.expireAt !== undefined &&
      payload.expireAt !== null &&
      String(payload.expireAt).trim() !== ""
    ) {
      payload.expireAt = String(payload.expireAt).trim();
    } else {
      delete payload.expireAt;
    }
  }

  return payload;
}

export async function createVirtualAccount(payload) {
  // ✅ CRA-safe: no import.meta
  // Optional: if you want local dev to hit a specific URL, set REACT_APP_FUNCTIONS_BASE_URL
  // Example: REACT_APP_FUNCTIONS_BASE_URL=http://localhost:8888
  const base = process.env.REACT_APP_FUNCTIONS_BASE_URL || "";
  const url = `${base}/.netlify/functions/create-virtual-account`;

  const requestPayload = buildVasPayload(payload);

  const headers = { "Content-Type": "application/json" };

  // ✅ Optional debug toggle (no hardcoding)
  if (requestPayload?.debug === true) {
    headers["X-Debug"] = "1";
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(requestPayload),
  });

  const rawText = await res.text(); // ✅ read raw text first

  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (e) {
    data = { message: "Non-JSON response from server", raw: rawText };
  }

  if (!res.ok) {
    const providerCode =
      data?.providerCode ||
      data?.providerErrorCode ||
      data?.result?.data?.provider_response_code ||
      data?.upstreamData?.data?.provider_response_code ||
      data?.upstreamData?.provider_response_code ||
      data?.upstreamData?.data?.error?.code ||
      data?.upstreamData?.error?.code ||
      null;

    const providerMessage =
      data?.providerMessage ||
      data?.providerErrorMessage ||
      data?.result?.data?.error?.message ||
      data?.upstreamData?.data?.error?.message ||
      data?.upstreamData?.error?.message ||
      null;

    const msg =
      data?.message ||
      data?.error ||
      data?.details ||
      `VAS request failed (HTTP ${res.status})`;

    // ✅ include payload keys for debugging (not the full BVN)
    const safePayloadInfo = {
      accountType: requestPayload?.accountType,
      hasBvn: !!requestPayload?.bvn,
      bvnLen: requestPayload?.bvn ? String(requestPayload.bvn).length : 0,
      customerReference: requestPayload?.customerReference,
      productType: requestPayload?.productType,
      merchantCode: requestPayload?.merchant?.code,
      hasSingleDepositLimit: Object.prototype.hasOwnProperty.call(
        requestPayload,
        "singleDepositLimit"
      ),
      hasExpireAt: Object.prototype.hasOwnProperty.call(requestPayload, "expireAt"),
      requestId: data?.requestId || null,
      providerCode,
      providerMessage,
    };

    const providerSuffix = providerCode
      ? ` [Provider code: ${providerCode}${providerMessage ? `, message: ${providerMessage}` : ""}]`
      : "";

    throw new Error(`${msg}${providerSuffix} | ${JSON.stringify(safePayloadInfo)}`);
  }

  return data;
}