import { NextResponse } from "next/server";
import {
  getGenerationDeps,
  previewGeneration,
  runVisualGeneration,
  type VisualGenerationInput
} from "../../../services/generation.service";

/**
 * Node.js runtime: shares the dataset loader with the other API routes.
 *
 * Thin pass-through. No provider SDK, no credential access, no design logic —
 * it validates the shape, calls the generation service, and returns the result.
 * The provider API key never leaves the server; the browser only ever sees the
 * `GeneratedArtifact` metadata and, on success, a request-scoped `data:` URL
 * for the returned image (nothing is persisted).
 */
export const runtime = "nodejs";

type GenerateRequestBody = {
  readonly action?: "preview" | "generate";
  readonly recipe?: unknown;
  readonly contract?: unknown;
  readonly concept?: unknown;
  readonly blueprint?: unknown;
  readonly promptLanguage?: "en" | "id";
};

export async function POST(request: Request): Promise<Response> {
  let body: GenerateRequestBody;
  try {
    body = (await request.json()) as GenerateRequestBody;
  } catch {
    return NextResponse.json(
      { status: "ERROR", message: "That request could not be read. Please try again." },
      { status: 400 }
    );
  }

  const action = body.action ?? "preview";
  if (action !== "preview" && action !== "generate") {
    return NextResponse.json({ status: "ERROR", message: "Unknown generation action." }, { status: 400 });
  }
  if (!body.recipe || !body.contract) {
    return NextResponse.json(
      { status: "ERROR", message: "That design is incomplete. Rebuild the recipe and try again." },
      { status: 400 }
    );
  }

  const input: VisualGenerationInput = {
    recipe: body.recipe,
    contract: body.contract,
    concept: body.concept,
    blueprint: body.blueprint,
    promptLanguage: body.promptLanguage
  };

  try {
    if (action === "preview") {
      const result = await previewGeneration(getGenerationDeps(), input);
      return NextResponse.json(result);
    }

    // action === "generate" — the explicit downstream call.
    let captured: { mime: string; base64: string } | null = null;
    const deps = getGenerationDeps((bytes, mime) => {
      captured = { mime, base64: Buffer.from(bytes).toString("base64") };
    });
    const result = await runVisualGeneration(deps, input);

    if (result.status === "OK" && captured) {
      const c = captured as { mime: string; base64: string };
      return NextResponse.json({ ...result, imageDataUrl: `data:${c.mime};base64,${c.base64}` });
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { status: "ERROR", message: "Something went wrong on our end. Please try again." },
      { status: 500 }
    );
  }
}
