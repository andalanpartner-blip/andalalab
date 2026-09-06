import { NextResponse } from "next/server";
import {
  getVisionLoopDeps,
  getCorrectionCycleDeps,
  inspectGeneratedVisual,
  applyRecommendedCorrection
} from "../../../services/vision-loop.service";

/**
 * The corrected-regeneration loop (P2.17). Thin pass-through.
 *
 *   POST { action: "inspect" }          → evidence + critique + recommendation
 *   POST { action: "apply-correction" } → corrected recipe + fresh blueprint /
 *                                         prompt + a CorrectionCycle record
 *
 * No provider SDK, no credential access, no design logic here. `inspect` books
 * one evidence cost event on the server (a replay observer books none); it
 * never regenerates. `apply-correction` runs the unchanged P6 pipeline and
 * regenerates nothing — that is a separate explicit call to /api/generate.
 */
export const runtime = "nodejs";

type Body = {
  readonly action?: "inspect" | "apply-correction";
  readonly [key: string]: unknown;
};

export async function POST(request: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ status: "ERROR", message: "That request could not be read." }, { status: 400 });
  }

  const action = body.action;
  try {
    if (action === "inspect") {
      if (!body.artifact || !body.recipe || !body.contract || typeof body.imageBase64 !== "string") {
        return NextResponse.json(
          { status: "ERROR", message: "Inspection needs the generated artifact, its recipe/contract and the image." },
          { status: 400 }
        );
      }
      const result = await inspectGeneratedVisual(getVisionLoopDeps(), {
        artifact: body.artifact,
        recipe: body.recipe,
        contract: body.contract,
        blueprint: body.blueprint,
        imageBase64: body.imageBase64,
        mimeType: typeof body.mimeType === "string" ? body.mimeType : "image/png"
      });
      return NextResponse.json(result);
    }

    if (action === "apply-correction") {
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
        // P2.18 — record the human's `needs_correction` decision alongside the cycle
        request: body.request,
        parentBlueprint: body.parentBlueprint ?? body.blueprint,
        projectId: typeof body.projectId === "string" ? body.projectId : "local",
        actor: body.actor,
        note: typeof body.note === "string" ? body.note : null
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ status: "ERROR", message: "Unknown vision-loop action." }, { status: 400 });
  } catch {
    return NextResponse.json(
      { status: "ERROR", message: "Something went wrong on our end. Please try again." },
      { status: 500 }
    );
  }
}
