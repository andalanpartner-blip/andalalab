import type { DatasetRegistry } from "../types/datasets";
import type { ClockPort } from "../ports/clock.port";
import type { IdPort } from "../ports/id.port";
import type {
  GenerationEstimate,
  GenerationIssue,
  VisualGenerationPort
} from "../ports/visual-generation.port";
import type {
  GeneratedArtifact,
  GenerationConfig,
  GenerationRequest
} from "../types/schemas/visual-generation.schema";

import { DesignContract as DesignContractSchema } from "../types/schemas/contract.schema";
import { DesignRecipe as DesignRecipeSchema } from "../types/schemas/recipe.schema";
import { CreativeConcept as CreativeConceptSchema } from "../types/schemas/concept.schema";
import { LayoutBlueprint as LayoutBlueprintSchema } from "../types/schemas/layout-blueprint.schema";

import {
  buildGenerationRequest,
  compilePromptSet,
  resolveAspectRatio,
  resolveVisualType,
  type PromptLanguage
} from "../engine";
import { systemClock } from "../ports/clock.port";
import { createCostLedger } from "./cost.service";
import { getEngineDeps } from "./pipeline.service";
import { createGeminiImageGeneration } from "../adapters/visual-generation/gemini-image";
import { createFakeVisualGeneration } from "../adapters/visual-generation/fake";

/**
 * Visual generation — the EXPLICIT downstream action (P2.11).
 *
 * `DesignRecipe (+ LayoutBlueprint) → PromptCompiler → GenerationRequest →
 * VisualGenerationPort → GeneratedArtifact`.
 *
 * It is NOT part of `runRecipePipeline` or `runCorrectionPipeline`: recipe
 * creation and visual generation are separate operations, so cost, human
 * approval, regeneration and provider switching stay under explicit control.
 *
 * This file makes no design decision and holds no provider knowledge. It
 * re-validates the round-tripped artifacts, resolves the aspect ratio from the
 * dataset, compiles the prompt via the existing compiler, hands the normalised
 * request to the injected port, and returns the result.
 */

export type GenerationServiceDeps = {
  readonly datasets: DatasetRegistry;
  readonly ids: IdPort;
  readonly clock: ClockPort;
  readonly generator: VisualGenerationPort;
};

/**
 * Real, process-wide generation dependencies (P2.12 / UI/UX-03).
 *
 * Reuses the pipeline's cached datasets / ids / clock and adds a
 * `VisualGenerationPort`. The provider is Gemini image by default; set
 * `GENERATION_PROVIDER=fake` to use the fake adapter (with a grey placeholder
 * image) for offline verification while the Gemini account has no image
 * quota. The credential is read here from the same `GEMINI_API_KEY` env var the
 * text adapter uses — never hardcoded, never logged, never sent to the browser.
 *
 * `onImageBytes` is a request-scoped transport hook: the API route passes a
 * closure that captures the decoded bytes so the route can return a
 * `data:` URL to the browser for THAT response only. Nothing is persisted.
 */
export function getGenerationDeps(
  onImageBytes?: (bytes: Uint8Array, mimeType: string) => void,
  options: { ledger?: import("../ports/cost.port").CostLedgerPort; allowFake?: boolean } = {}
): GenerationServiceDeps {
  const { datasets, ids, clock } = getEngineDeps();
  const ledger = options.ledger ?? createCostLedger({ clock: systemClock });

  const wantsFake = process.env["GENERATION_PROVIDER"]?.trim() === "fake";
  const generator =
    wantsFake && options.allowFake !== false
      ? createFakeVisualGeneration({ ledger, clock: systemClock, ids, deliverImage: true, onImageBytes })
      : createGeminiImageGeneration({
          apiKey: process.env["GEMINI_API_KEY"]?.trim() ?? "",
          clock: systemClock,
          ids,
          ledger,
          onImageBytes
        });

  return { datasets, ids, clock, generator };
}

export type VisualGenerationInput = {
  readonly recipe: unknown;
  readonly contract: unknown;
  readonly concept?: unknown;
  /** The P2.10 blueprint for this recipe, when the client holds one. Optional. */
  readonly blueprint?: unknown;
  readonly promptLanguage?: PromptLanguage;
  readonly config?: Partial<Omit<GenerationConfig, "prompt_language">>;
};

export type VisualGenerationOkResult = {
  readonly status: "OK";
  readonly request: GenerationRequest;
  readonly artifact: GeneratedArtifact;
};
export type VisualGenerationFailureResult = {
  readonly status: "ERROR";
  readonly message: string;
  /** Present when the provider (or the fake) returned explicit issues. */
  readonly issues?: readonly GenerationIssue[];
};
export type VisualGenerationResult = VisualGenerationOkResult | VisualGenerationFailureResult;

export type GenerationPreviewOkResult = {
  readonly status: "OK";
  readonly request: GenerationRequest;
  readonly estimate: GenerationEstimate;
};
export type GenerationPreviewResult = GenerationPreviewOkResult | VisualGenerationFailureResult;

/**
 * Build the normalised `GenerationRequest` from the round-tripped artifacts —
 * validation, aspect-ratio resolution, prompt compilation, request assembly.
 * Shared by `previewGeneration` and `runVisualGeneration`. It does NOT call the
 * provider.
 */
function assembleRequest(
  deps: GenerationServiceDeps,
  input: VisualGenerationInput
): { ok: true; request: GenerationRequest; projectId: string } | { ok: false; message: string } {
  const recipeParsed = DesignRecipeSchema.safeParse(input.recipe);
  const contractParsed = DesignContractSchema.safeParse(input.contract);
  if (!recipeParsed.success || !contractParsed.success) {
    return { ok: false, message: "That design couldn't be read. Rebuild the recipe and try again." };
  }
  const recipe = recipeParsed.data;
  const contract = contractParsed.data;
  if (recipe.contract_id !== contract.id) {
    return { ok: false, message: "The recipe and contract don't match — start again from the recipe." };
  }

  const conceptParsed = input.concept == null ? null : CreativeConceptSchema.safeParse(input.concept);
  if (conceptParsed && !conceptParsed.success) {
    return { ok: false, message: "That concept couldn't be read. Choose a concept again." };
  }

  const blueprintParsed =
    input.blueprint == null ? null : LayoutBlueprintSchema.safeParse(input.blueprint);
  if (blueprintParsed && !blueprintParsed.success) {
    return { ok: false, message: "That layout blueprint couldn't be read. Open the Layout stage and try again." };
  }
  const blueprint = blueprintParsed && blueprintParsed.success ? blueprintParsed.data : null;
  if (blueprint && blueprint.derived_from.recipe_hash !== recipe.recipe_hash) {
    return {
      ok: false,
      message: "The layout blueprint is out of date for this recipe. Rebuild the layout before generating."
    };
  }

  const visualType = resolveVisualType(deps.datasets, contract.visual_type.id);
  if (!visualType) {
    return { ok: false, message: `Visual type "${contract.visual_type.id}" is not in the dataset.` };
  }
  const aspectRatio = resolveAspectRatio(visualType, contract.visual_type.aspect_ratio_id);
  if (!aspectRatio) {
    return {
      ok: false,
      message: `Aspect ratio "${contract.visual_type.aspect_ratio_id}" is not defined for ${visualType.id}.`
    };
  }

  const promptSet = compilePromptSet({
    recipe,
    concept: conceptParsed && conceptParsed.success ? conceptParsed.data : null,
    language: input.promptLanguage ?? "en"
  });

  const requestResult = buildGenerationRequest({
    recipe,
    blueprint,
    promptSet,
    aspectRatio,
    visualTypeId: visualType.id,
    datasetVersion: deps.datasets.version,
    config: input.config
  });
  if (!requestResult.ok) {
    return {
      ok: false,
      message: `The generation request couldn't be assembled: ${requestResult.error
        .map((issue) => issue.message)
        .join("; ")}`
    };
  }
  return { ok: true, request: requestResult.value, projectId: recipe.project_id };
}

/**
 * The cost-confirmation step — build the request and estimate it, WITHOUT
 * calling the provider or recording any cost. Entering `?stage=generate`
 * triggers this, never `runVisualGeneration`.
 */
export async function previewGeneration(
  deps: GenerationServiceDeps,
  input: VisualGenerationInput
): Promise<GenerationPreviewResult> {
  const assembled = assembleRequest(deps, input);
  if (!assembled.ok) return { status: "ERROR", message: assembled.message };
  return {
    status: "OK",
    request: assembled.request,
    estimate: deps.generator.estimate(assembled.request)
  };
}

export async function runVisualGeneration(
  deps: GenerationServiceDeps,
  input: VisualGenerationInput
): Promise<VisualGenerationResult> {
  const assembled = assembleRequest(deps, input);
  if (!assembled.ok) return { status: "ERROR", message: assembled.message };
  const request = assembled.request;

  const generated = await deps.generator.generate(request, {
    projectId: assembled.projectId
  });
  if (!generated.ok) {
    return {
      status: "ERROR",
      message: `Visual generation failed (${generated.error.map((i) => i.code).join(", ")}).`,
      issues: generated.error
    };
  }

  return { status: "OK", request, artifact: generated.value };
}
