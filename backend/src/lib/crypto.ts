/**
 * AES-256-GCM Secret Vault & API Key Cryptography — Module 15.1
 *
 * - `encryptSecret` / `decryptSecret`: Authenticated AES-256-GCM encryption
 *   backed by `ENCRYPTION_KEY` (64-char hex / 32-byte key from Secret Manager).
 *   Ciphertext format: `v1:<iv_base64url>:<authTag_base64url>:<ciphertext_base64url>`
 * - `generateApiKey` / `hashApiKey`: Cryptographically random `dws_live_...`
 *   Bearer tokens hashed with SHA-256 for storage.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const AES_ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_PREFIX = 'dws_live_';

function resolveEncryptionKey(): Buffer {
  const raw = process.env['ENCRYPTION_KEY']?.trim();
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not configured. Mount a 64-character hex secret from Secret Manager.',
    );
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  // Fallback for 32-byte base64 encoded keys
  const b64 = Buffer.from(raw, 'base64');
  if (b64.length === 32) {
    return b64;
  }

  throw new Error(
    'ENCRYPTION_KEY must be a 64-character hex string (32 bytes) or 32-byte base64 string.',
  );
}

/**
 * Returns true if `ENCRYPTION_KEY` is present and valid (32 bytes).
 * Never exposes the key material.
 */
export function isEncryptionKeyConfigured(): boolean {
  try {
    resolveEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns safe, non-secret diagnostic status for `ENCRYPTION_KEY` so admins
 * can immediately tell whether the secret is missing vs. wrong length/format.
 */
export function getEncryptionKeyDiagnostics(): {
  configured: boolean;
  reason: string;
} {
  const raw = process.env['ENCRYPTION_KEY']?.trim();
  if (!raw) {
    return {
      configured: false,
      reason: 'Not mounted or empty in Cloud Run environment.',
    };
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return {
      configured: true,
      reason: 'Valid 64-character hex key (32 bytes).',
    };
  }
  const b64 = Buffer.from(raw, 'base64');
  if (b64.length === 32) {
    return {
      configured: true,
      reason: 'Valid 32-byte base64 key.',
    };
  }
  return {
    configured: false,
    reason: `Invalid format (received ${raw.length} chars). Must be a 64-char hex string (generate with: openssl rand -hex 32) or 32-byte base64.`,
  };
}

/**
 * Encrypts a UTF-8 plaintext secret using AES-256-GCM with a random 96-bit IV.
 */
export function encryptSecret(plaintext: string): string {
  const key = resolveEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AES_ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

/**
 * Decrypts a `v1:<iv>:<tag>:<data>` AES-256-GCM payload back into UTF-8 plaintext.
 */
export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted secret payload format.');
  }
  const key = resolveEncryptionKey();
  const iv = Buffer.from(parts[1]!, 'base64url');
  const authTag = Buffer.from(parts[2]!, 'base64url');
  const ciphertext = Buffer.from(parts[3]!, 'base64url');

  const decipher = createDecipheriv(AES_ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * Computes the deterministic SHA-256 hex digest of a raw Bearer API key.
 */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

/**
 * Generates a new cryptographically random tenant API key (`dws_live_...`),
 * its non-secret display prefix, and its SHA-256 storage hash.
 */
export function generateApiKey(): {
  plaintextKey: string;
  keyPrefix: string;
  keyHash: string;
} {
  const token = randomBytes(24).toString('hex'); // 48 hex chars = 192 bits of entropy
  const plaintextKey = `${KEY_PREFIX}${token}`;
  const keyPrefix = `${KEY_PREFIX}${token.slice(0, 8)}`;
  const keyHash = hashApiKey(plaintextKey);
  return { plaintextKey, keyPrefix, keyHash };
}
