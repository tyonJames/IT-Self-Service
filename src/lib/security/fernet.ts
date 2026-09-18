import crypto from "node:crypto";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";

/**
 * Fernet (symmetric authenticated encryption), byte-compatible with Python's
 * `cryptography.fernet`.
 *
 * Implemented rather than pulled from npm for two reasons: the format is
 * small and fully specified, and compatibility matters — employee mailbox
 * passwords encrypted by the Django system must decrypt here unchanged, and
 * vice versa, so that the two systems can run side by side during cutover.
 *
 * Token layout (spec: https://github.com/fernet/spec):
 *   0x80 | timestamp (8B BE) | IV (16B) | AES-128-CBC ciphertext | HMAC-SHA256 (32B)
 * Key: 32 bytes, url-safe base64 — first 16 signing, last 16 encryption.
 */

export class FieldEncryptionKeyMissingError extends Error {
  constructor() {
    super(
      "FIELD_ENCRYPTION_KEY is not set. The SECRET_KEY-derived fallback is refused in production (spec §6).",
    );
    this.name = "FieldEncryptionKeyMissingError";
  }
}

export class InvalidFernetTokenError extends Error {
  constructor(message = "Invalid Fernet token") {
    super(message);
    this.name = "InvalidFernetTokenError";
  }
}

const VERSION = 0x80;

function decodeKey(raw: string): Buffer {
  const key = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (key.length !== 32) {
    throw new Error(`FIELD_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}.`);
  }
  return key;
}

let cachedKey: Buffer | null = null;

/**
 * Resolve the field-encryption key.
 * Production requires an explicit key; development derives one from SECRET_KEY
 * via HKDF so that a fresh checkout works without ceremony (spec §6, CC-006).
 */
export function getFieldEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const e = env();

  if (e.FIELD_ENCRYPTION_KEY) {
    cachedKey = decodeKey(e.FIELD_ENCRYPTION_KEY);
    return cachedKey;
  }

  if (e.isProduction) {
    throw new FieldEncryptionKeyMissingError();
  }

  cachedKey = Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(e.SECRET_KEY, "utf8"), Buffer.alloc(0), Buffer.from("radx-field-encryption"), 32),
  );
  return cachedKey;
}

/** Test-only: drop the cached key after mutating the environment. */
export function resetFieldEncryptionKey(): void {
  cachedKey = null;
}

export function fernetEncrypt(plaintext: string, key: Buffer = getFieldEncryptionKey()): string {
  const signingKey = key.subarray(0, 16);
  const encryptionKey = key.subarray(16, 32);

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-128-cbc", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);

  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));

  const body = Buffer.concat([Buffer.from([VERSION]), timestamp, iv, ciphertext]);
  const hmac = crypto.createHmac("sha256", signingKey).update(body).digest();

  return Buffer.concat([body, hmac]).toString("base64url");
}

export function fernetDecrypt(token: string, key: Buffer = getFieldEncryptionKey()): string {
  const signingKey = key.subarray(0, 16);
  const encryptionKey = key.subarray(16, 32);

  const raw = Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (raw.length < 1 + 8 + 16 + 32) throw new InvalidFernetTokenError("Token too short");
  if (raw[0] !== VERSION) throw new InvalidFernetTokenError("Unsupported token version");

  const body = raw.subarray(0, raw.length - 32);
  const providedMac = raw.subarray(raw.length - 32);
  const expectedMac = crypto.createHmac("sha256", signingKey).update(body).digest();

  if (!crypto.timingSafeEqual(providedMac, expectedMac)) {
    throw new InvalidFernetTokenError("HMAC verification failed");
  }

  const iv = body.subarray(9, 25);
  const ciphertext = body.subarray(25);
  const decipher = crypto.createDecipheriv("aes-128-cbc", encryptionKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Decrypt for display. A key rotation leaves old ciphertext undecryptable;
 * the spec requires that this be logged and swallowed rather than crashing the
 * employee page, so the caller gets "" and the UI shows "unavailable".
 */
export function safeFernetDecrypt(token: string | null | undefined): string {
  if (!token) return "";
  try {
    return fernetDecrypt(token);
  } catch (error) {
    logger().warn(
      { err: (error as Error).name },
      "Field decryption failed — key rotated or ciphertext corrupt; returning empty string",
    );
    return "";
  }
}
