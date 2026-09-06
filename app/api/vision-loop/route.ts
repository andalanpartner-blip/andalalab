import { NextResponse } from "next/server";
import {
  getVisionLoopDeps,
  getCorrectionCycleDeps,
  inspectGeneratedVisual,
  applyRecommendedCorrection
} from "../../../services/vision-loop.service";
import { openAiRoute } from "../../../lib/server/auth/ai-route";
import { replayEvidenceAllowed } from "../../../lib/server/env";

/**
 * The corrected-regeneration loop (P2.17 / P2.20-G). Thin pass-through, behind
 * the team auth + project-membership + rate-limit gate.
 *
 *   POST { action: "inspect", projectId, artifact, recipe, contract, ... }
 *   POST { action: "apply-correction", projectId, recommendation, ... }
 *
 * `inspect` books one evidence cost event server-side (replay: none); it never
 * regenerates. `apply-correction` runs the unchanged P6 pipeline and
 * regenerates nothing.
 */
export const runtime = "nodejs";

type Body = { readonly action?: "inspect" | "apply-correction"; readonly projectId?: unknown; readonly [key: string]: unknown };

export async function POST(request: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ status: "ERROR", message: "That request could not be read." }, { status: 400 });
  }

  if (body.action !== "inspect" && body.action !== "apply-correction") {
    return NextResponse.json({ status: "ERROR", message: "Unknown vision-loop action." }, { status: 400 });
  }

  const gate = await openAiRoute(request, {
    permission: body.action === "apply-correction" ? "workflow:run" : "workflow:run",
    route: "vision-loop",
    projectId: body.projectId
  });
  if (gate.denied) return gate.response;
  const { ctx } = gate;

  try {
    if (body.action === "inspect") {
      if (!body.artifact || !body.recipe || !body.contract || typeof body.imageBase64 !== "string") {
        await ctx.finish({ operation: "inspect", status: "failed", failureCode: "bad_request" });
        return NextResponse.json(
          { status: "ERROR", message: "Inspection needs the generated artifact, its recipe/contract and the image." },
          { status: 400 }
        );
      }
      const result = await inspectGeneratedVisual(
        getVisionLoopDeps({ ledger: ctx.ledger, allowReplay: replayEvidenceAllowed() }),
        {
          artifact: body.artifact,
          recipe: body.recipe,
          contract: body.contract,
          blueprint: body.blueprint,
          imageBase64: body.imageBase64,
          mimeType: typeof body.mimeType === "string" ? body.mimeType : "image/png"
        }
      );
      await ctx.finish(
        result.status === "OK"
          ? {
              operation: "inspect",
              status: "ok",
              provider: result.evidence.source.provider,
              model: result.evidence.source.model,
              artifact: {
                kind: "evidence",
                hash: result.evidence.evidence_hash,
                parent_hash: result.evidence.provenance.artifact_hash,
                summary: { critique_hash: result.critique.critique_hash, recommendation_hash: result.recommendation.recommendation_hash, verdict: result.critique.verdict }
              }
            }
          : { operation: "inspect", status: "failed", failureCode: result.issues?.[0]?.code }
      );
      return NextResponse.json(result);
    }

    const result = applyRecommendedCorrection(getCorrectionCycleDeps(), {
      recommendation: body.recommendation,
      critique: body.critique,
      evidence: body.evidence,
      artifact: body.artifact,
      selectedCodes: Array.isArray(body.selectedCodes) ? (body.selectedCodes as string[]) : [],
      parentRecipe: body.parentRecipe,
      contract: body.contract,
      direction: body.direction,
      concept: body.concept,
      promptLanguage: body.promptLanguage === "id" ? "id" : "en",
      request: body.request,
      parentBlueprint: body.parentBlueprint ?? body.blueprint,
      projectId: ctx.project.id,
      actor: { id: ctx.actor.userId, role: ctx.actor.role, display_name: ctx.actor.name },
      note: typeof body.note === "string" ? body.note : null
    });

    await ctx.finish(
      result.status === "OK"
        ? {
            operation: "apply-correction",
            status: "ok",
            artifact: {
              kind: "cycle",
              hash: result.cycle.cycle_hash,
              parent_hash: result.cycle.parent.recipe_hash,
              summary: { corrected_recipe_hash: result.recipe.recipe_hash, corrected_blueprint_hash: result.blueprint.blueprint_hash, decision_hash: result.decision?.decision_hash ?? null }
            }
          }
        : { operation: "apply-correction", status: "failed", failureCode: result.status }
    );
    return NextResponse.json(result);
  } catch {
    await ctx.finish({ operation: body.action ?? "vision-loop", status: "failed", failureCode: "route_error" });
    return NextResponse.json({ status: "ERROR", message: "Something went wrong on our end. Please try again." }, { status: 500 });
  }
}
