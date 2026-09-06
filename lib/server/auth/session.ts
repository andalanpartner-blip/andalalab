import { createHmac, timingSafeEqual } from "node:crypto";
import { appEnv, sessionSecret } from "../env";
import { SESSION_COOKIE } from "../../auth/cookie-name";

/**
 * Stateless signed-cookie sessions (P2.20-B).
 *
 * Token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload,
 * SESSION_SECRET)). No server-side session store; the HMAC makes the payload
 * tamper-evident. `exp` bounds the lifetime. The secret never leaves the
 * server and is never logged.
 *
 * This is a small, standard construction on Node's stdlib crypto — not
 * hand-rolled primitives.
 */

export { SESSION_COOKIE };
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h

export type SessionPayload = {
  readonly uid: string;
  readonly wid: string;
  readonly role: "admin" | "designer" | "account";
  readonly name: string;
  /** unix seconds */
  readonly iat: number;
  readonly exp: number;
};

const b64u = (buf: Buffer): string => buf.toString("base64url");
const fromB64u = (s: string): Buffer => Buffer.from(s, "base64url");

function sign(payloadB64: string, secret: string): string {
  return b64u(createHmac("sha256", secret).update(payloadB64).digest());
}

export function issueSession(
  input: Omit<SessionPayload, "iat" | "exp">,
  now = Math.floor(Date.now() / 1000),
  secret = sessionSecret()
): string {
  const payload: SessionPayload = { ...input, iat: now, exp: now + SESSION_TTL_SECONDS };
  const payloadB64 = b64u(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export function readSession(
  token: string | undefined | null,
  now = Math.floor(Date.now() / 1000),
  secret = sessionSecret()
): SessionPayload | null {
  if (!token || !token.includes(".")) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;

  const expected = sign(payloadB64, secret);
  const a = fromB64u(sig);
  const b = fromB64u(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromB64u(payloadB64).toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (!payload.uid || !payload.wid || !payload.role) return null;
  return payload;
}

/** The Set-Cookie value for a session token (or for clearing it). */
export function sessionCookie(token: string | null): string {
  const base = `${SESSION_COOKIE}=`;
  // Secure everywhere except plain-http local development.
  const secure = appEnv() === "development" ? "" : "; Secure";
  const attrs = `Path=/; HttpOnly; SameSite=Lax${secure}`;
  if (token === null) return `${base}; ${attrs}; Max-Age=0`;
  return `${base}${token}; ${attrs}; Max-Age=${SESSION_TTL_SECONDS}`;
}
