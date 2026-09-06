import { NextResponse } from "next/server";
import { requireActor } from "../../../../lib/server/auth/guard";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const gate = await requireActor(request);
  if (gate.denied) return gate.response;
  const { actor } = gate;
  return NextResponse.json({
    status: "OK",
    user: { id: actor.userId, name: actor.name, email: actor.email, role: actor.role, workspace_id: actor.workspaceId }
  });
}
