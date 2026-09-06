import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing (P2.20-B).
 *
 * scrypt from Node's standard library — NOT hand-rolled crypto. Passwords are
 * never stored or logged in plaintext; only the `scrypt$N$r$p$salt$hash`
 * string is persisted.
 */

const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  if (password.length < 10) throw new Error("password must be at least 10 characters");
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, ns, rs, ps, saltHex, hashHex] = parts;
  try {
    const derived = scryptSync(password, Buffer.from(saltHex!, "hex"), KEYLEN, {
      N: Number(ns),
      r: Number(rs),
      p: Number(ps)
    });
    const expected = Buffer.from(hashHex!, "hex");
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
