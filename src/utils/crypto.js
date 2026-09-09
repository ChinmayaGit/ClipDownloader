const crypto = require('crypto');

const DEFAULT_KEY_B64 = 'QC6Ir2trghxRAyyyWZEOEFR4GgLhnfQ4A19I3QBlQkc=';

/**
 * Decrypts an HDrama AES-256-GCM encrypted token.
 * @param {string} encB64 Base64-encoded encrypted token
 * @param {string} keyB64 Optional base64-encoded key
 * @returns {string|null} Decrypted plaintext URL or null on failure
 */
function decryptHdramaToken(encB64, keyB64 = DEFAULT_KEY_B64) {
  if (!encB64 || typeof encB64 !== 'string') return null;

  try {
    const key = Buffer.from(keyB64, 'base64');
    const encBuffer = Buffer.from(encB64, 'base64');

    if (encBuffer.length < 28) {
      // 12 (IV) + 16 (Tag) = 28 bytes minimum
      return null;
    }

    const iv = encBuffer.subarray(0, 12);
    const tag = encBuffer.subarray(encBuffer.length - 16);
    const ciphertext = encBuffer.subarray(12, encBuffer.length - 16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ciphertext, null, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.error('Failed to decrypt HDrama token:', err.message);
    return null;
  }
}

module.exports = {
  decryptHdramaToken,
  DEFAULT_KEY_B64
};

