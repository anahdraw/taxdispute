import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export const PASSWORD_HASH_ALGORITHM = "scrypt-v1";
export const PASSWORD_HASH_PREFIX = "tdp-scrypt-v1";

const KEY_LENGTH = 64;

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function derivePasswordKey(password: string, salt: string) {
  return scryptSync(password, salt, KEY_LENGTH, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  }).toString("base64url");
}

export function isPasswordHash(value: unknown) {
  return String(value || "").startsWith(`${PASSWORD_HASH_PREFIX}$`);
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  return `${PASSWORD_HASH_PREFIX}$${salt}$${derivePasswordKey(password, salt)}`;
}

export function verifyPassword(password: string, storedPassword: string) {
  const stored = String(storedPassword || "");
  if (!stored) return false;
  if (!isPasswordHash(stored)) {
    return safeEqual(password, stored);
  }

  const [, salt, expected] = stored.split("$");
  if (!salt || !expected) return false;
  return safeEqual(derivePasswordKey(password, salt), expected);
}

export function passwordNeedsHash(storedPassword: string) {
  return Boolean(storedPassword) && !isPasswordHash(storedPassword);
}
