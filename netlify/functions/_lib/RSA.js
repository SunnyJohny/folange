const crypto = require("crypto");

class RSA {
  // For raw RSA operations (sign-like via privateEncrypt): PKCS#1 v1.5
  static PKCS1_PADDING = crypto.constants.RSA_PKCS1_PADDING;

  static isPem(keyValue) {
    return (
      typeof keyValue === "string" &&
      keyValue.includes("BEGIN") &&
      keyValue.includes("KEY")
    );
  }

  static chunk64(str) {
    return (str || "").match(/.{1,64}/g) || [];
  }

  static b64DerToPemPublicKey(b64) {
    const lines = RSA.chunk64(b64);
    return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
  }

  static b64DerToPemPrivateKey(b64) {
    const lines = RSA.chunk64(b64);
    return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
  }

  static normalizeKey(keyValue, kind = "public") {
    if (!keyValue) throw new Error("Missing RSA key");

    if (RSA.isPem(keyValue)) return keyValue;

    // if base64 that decodes to PEM text
    try {
      const decoded = Buffer.from(keyValue, "base64").toString("utf8");
      if (RSA.isPem(decoded)) return decoded;
    } catch (_) {}

    // assume base64 DER
    if (kind === "private") return RSA.b64DerToPemPrivateKey(keyValue);
    return RSA.b64DerToPemPublicKey(keyValue);
  }

  /**
   * SecureToken encryption: RSA PKCS#1 v1.5 (most UBA VAS implementations)
   */
  static encryptWithPublicKey(plainTextOrBuffer, publicKeyValue) {
    const publicKeyPem = RSA.normalizeKey(publicKeyValue, "public");

    const dataBuffer = Buffer.isBuffer(plainTextOrBuffer)
      ? plainTextOrBuffer
      : Buffer.from(String(plainTextOrBuffer), "utf8");

    const encrypted = crypto.publicEncrypt(
      { key: publicKeyPem, padding: RSA.PKCS1_PADDING },
      dataBuffer
    );

    return encrypted.toString("base64");
  }

  /**
   * MODE_A: Sign the *payload JSON string* using RSA-SHA256
   * (Node hashes internally with SHA256)
   */
  static signPayloadString(jsonPayloadString, privateKeyValue) {
    const privateKeyPem = RSA.normalizeKey(privateKeyValue, "private");

    const sign = crypto.createSign("RSA-SHA256");
    sign.update(String(jsonPayloadString), "utf8");
    sign.end();

    return sign.sign({ key: privateKeyPem, padding: RSA.PKCS1_PADDING }).toString("base64");
  }

  /**
   * MODE_B: Sign sha256(payloadJson) BUT as a UTF8 string (not bytes)
   * Some gateways weirdly do this.
   */
  static signHashHexAsString(hashHex, privateKeyValue) {
    const privateKeyPem = RSA.normalizeKey(privateKeyValue, "private");

    const sign = crypto.createSign("RSA-SHA256");
    sign.update(String(hashHex), "utf8");
    sign.end();

    return sign.sign({ key: privateKeyPem, padding: RSA.PKCS1_PADDING }).toString("base64");
  }

  /**
   * MODE_C: "raw RSA" on hash bytes (PKCS#1 v1.5)
   * signature = RSA_private_encrypt(sha256(payloadJsonBytes))
   *
   * This matches many docs that say: rsa_signed(sha256hash(payload))
   * where rsa_signed means the raw RSA primitive over the hash.
   */
  static signHashHexRaw(hashHex, privateKeyValue) {
    const privateKeyPem = RSA.normalizeKey(privateKeyValue, "private");
    const hashBuf = Buffer.from(String(hashHex), "hex");

    const sigBuf = crypto.privateEncrypt(
      { key: privateKeyPem, padding: RSA.PKCS1_PADDING },
      hashBuf
    );

    return sigBuf.toString("base64");
  }

  /**
   * Webhook decrypt:
   * Try PKCS#1 v1.5 first, then OAEP (sha1, sha256).
   */
  static decryptToBufferWithPrivateKey(encodedTextBase64, privateKeyValue) {
    const privateKeyPem = RSA.normalizeKey(privateKeyValue, "private");
    const cipherBuf = Buffer.from(encodedTextBase64, "base64");

    try {
      return crypto.privateDecrypt(
        { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
        cipherBuf
      );
    } catch (_) {}

    try {
      return crypto.privateDecrypt(
        {
          key: privateKeyPem,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha1",
        },
        cipherBuf
      );
    } catch (_) {}

    return crypto.privateDecrypt(
      {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      cipherBuf
    );
  }
}

module.exports = RSA;
