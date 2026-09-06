import { NextResponse } from "next/server";
import {
  getCreativeDecisionDeps,
  recordCreativeDecision
} from "../../../services/creative-decision.service";

/**
 * Human creative decision (P2.18). Thin pass-through.
 *
 *   POST { action: "approved" | "needs_correction" | "regenerate", ... }
 *     → an immutable CreativeDecision
 *
 * No provider SDK, no credentials, no model call, no generation. An `approved`
 * or `regenerate` decision NEVER triggers the image provider — generation stays
 * a separate explicit call to /api/generate. Approval is refused when the
 * visual no longer matches the current recipe / blueprint / prompt.
 */
export const runtime = "nodejs";

type Body = {
  readonly action?: "approved" | "needs_correction" | "regenerate";
  readonly [key: string]: unknown;
};

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
  if (!body.artifact || !body.recipe || !body.request) {
    return NextResponse.json(
      { status: "ERROR", message: "A decision needs the generated visual, its recipe and its generation request." },
      { status: 400 }
    );
  }

  try {
    const result = recordCreativeDecision(getCreativeDecisionDeps(), {
      action: body.action,
      projectId: typeof body.projectId === "string" && body.projectId.length > 0 ? body.projectId : "local",
      note: typeof body.note === "string" ? body.note : null,
      actor: body.actor,
      selectedCorrectionOptions: Array.isArray(body.selectedCorrectionOptions)
        ? (body.selectedCorrectionOptions as string[])
        : undefined,
      artifact: body.artifact,
      recipe: body.recipe,
      blueprint: body.blueprint,
      request: body.request,
      evidence: body.evidence,
      critique: body.critique,
      recommendation: body.recommendation,
      correctionCycle: body.correctionCycle
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { status: "ERROR", message: "Something went wrong on our end. Please try again." },
      { status: 500 }
    );
  }
}
