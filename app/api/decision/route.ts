import { NextResponse } from "next/server";
import { getCreativeDecisionDeps, recordCreativeDecision } from "../../../services/creative-decision.service";
import { requireActor, requirePermission, requireProject } from "../../../lib/server/auth/guard";
import { getStorage } from "../../../services/storage.service";
import { recordProjectArtifact } from "../../../services/project.service";
import { newRequestId, logAi } from "../../../lib/server/logger";

/**
 * Human creative decision (P2.18 / P2.20). Behind team auth + project
 * membership. Approval requires the `decision:approve` permission. Recording a
 * decision NEVER calls a model / provider and NEVER generates or publishes.
 */
export const runtime = "nodejs";

type Body = { readonly action?: "approved" | "needs_correction" | "regenerate"; readonly projectId?: unknown; readonly [key: string]: unknown };

export async function POST(request: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ status: "ERROR", message: "That request could not be read." }, { status: 400 });
  }

  if (body.action !== "approved" && body.action !== "needs_correction" && body.action !== "regenerate") {
    return NextResponse.json({ status: "ERROR", message: "Unknown decision action." }, { status: 400 });
  }

  const gate = await requireActor(request);
  if (gate.denied) return gate.response;
  const perm = requirePermission(gate.actor, body.action === "approved" ? "decision:approve" : "workflow:run");
  if (perm.denied) return perm.response;
  const proj = await requireProject(gate.actor, typeof body.projectId === "string" ? body.projectId : null);
  if (proj.denied) return proj.response;

  if (!body.artifact || !body.recipe || !body.request) {
    return NextResponse.json(
      { status: "ERROR", message: "A decision needs the generated visual, its recipe and its generation request." },
      { status: 400 }
    );
  }

  try {
    const result = recordCreativeDecision(getCreativeDecisionDeps(), {
      action: body.action,
      projectId: proj.project.id,
      note: typeof body.note === "string" ? body.note : null,
      actor: { id: gate.actor.userId, role: gate.actor.role, display_name: gate.actor.name },
      selectedCorrectionOptions: Array.isArray(body.selectedCorrectionOptions) ? (body.selectedCorrectionOptions as string[]) : undefined,
      artifact: body.artifact,
      recipe: body.recipe,
      blueprint: body.blueprint,
      request: body.request,
      evidence: body.evidence,
      critique: body.critique,
      recommendation: body.recommendation,
      correctionCycle: body.correctionCycle
    });

    if (result.status === "OK") {
      try {
        await recordProjectArtifact(getStorage(), gate.actor, proj.project.id, {
          kind: result.decision.action === "approved" ? "final" : "decision",
          hash: result.decision.decision_hash,
          parent_hash: result.decision.subject.artifact_hash,
          summary: { action: result.decision.action, artifact_hash: result.decision.subject.artifact_hash, recipe_hash: result.decision.subject.recipe_hash, decided_by: gate.actor.name }
        });
      } catch {
        /* best-effort */
      }
    }
    logAi({ request_id: newRequestId(), user_id: gate.actor.userId, project_id: proj.project.id, operation: `decision:${body.action}`, status: result.status === "OK" ? "ok" : "failed", estimated_cost_usd: 0 });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ status: "ERROR", message: "Something went wrong on our end. Please try again." }, { status: 500 });
  }
}
