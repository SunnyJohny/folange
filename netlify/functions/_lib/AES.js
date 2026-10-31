const crypto = require("crypto");

class AES {
  static AES_ALGORITHM = "aes-256-cbc";

  static encrypt(plainText, keyHex) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      this.AES_ALGORITHM,
      Buffer.from(keyHex, "hex"),
      iv
    );

    const encrypted = Buffer.concat([
      cipher.update(plainText, "utf8"),
      cipher.final(),
    ]);

    // base64( IV + ciphertext )
    return Buffer.concat([iv, encrypted]).toString("base64");
  }

  static decrypt(encryptedBase64, keyHex) {
    const ivPlusCipher = Buffer.from(encryptedBase64, "base64");
    const iv = ivPlusCipher.slice(0, 16);
    const ciphertext = ivPlusCipher.slice(16);

    const decipher = crypto.createDecipheriv(
      this.AES_ALGORITHM,
      Buffer.from(keyHex, "hex"),
      iv
    );

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  }
}

module.exports = AES;