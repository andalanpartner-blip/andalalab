import { NextResponse } from "next/server";
import {
  getGenerationDeps,
  previewGeneration,
  runVisualGeneration,
  type VisualGenerationInput
} from "../../../services/generation.service";
import { openAiRoute } from "../../../lib/server/auth/ai-route";
import { fakeGenerationAllowed } from "../../../lib/server/env";

/**
 * Visual generation (P2.11 / P2.20-G). Thin pass-through, now behind the team
 * auth + project-membership + rate-limit gate.
 *
 *   POST { action: "preview" | "generate", projectId, recipe, contract, ... }
 *
 * The browser never chooses the provider, model or cost — the service derives
 * them. The provider API key never leaves the server; the browser only sees
 * the `GeneratedArtifact` metadata and, on success, a request-scoped `data:`
 * URL for the returned image (nothing is persisted).
 */
export const runtime = "nodejs";

type Body = {
  readonly action?: "preview" | "generate";
  readonly projectId?: unknown;
  readonly recipe?: unknown;
  readonly contract?: unknown;
  readonly concept?: unknown;
  readonly blueprint?: unknown;
  readonly promptLanguage?: "en" | "id";
};

export async function POST(request: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ status: "ERROR", message: "That request could not be read." }, { status: 400 });
  }

  const action = body.action ?? "preview";
  if (action !== "preview" && action !== "generate") {
    return NextResponse.json({ status: "ERROR", message: "Unknown generation action." }, { status: 400 });
  }

  const gate = await openAiRoute(request, {
    permission: "workflow:run",
    route: action === "generate" ? "generate" : "recipe",
    projectId: body.projectId
  });
  if (gate.denied) return gate.response;
  const { ctx } = gate;

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
      const result = await previewGeneration(getGenerationDeps(undefined, { ledger: ctx.ledger, allowFake: fakeGenerationAllowed() }), input);
      return NextResponse.json(result);
    }

    let captured: { mime: string; base64: string } | null = null;
    const deps = getGenerationDeps(
      (bytes, mime) => {
        captured = { mime, base64: Buffer.from(bytes).toString("base64") };
      },
      { ledger: ctx.ledger, allowFake: fakeGenerationAllowed() }
    );
    const result = await runVisualGeneration(deps, input);

    if (result.status === "OK") {
      await ctx.finish({
        operation: "generate",
        status: "ok",
        provider: result.artifact.provider,
        model: result.artifact.model,
        latencyMs: result.artifact.run.latency_ms,
        artifact: {
          kind: "generation",
          hash: result.artifact.artifact_hash,
          parent_hash: result.artifact.provenance.recipe_hash,
          summary: {
            recipe_hash: result.artifact.provenance.recipe_hash,
            blueprint_hash: result.artifact.provenance.blueprint_hash,
            prompt_hash: result.artifact.provenance.prompt_hash,
            request_hash: result.artifact.request_hash,
            provider: result.artifact.provider,
            model: result.artifact.model
          }
        }
      });
      if (captured) {
        const c = captured as { mime: string; base64: string };
        return NextResponse.json({ ...result, imageDataUrl: `data:${c.mime};base64,${c.base64}` });
      }
      return NextResponse.json(result);
    }

    await ctx.finish({ operation: "generate", status: "failed", failureCode: result.issues?.[0]?.code });
    return NextResponse.json(result);
  } catch {
    await ctx.finish({ operation: "generate", status: "failed", failureCode: "route_error" });
    return NextResponse.json({ status: "ERROR", message: "Something went wrong on our end. Please try again." }, { status: 500 });
  }
}
