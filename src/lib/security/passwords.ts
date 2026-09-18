import crypto from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { env } from "@/lib/config/env";
import { COMMON_PASSWORDS } from "./common-passwords";

/**
 * Password hashing and policy (spec §2).
 *
 * Argon2id is the preferred algorithm. PBKDF2-SHA256 is retained for
 * *verification only*, in Django's `pbkdf2_sha256$iterations$salt$hash`
 * encoding, so that user rows migrated from the Django system can sign in
 * once and be transparently upgraded to Argon2 on that first login.
 */

const ARGON2_OPTIONS = {
  // ~19 MiB, 2 passes, 1 lane — the OWASP baseline for argon2id, and
  // comfortable for an App Service B1/P0v3 instance.
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, ARGON2_OPTIONS);
}

function verifyDjangoPbkdf2(plain: string, encoded: string): boolean {
  // pbkdf2_sha256$<iterations>$<salt>$<base64 hash>
  const parts = encoded.split("$");
  if (parts.length !== 4) return false;
  const [algorithm, iterationsRaw, salt, expected] = parts as [string, string, string, string];
  if (algorithm !== "pbkdf2_sha256") return false;

  const iterations = Number.parseInt(iterationsRaw, 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  const derived = crypto
    .pbkdf2Sync(plain, salt, iterations, 32, "sha256")
    .toString("base64");

  const a = Buffer.from(derived);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface PasswordVerification {
  valid: boolean;
  /** True when the stored hash uses the legacy scheme and should be rewritten. */
  needsRehash: boolean;
}

export async function verifyPassword(plain: string, stored: string): Promise<PasswordVerification> {
  if (!stored) return { valid: false, needsRehash: false };

  if (stored.startsWith("$argon2")) {
    try {
      const valid = await argonVerify(stored, plain);
      return { valid, needsRehash: false };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  if (stored.startsWith("pbkdf2_sha256$")) {
    const valid = verifyDjangoPbkdf2(plain, stored);
    return { valid, needsRehash: valid };
  }

  return { valid: false, needsRehash: false };
}

export interface PasswordPolicyResult {
  ok: boolean;
  errors: string[];
}

/**
 * Password policy (spec §2): minimum length, common-password check,
 * numeric-only check, plus a similarity check against the user's own
 * identifiers — the same four validators Django ships with.
 */
export function validatePasswordPolicy(
  password: string,
  context: { username?: string; email?: string; firstName?: string; lastName?: string } = {},
): PasswordPolicyResult {
  const minLength = env().PASSWORD_MIN_LENGTH;
  const errors: string[] = [];

  if (password.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters long.`);
  }

  if (/^\d+$/.test(password)) {
    errors.push("Password cannot be entirely numeric.");
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push("That password is too common. Choose something less predictable.");
  }

  const lowered = password.toLowerCase();
  for (const raw of [context.username, context.email?.split("@")[0], context.firstName, context.lastName]) {
    const candidate = raw?.trim().toLowerCase();
    if (candidate && candidate.length >= 4 && lowered.includes(candidate)) {
      errors.push("Password is too similar to your name, username or email address.");
      break;
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Generate a readable temporary password that still satisfies the policy —
 * used when IT provisions a mailbox for a new employee.
 * Ambiguous characters (0/O, 1/l/I) are excluded so it can be read aloud.
 */
export function generateTemporaryPassword(length = 16): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}
