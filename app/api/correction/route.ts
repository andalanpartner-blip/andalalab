import { NextResponse } from "next/server";
import { getEngineDeps, runCorrectionPipeline } from "../../../services/pipeline.service";

/** Node.js runtime: shares the dataset loader with /api/brief and /api/recipe. */
export const runtime = "nodejs";

type CorrectionRequestBody = {
  readonly parentRecipe?: unknown;
  readonly contract?: unknown;
  readonly direction?: unknown;
  readonly concept?: unknown;
  readonly patch?: unknown;
  readonly promptLanguage?: "en" | "id";
};

export async function POST(request: Request): Promise<Response> {
  let body: CorrectionRequestBody;
  try {
    body = (await request.json()) as CorrectionRequestBody;
  } catch {
    return NextResponse.json(
      { status: "ERROR", message: "That request could not be read. Please try again." },
      { status: 400 }
    );
  }

  if (!body.parentRecipe || !body.contract || !body.direction || !body.patch) {
    return NextResponse.json(
      { status: "ERROR", message: "That correction is incomplete. Please start again from the recipe." },
      { status: 400 }
    );
  }

  try {
    const { datasets, ids, clock } = getEngineDeps();
    const result = runCorrectionPipeline(
      { datasets, ids, clock },
      {
        parentRecipe: body.parentRecipe,
        contract: body.contract,
        direction: body.direction,
        concept: body.concept,
        patch: body.patch,
        promptLanguage: body.promptLanguage
      }
    );
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { status: "ERROR", message: "Something went wrong on our end. Please try again." },
      { status: 500 }
    );
  }
}
