import { NextResponse } from "next/server";
import { requireActor, requirePermission } from "../../../../lib/server/auth/guard";
import { getStorage } from "../../../../services/storage.service";
import { usageSummary } from "../../../../services/usage.service";
import { AccessError } from "../../../../services/project.service";

/**
 * Admin cost / usage view (P2.20-H). Admin only — a control view, not BI.
 */
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const gate = await requireActor(request);
  if (gate.denied) return gate.response;
  const perm = requirePermission(gate.actor, "usage:view");
  if (perm.denied) return perm.response;
  try {
    const summary = await usageSummary(getStorage(), gate.actor);
    return NextResponse.json({ status: "OK", summary });
  } catch (error) {
    if (error instanceof AccessError) return NextResponse.json({ status: "ERROR", message: "Not permitted." }, { status: 403 });
    return NextResponse.json({ status: "ERROR", message: "Usage could not be loaded." }, { status: 500 });
  }
}
