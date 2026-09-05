import { NextResponse } from "next/server";
import { getEngineDeps, runRecipePipeline } from "../../../services/pipeline.service";

/** Node.js runtime: shares the dataset loader with /api/brief. */
export const runtime = "nodejs";

type RecipeRequestBody = {
  readonly contract?: unknown;
  readonly direction?: unknown;
  readonly concept?: unknown;
  readonly promptLanguage?: "en" | "id";
};

export async function POST(request: Request): Promise<Response> {
  let body: RecipeRequestBody;
  try {
    body = (await request.json()) as RecipeRequestBody;
  } catch {
    return NextResponse.json(
      { status: "ERROR", message: "That request could not be read. Please try again." },
      { status: 400 }
    );
  }

  if (!body.contract || !body.direction || !body.concept) {
    return NextResponse.json(
      { status: "ERROR", message: "That selection is incomplete. Please choose a concept again." },
      { status: 400 }
    );
  }

  try {
    const { datasets, ids, clock } = getEngineDeps();
    const result = runRecipePipeline(
      { datasets, ids, clock },
      {
        contract: body.contract,
        direction: body.direction,
        concept: body.concept,
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
