// api/_utils/encryption.js
//
// AES-256-GCM symmetric encryption for TikTok (and other OAuth) tokens.
//
// Required environment variable:
//   ENCRYPTION_KEY  — 32-byte key encoded as 64 lowercase hex chars
//                     Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Wire format (base64):  [ IV (12 bytes) | GCM auth tag (16 bytes) | ciphertext ]
//
// Rules:
//   - Never call decrypt() in frontend code (env var is server-only).
//   - If ENCRYPTION_KEY changes, existing ciphertexts cannot be decrypted.
//     Rotate by re-authorizing all connected accounts.

const crypto = require('crypto');

const ALGORITHM  = 'aes-256-gcm';
const IV_BYTES   = 12; // 96-bit IV — recommended for GCM
const TAG_BYTES  = 16; // 128-bit authentication tag

function loadKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not set. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  const buf = Buffer.from(raw.trim(), 'hex');
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars). Got ${buf.length} bytes.`
    );
  }
  return buf;
}

/**
 * Encrypt a plaintext string.
 * @param  {string|null} plaintext
 * @returns {string|null}  base64 ciphertext, or null if input is null/empty.
 */
function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;

  const key = loadKey();
  const iv  = crypto.randomBytes(IV_BYTES);

  const cipher    = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag       = cipher.getAuthTag();

  // Layout: [ IV | tag | ciphertext ]
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypt a ciphertext produced by encrypt().
 * @param  {string|null} ciphertext  base64 string
 * @returns {string|null}  plaintext, or null if input is null/empty.
 * @throws if the ciphertext has been tampered with (GCM auth tag mismatch).
 */
function decrypt(ciphertext) {
  if (ciphertext == null || ciphertext === '') return null;

  const key = loadKey();
  const buf = Buffer.from(ciphertext, 'base64');

  const iv        = buf.slice(0, IV_BYTES);
  const tag       = buf.slice(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = buf.slice(IV_BYTES + TAG_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}

module.exports = { encrypt, decrypt };
