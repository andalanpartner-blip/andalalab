import { NextResponse } from "next/server";
import { requireActor, requirePermission } from "../../../lib/server/auth/guard";
import { getStorage } from "../../../services/storage.service";
import { createProject, listProjectsForActor, AccessError } from "../../../services/project.service";

/**
 * Projects (P2.20-E). GET lists the projects the actor can see; POST creates
 * one (account + admin only).
 */
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const gate = await requireActor(request);
  if (gate.denied) return gate.response;
  const projects = await listProjectsForActor(getStorage(), gate.actor);
  return NextResponse.json({ status: "OK", projects });
}

export async function POST(request: Request): Promise<Response> {
  const gate = await requireActor(request);
  if (gate.denied) return gate.response;
  const perm = requirePermission(gate.actor, "project:create");
  if (perm.denied) return perm.response;

  let body: { name?: unknown; brand?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ status: "ERROR", message: "That request could not be read." }, { status: 400 });
  }
  if (typeof body.name !== "string" || body.name.trim().length === 0 || body.name.length > 120) {
    return NextResponse.json({ status: "ERROR", message: "A project name is required." }, { status: 400 });
  }

  try {
    const project = await createProject(getStorage(), gate.actor, {
      name: body.name,
      brand: typeof body.brand === "string" ? body.brand : null
    });
    return NextResponse.json({ status: "OK", project });
  } catch (error) {
    if (error instanceof AccessError) return NextResponse.json({ status: "ERROR", message: "Not permitted." }, { status: 403 });
    return NextResponse.json({ status: "ERROR", message: "The project could not be created." }, { status: 400 });
  }
}
