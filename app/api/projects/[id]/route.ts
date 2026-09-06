import { NextResponse } from "next/server";
import { requireActor, requireProject } from "../../../../lib/server/auth/guard";
import { getStorage } from "../../../../services/storage.service";
import { recordProjectArtifact, projectHistory } from "../../../../services/project.service";

/**
 * One project (P2.20-E/F/J). GET returns the project + its lineage, only for a
 * member. POST records an immutable artifact-metadata entry (hashes only).
 */
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> } | { params: { id: string } };
async function paramId(context: Ctx): Promise<string> {
  const p = "then" in context.params ? await context.params : context.params;
  return p.id;
}

export async function GET(request: Request, context: Ctx): Promise<Response> {
  const gate = await requireActor(request);
  if (gate.denied) return gate.response;
  const id = await paramId(context);
  const proj = await requireProject(gate.actor, id);
  if (proj.denied) return proj.response;
  const history = await projectHistory(getStorage(), gate.actor, id);
  return NextResponse.json({ status: "OK", project: proj.project, history });
}

export async function POST(request: Request, context: Ctx): Promise<Response> {
  const gate = await requireActor(request);
  if (gate.denied) return gate.response;
  const id = await paramId(context);
  const proj = await requireProject(gate.actor, id);
  if (proj.denied) return proj.response;

  let body: {
    kind?: unknown;
    hash?: unknown;
    parent_hash?: unknown;
    summary?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ status: "ERROR", message: "That request could not be read." }, { status: 400 });
  }

  const KINDS = ["recipe", "blueprint", "generation", "evidence", "critique", "recommendation", "cycle", "decision", "final"];
  if (typeof body.kind !== "string" || !KINDS.includes(body.kind)) {
    return NextResponse.json({ status: "ERROR", message: "Unknown artifact kind." }, { status: 400 });
  }
  if (typeof body.hash !== "string" || body.hash.length === 0 || body.hash.length > 64) {
    return NextResponse.json({ status: "ERROR", message: "A hash is required." }, { status: 400 });
  }
  const summary = body.summary && typeof body.summary === "object" && !Array.isArray(body.summary) ? (body.summary as Record<string, unknown>) : {};
  // keep summaries small and free of anything image-ish
  const safeSummary: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(summary).slice(0, 24)) {
    if (/image|bytes|base64|inlineData|dataUrl/i.test(k)) continue;
    if (typeof v === "string" && v.length > 200) continue;
    safeSummary[k] = v;
  }

  const record = await recordProjectArtifact(getStorage(), gate.actor, id, {
    kind: body.kind as never,
    hash: body.hash,
    parent_hash: typeof body.parent_hash === "string" ? body.parent_hash : null,
    summary: safeSummary
  });
  return NextResponse.json({ status: "OK", artifact: record });
}
