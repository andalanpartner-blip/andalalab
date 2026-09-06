import { NextResponse } from "next/server";
import { sessionCookie } from "../../../../lib/server/auth/session";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const res = NextResponse.json({ status: "OK" });
  res.headers.set("Set-Cookie", sessionCookie(null));
  return res;
}
