// const axios = require("axios");
// const crypto = require("crypto");
// const AES = require("./AES");
// const RSA = require("./RSA");
// const HashUtil = require("./HashUtil");

// // ✅ Load merchant private key from Firestore
// const { getUbaMerchantPrivateKey } = require("../_secrets.cjs");

// // ✅ Base URL
// const BASE_URL = process.env.VAS_BASE_URL || "https://ubavirtualaccounts.ubagroup.com";

// // If secret getter ever returns raw base64 DER "MII...", convert to PEM
// function b64DerToPem(b64) {
//   const lines = (b64 || "").match(/.{1,64}/g) || [];
//   return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
// }

// function isSigVerificationFailure(status, data) {
//   const msg =
//     String(data?.message || data?.statusMessage || data?.error || "")
//       .toLowerCase()
//       .trim();

//   return status === 403 && msg.includes("signature verification failed");
// }

// // ================================
// // INTERNAL: common encrypted request helper
// // ================================
// async function requestEncrypted(method, path, payload) {
//   const MERCHANT_PUBLIC_KEY =
//     process.env.MERCHANT_PUBLIC_KEY_BASE64 || process.env.MERCHANT_PUBLIC_KEY;

//   const VAS_PUBLIC_KEY =
//     process.env.VAS_PUBLIC_KEY_BASE64 || process.env.VAS_PUBLIC_KEY;

//   let MERCHANT_PRIVATE_KEY = await getUbaMerchantPrivateKey();

//   if (typeof MERCHANT_PRIVATE_KEY === "string" && MERCHANT_PRIVATE_KEY.startsWith("MII")) {
//     MERCHANT_PRIVATE_KEY = b64DerToPem(MERCHANT_PRIVATE_KEY);
//   }

//   if (!MERCHANT_PUBLIC_KEY) {
//     throw new Error("Missing MERCHANT_PUBLIC_KEY (or MERCHANT_PUBLIC_KEY_BASE64) in Netlify env");
//   }
//   if (!VAS_PUBLIC_KEY) {
//     throw new Error("Missing VAS_PUBLIC_KEY (or VAS_PUBLIC_KEY_BASE64) in Netlify env");
//   }
//   if (!MERCHANT_PRIVATE_KEY || MERCHANT_PRIVATE_KEY.length < 200) {
//     throw new Error("Missing/invalid merchant private key from Firestore secrets/uba");
//   }

//   // ✅ Build EXACT JSON string ONCE (the same string we encrypt AND sign for some modes)
//   const plainPayloadObj = payload && typeof payload === "object" ? payload : {};
//   const jsonPayloadString = JSON.stringify(plainPayloadObj);

//   // ✅ AES key (hex string expected by AES helper)
//   const aesKeyHex = crypto.randomBytes(32).toString("hex");

//   // ✅ Encrypt payload
//   const encryptedData = AES.encrypt(jsonPayloadString, aesKeyHex);

//   // ✅ Authorization: Bearer sha256hash(merchantPublicKey)
//   const authorization = `Bearer ${HashUtil.hash(MERCHANT_PUBLIC_KEY)}`;

//   // ✅ SecureToken: encrypt AES key hex string with VAS public key
//   const secureToken = RSA.encryptWithPublicKey(aesKeyHex, VAS_PUBLIC_KEY);

//   // ✅ Common hash used by modes B/C
//   const payloadHashHex = HashUtil.hash(jsonPayloadString);

//   // ✅ Try signature modes (do NOT change json/encryptedData/aesKey between tries)
//   const signatureAttempts = [
//     {
//       mode: "MODE_A_SIGN_JSON_RSA_SHA256",
//       make: () => RSA.signPayloadString(jsonPayloadString, MERCHANT_PRIVATE_KEY),
//     },
//     {
//       mode: "MODE_B_SIGN_HASHHEX_AS_STRING_RSA_SHA256",
//       make: () => RSA.signHashHexAsString(payloadHashHex, MERCHANT_PRIVATE_KEY),
//     },
//     {
//       mode: "MODE_C_RAW_RSA_ON_SHA256_BYTES",
//       make: () => RSA.signHashHexRaw(payloadHashHex, MERCHANT_PRIVATE_KEY),
//     },
//   ];

//   let lastErr = null;

//   for (const attempt of signatureAttempts) {
//     const signature = attempt.make();

//     const r = await axios({
//       method,
//       url: `${BASE_URL}${path}`,
//       data: { data: encryptedData },
//       headers: {
//         Authorization: authorization,
//         Signature: signature,
//         SecureToken: secureToken,
//         "Content-Type": "application/json",
//       },
//       timeout: 30000,
//       validateStatus: () => true,
//     });

//     // If it’s a signature-verification fail, try next mode
//     if (isSigVerificationFailure(r.status, r.data)) {
//       lastErr = new Error(r?.data?.message || "Signature verification failed");
//       lastErr.status = r.status;
//       lastErr.data = r.data;
//       lastErr.signatureMode = attempt.mode;
//       continue;
//     }

//     // If response body is encrypted (usual case)
//     const encryptedResponseData = r?.data?.data;

//     if (typeof encryptedResponseData === "string" && encryptedResponseData.length) {
//       try {
//         const decryptedJsonString = AES.decrypt(encryptedResponseData, aesKeyHex);
//         const parsed = JSON.parse(decryptedJsonString);

//         if (r.status >= 200 && r.status < 300) {
//           // Attach which mode worked
//           parsed._signatureMode = attempt.mode;
//           return parsed;
//         }

//         // Non-2xx -> throw with decrypted details
//         const e = new Error(parsed?.message || "VAS error");
//         e.status = r.status;
//         e.data = r.data;
//         e.decrypted = decryptedJsonString;
//         e.decryptedJson = parsed;
//         e.signatureMode = attempt.mode;
//         throw e;
//       } catch (decryptOrParseErr) {
//         const e = new Error(
//           `VAS response decrypt/parse failed: ${decryptOrParseErr?.message || decryptOrParseErr}`
//         );
//         e.status = r.status;
//         e.data = r.data;
//         e.decryptError = decryptOrParseErr?.message || String(decryptOrParseErr);
//         e.signatureMode = attempt.mode;
//         throw e;
//       }
//     }

//     // If VAS ever returns plain JSON unexpectedly
//     if (r.status >= 200 && r.status < 300) {
//       const out = r.data;
//       if (out && typeof out === "object") out._signatureMode = attempt.mode;
//       return out;
//     }

//     // Non-2xx plain
//     const e = new Error(r?.data?.message || "VAS error");
//     e.status = r.status;
//     e.data = r.data;
//     e.signatureMode = attempt.mode;
//     throw e;
//   }

//   // If all signature modes failed with verification error
//   if (lastErr) throw lastErr;

//   const e = new Error("Signature verification failed (all modes)");
//   e.status = 403;
//   e.data = { status: "Failed", message: "Signature verification failed (all modes)" };
//   e.signatureMode = "ALL_MODES_FAILED";
//   throw e;
// }

// // ================================
// // 1.0 Open Virtual Account
// // ================================
// async function openVirtualAccount(payload) {
//   return requestEncrypted("POST", "/api/v1/virtual/accounts", payload);
// }

// // ================================
// // 3.0 Query Virtual Account Inflow
// // ================================
// async function queryVirtualAccountInflow(payload) {
//   const vNUBAN = String(payload?.vNUBAN || "").replace(/\D/g, "");
//   const startDate = String(payload?.startDate || "").trim();
//   const endDate = String(payload?.endDate || "").trim();

//   if (!vNUBAN) throw new Error("queryVirtualAccountInflow: vNUBAN is required");

//   const dateRe = /^\d{4}-\d{2}-\d{2}$/;
//   if (!dateRe.test(startDate) || !dateRe.test(endDate)) {
//     throw new Error("queryVirtualAccountInflow: startDate and endDate must be yyyy-MM-dd");
//   }

//   return requestEncrypted("POST", "/api/v1/virtual/notifications/query", {
//     vNUBAN,
//     startDate,
//     endDate,
//   });
// }

// module.exports = { openVirtualAccount, queryVirtualAccountInflow };



const axios = require("axios");
const crypto = require("crypto");
const AES = require("./AES");
const RSA = require("./RSA");
const HashUtil = require("./HashUtil");

// ✅ Load merchant private key from Firestore
const { getUbaMerchantPrivateKey } = require("../_secrets.cjs");

// ✅ Base URL
const BASE_URL = process.env.VAS_BASE_URL || "https://ubavirtualaccounts.ubagroup.com";

// If secret getter ever returns raw base64 DER "MII...", convert to PEM
function b64DerToPem(b64) {
  const lines = (b64 || "").match(/.{1,64}/g) || [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

function isSigVerificationFailure(status, data) {
  const msg = String(data?.message || data?.statusMessage || data?.error || "")
    .toLowerCase()
    .trim();

  return status === 403 && msg.includes("signature verification failed");
}

// ✅ Remove undefined recursively (but keep null if caller intentionally sends it)
// This prevents accidental undefined fields affecting JSON/signature consistency.
function deepRemoveUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(deepRemoveUndefined);
  }

  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = deepRemoveUndefined(v);
    }
    return out;
  }

  return value;
}

// ✅ Helpers used to infer STATIC vs DYNAMIC request (for logs only)
function isProbablyStaticVARequest(payload) {
  if (!payload || typeof payload !== "object") return false;
  const hasLimit = Object.prototype.hasOwnProperty.call(payload, "singleDepositLimit");
  const hasExpireAt = Object.prototype.hasOwnProperty.call(payload, "expireAt");
  return !hasLimit && !hasExpireAt;
}

function maskSensitiveForLog(payload) {
  const p = payload && typeof payload === "object" ? { ...payload } : {};
  if (p.bvn) {
    const s = String(p.bvn).replace(/\D/g, "");
    p.bvn = s ? `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}` : p.bvn;
  }
  if (p.phone) {
    const s = String(p.phone).replace(/\D/g, "");
    p.phone = s ? `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}` : p.phone;
  }
  return p;
}

// ================================
// INTERNAL: common encrypted request helper
// ================================
async function requestEncrypted(method, path, payload) {
  const MERCHANT_PUBLIC_KEY =
    process.env.MERCHANT_PUBLIC_KEY_BASE64 || process.env.MERCHANT_PUBLIC_KEY;

  const VAS_PUBLIC_KEY = process.env.VAS_PUBLIC_KEY_BASE64 || process.env.VAS_PUBLIC_KEY;

  let MERCHANT_PRIVATE_KEY = await getUbaMerchantPrivateKey();

  if (typeof MERCHANT_PRIVATE_KEY === "string" && MERCHANT_PRIVATE_KEY.startsWith("MII")) {
    MERCHANT_PRIVATE_KEY = b64DerToPem(MERCHANT_PRIVATE_KEY);
  }

  if (!MERCHANT_PUBLIC_KEY) {
    throw new Error("Missing MERCHANT_PUBLIC_KEY (or MERCHANT_PUBLIC_KEY_BASE64) in Netlify env");
  }
  if (!VAS_PUBLIC_KEY) {
    throw new Error("Missing VAS_PUBLIC_KEY (or VAS_PUBLIC_KEY_BASE64) in Netlify env");
  }
  if (!MERCHANT_PRIVATE_KEY || MERCHANT_PRIVATE_KEY.length < 200) {
    throw new Error("Missing/invalid merchant private key from Firestore secrets/uba");
  }

  // ✅ Build EXACT JSON string ONCE (same string is signed + encrypted)
  // Also strip undefined keys for deterministic payload.
  const plainPayloadObj =
    payload && typeof payload === "object" ? deepRemoveUndefined(payload) : {};
  const jsonPayloadString = JSON.stringify(plainPayloadObj);

  // ✅ AES key (hex string expected by AES helper)
  const aesKeyHex = crypto.randomBytes(32).toString("hex");

  // ✅ Encrypt payload
  const encryptedData = AES.encrypt(jsonPayloadString, aesKeyHex);

  // ✅ Authorization: Bearer sha256hash(merchantPublicKey)
  const authorization = `Bearer ${HashUtil.hash(MERCHANT_PUBLIC_KEY)}`;

  // ✅ SecureToken: encrypt AES key hex string with VAS public key
  const secureToken = RSA.encryptWithPublicKey(aesKeyHex, VAS_PUBLIC_KEY);

  // ✅ Common hash used by modes B/C
  const payloadHashHex = HashUtil.hash(jsonPayloadString);

  // ✅ Try signature modes (do NOT change json/encryptedData/aesKey between tries)
  const signatureAttempts = [
    {
      mode: "MODE_A_SIGN_JSON_RSA_SHA256",
      make: () => RSA.signPayloadString(jsonPayloadString, MERCHANT_PRIVATE_KEY),
    },
    {
      mode: "MODE_B_SIGN_HASHHEX_AS_STRING_RSA_SHA256",
      make: () => RSA.signHashHexAsString(payloadHashHex, MERCHANT_PRIVATE_KEY),
    },
    {
      mode: "MODE_C_RAW_RSA_ON_SHA256_BYTES",
      make: () => RSA.signHashHexRaw(payloadHashHex, MERCHANT_PRIVATE_KEY),
    },
  ];

  let lastErr = null;

  for (const attempt of signatureAttempts) {
    const signature = attempt.make();

    const r = await axios({
      method,
      url: `${BASE_URL}${path}`,
      data: { data: encryptedData },
      headers: {
        Authorization: authorization,
        Signature: signature,
        SecureToken: secureToken,
        "Content-Type": "application/json",
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    // If it’s a signature-verification fail, try next mode
    if (isSigVerificationFailure(r.status, r.data)) {
      lastErr = new Error(r?.data?.message || "Signature verification failed");
      lastErr.status = r.status;
      lastErr.data = r.data;
      lastErr.signatureMode = attempt.mode;
      lastErr.requestMeta = {
        path,
        method,
        vaRequestType:
          path === "/api/v1/virtual/accounts"
            ? isProbablyStaticVARequest(plainPayloadObj)
              ? "STATIC_OR_NO_LIMIT"
              : "DYNAMIC_OR_LIMITED"
            : undefined,
      };
      continue;
    }

    // If response body is encrypted (usual case)
    const encryptedResponseData = r?.data?.data;

    if (typeof encryptedResponseData === "string" && encryptedResponseData.length) {
      try {
        const decryptedJsonString = AES.decrypt(encryptedResponseData, aesKeyHex);
        const parsed = JSON.parse(decryptedJsonString);

        if (r.status >= 200 && r.status < 300) {
          // Attach which mode worked + debug meta (safe)
          parsed._signatureMode = attempt.mode;
          parsed._requestMeta = {
            path,
            method,
            vaRequestType:
              path === "/api/v1/virtual/accounts"
                ? isProbablyStaticVARequest(plainPayloadObj)
                  ? "STATIC_OR_NO_LIMIT"
                  : "DYNAMIC_OR_LIMITED"
                : undefined,
          };
          return parsed;
        }

        // Non-2xx -> throw with decrypted details
        const e = new Error(parsed?.message || "VAS error");
        e.status = r.status;
        e.data = r.data;
        e.decrypted = decryptedJsonString;
        e.decryptedJson = parsed;
        e.signatureMode = attempt.mode;
        e.requestMeta = {
          path,
          method,
          vaRequestType:
            path === "/api/v1/virtual/accounts"
              ? isProbablyStaticVARequest(plainPayloadObj)
                ? "STATIC_OR_NO_LIMIT"
                : "DYNAMIC_OR_LIMITED"
              : undefined,
          payloadShape: {
            keys: Object.keys(plainPayloadObj || {}),
            hasSingleDepositLimit: Object.prototype.hasOwnProperty.call(
              plainPayloadObj,
              "singleDepositLimit"
            ),
            hasExpireAt: Object.prototype.hasOwnProperty.call(plainPayloadObj, "expireAt"),
          },
        };
        throw e;
      } catch (decryptOrParseErr) {
        // If the thrown error is the one we intentionally created above, preserve it
        if (decryptOrParseErr && decryptOrParseErr.signatureMode) {
          throw decryptOrParseErr;
        }

        const e = new Error(
          `VAS response decrypt/parse failed: ${decryptOrParseErr?.message || decryptOrParseErr}`
        );
        e.status = r.status;
        e.data = r.data;
        e.decryptError = decryptOrParseErr?.message || String(decryptOrParseErr);
        e.signatureMode = attempt.mode;
        e.requestMeta = {
          path,
          method,
          vaRequestType:
            path === "/api/v1/virtual/accounts"
              ? isProbablyStaticVARequest(plainPayloadObj)
                ? "STATIC_OR_NO_LIMIT"
                : "DYNAMIC_OR_LIMITED"
              : undefined,
        };
        throw e;
      }
    }

    // If VAS ever returns plain JSON unexpectedly
    if (r.status >= 200 && r.status < 300) {
      const out = r.data;
      if (out && typeof out === "object") {
        out._signatureMode = attempt.mode;
        out._requestMeta = {
          path,
          method,
          vaRequestType:
            path === "/api/v1/virtual/accounts"
              ? isProbablyStaticVARequest(plainPayloadObj)
                ? "STATIC_OR_NO_LIMIT"
                : "DYNAMIC_OR_LIMITED"
              : undefined,
        };
      }
      return out;
    }

    // Non-2xx plain
    const e = new Error(r?.data?.message || "VAS error");
    e.status = r.status;
    e.data = r.data;
    e.signatureMode = attempt.mode;
    e.requestMeta = {
      path,
      method,
      vaRequestType:
        path === "/api/v1/virtual/accounts"
          ? isProbablyStaticVARequest(plainPayloadObj)
            ? "STATIC_OR_NO_LIMIT"
            : "DYNAMIC_OR_LIMITED"
          : undefined,
      payloadShape: {
        keys: Object.keys(plainPayloadObj || {}),
        hasSingleDepositLimit: Object.prototype.hasOwnProperty.call(
          plainPayloadObj,
          "singleDepositLimit"
        ),
        hasExpireAt: Object.prototype.hasOwnProperty.call(plainPayloadObj, "expireAt"),
      },
    };
    throw e;
  }

  // If all signature modes failed with verification error
  if (lastErr) {
    lastErr.payloadShape = {
      keys: Object.keys((payload && typeof payload === "object" ? payload : {}) || {}),
      safePreview: maskSensitiveForLog(payload),
      hasSingleDepositLimit: Object.prototype.hasOwnProperty.call(
        payload && typeof payload === "object" ? payload : {},
        "singleDepositLimit"
      ),
      hasExpireAt: Object.prototype.hasOwnProperty.call(
        payload && typeof payload === "object" ? payload : {},
        "expireAt"
      ),
    };
    throw lastErr;
  }

  const e = new Error("Signature verification failed (all modes)");
  e.status = 403;
  e.data = { status: "Failed", message: "Signature verification failed (all modes)" };
  e.signatureMode = "ALL_MODES_FAILED";
  e.payloadShape = {
    keys: Object.keys((payload && typeof payload === "object" ? payload : {}) || {}),
    safePreview: maskSensitiveForLog(payload),
    hasSingleDepositLimit: Object.prototype.hasOwnProperty.call(
      payload && typeof payload === "object" ? payload : {},
      "singleDepositLimit"
    ),
    hasExpireAt: Object.prototype.hasOwnProperty.call(
      payload && typeof payload === "object" ? payload : {},
      "expireAt"
    ),
  };
  throw e;
}

// ================================
// 1.0 Open Virtual Account
// ================================
async function openVirtualAccount(payload) {
  // ✅ Accept both:
  // - STATIC payload: no singleDepositLimit / no expireAt
  // - DYNAMIC payload: includes singleDepositLimit + expireAt
  return requestEncrypted("POST", "/api/v1/virtual/accounts", payload);
}

// ================================
// 3.0 Query Virtual Account Inflow
// ================================
async function queryVirtualAccountInflow(payload) {
  const vNUBAN = String(payload?.vNUBAN || "").replace(/\D/g, "");
  const startDate = String(payload?.startDate || "").trim();
  const endDate = String(payload?.endDate || "").trim();

  if (!vNUBAN) throw new Error("queryVirtualAccountInflow: vNUBAN is required");

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(startDate) || !dateRe.test(endDate)) {
    throw new Error("queryVirtualAccountInflow: startDate and endDate must be yyyy-MM-dd");
  }

  return requestEncrypted("POST", "/api/v1/virtual/notifications/query", {
    vNUBAN,
    startDate,
    endDate,
  });
}

module.exports = { openVirtualAccount, queryVirtualAccountInflow };