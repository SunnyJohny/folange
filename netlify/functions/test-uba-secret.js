import { getUbaMerchantPrivateKey } from "./_secrets.js";

export async function handler() {
  try {
    const key = await getUbaMerchantPrivateKey();
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, keyLen: key.length }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: e.message }),
    };
  }
}
