import { NextResponse } from "next/server";
import { getStorage } from "../../../../services/storage.service";
import { authenticate } from "../../../../services/team.service";
import { issueSession, sessionCookie } from "../../../../lib/server/auth/session";
import { checkRateLimit } from "../../../../lib/server/rate-limit";

/**
 * Sign in (P2.20-B). No public signup — accounts are created by an admin.
 */
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // rate-limit by IP-ish key to blunt credential stuffing
  const ipKey = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const rl = checkRateLimit(ipKey, "brief", Date.now());
  if (!rl.allowed) {
    return NextResponse.json({ status: "ERROR", message: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ status: "ERROR", message: "That request could not be read." }, { status: 400 });
  }
  if (typeof body.email !== "string" || typeof body.password !== "string" || body.email.length > 320 || body.password.length > 200) {
    return NextResponse.json({ status: "ERROR", message: "Enter your email and password." }, { status: 400 });
  }

  const actor = await authenticate(getStorage(), body.email, body.password);
  if (!actor) {
    return NextResponse.json({ status: "ERROR", message: "Email or password is incorrect." }, { status: 401 });
  }

  const token = issueSession({ uid: actor.userId, wid: actor.workspaceId, role: actor.role, name: actor.name });
  const res = NextResponse.json({ status: "OK", role: actor.role, name: actor.name });
  res.headers.set("Set-Cookie", sessionCookie(token));
  return res;
}
