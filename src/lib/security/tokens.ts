import crypto from "node:crypto";

/** Opaque, unguessable tokens and the hashes we actually store. */

/** 256 bits of CSPRNG output, url-safe base64. */
export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** 64 hex characters — the shape the device agent protocol expects (spec §3.4). */
export function generateDeviceKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Short random path segment used to make upload URLs unguessable (spec §6). */
export function randomPathSegment(bytes = 16): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** Constant-time string comparison that never leaks length through timing. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // Hash both first so unequal lengths do not short-circuit.
  const hashA = crypto.createHash("sha256").update(bufA).digest();
  const hashB = crypto.createHash("sha256").update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}
