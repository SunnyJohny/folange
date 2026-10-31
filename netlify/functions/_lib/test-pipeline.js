const AES = require('./AES');
const RSA = require('./RSA');

(async () => {
  const payload = { hello: 'world' };
  const aesKey = AES.generateKey();
  const encryptedData = AES.encrypt(JSON.stringify(payload), aesKey);
  console.log('encryptedData.len', encryptedData.length);

  const vasPub = process.env.VAS_PUBLIC_KEY; // set this to your VAS public key (PEM or base64 DER)
  const secureToken = RSA.encryptWithPublicKey(aesKey, vasPub, {
    oaepHash: process.env.VAS_RSA_OAEP_SHA256 === '1' ? 'sha256' : undefined,
  });
  console.log('secureToken.len', secureToken.length);

  const merchantPriv = process.env.MERCHANT_PRIVATE_KEY; // set to your merchant private key (PEM or base64 DER)
  const signature = RSA.signWithPrivateKey(JSON.stringify(payload), merchantPriv);
  console.log('signature.len', signature.length);

  // AES roundtrip verify
  const clear = AES.decrypt(encryptedData, aesKey);
  console.log('roundtrip ok?', clear === JSON.stringify(payload));
})();