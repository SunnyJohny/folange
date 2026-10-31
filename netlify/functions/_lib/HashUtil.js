const crypto = require("crypto");

class HashUtil {
  static hash(input) {
    const hash = crypto.createHash("sha256");
    hash.update(input, "utf8");
    return hash.digest("hex");
  }
}

module.exports = HashUtil;
