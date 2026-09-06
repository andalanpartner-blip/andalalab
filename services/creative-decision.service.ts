import type { ClockPort } from "../ports/clock.port";
import type { CreativeDecision, DecisionAction } from "../types/schemas/creative-decision.schema";
import { LOCAL_CREATIVE_ACTOR } from "../types/schemas/creative-decision.schema";
import { DecisionActor } from "../types/schemas/creative-decision.schema";

import { DesignRecipe as DesignRecipeSchema } from "../types/schemas/recipe.schema";
import { LayoutBlueprint as LayoutBlueprintSchema } from "../types/schemas/layout-blueprint.schema";
import {
  GeneratedArtifact as GeneratedArtifactSchema,
  GenerationRequest as GenerationRequestSchema
} from "../types/schemas/visual-generation.schema";
import { VisualEvidenceReport as VisualEvidenceReportSchema } from "../types/schemas/visual-evidence-report.schema";
import { DesignCritique as DesignCritiqueSchema } from "../types/schemas/design-critique.schema";
import { CorrectionRecommendation as CorrectionRecommendationSchema } from "../types/schemas/correction-recommendation.schema";
import { CorrectionCycle as CorrectionCycleSchema } from "../types/schemas/correction-cycle.schema";

import { buildCreativeDecision } from "../engine";
import { systemClock } from "../ports/clock.port";

/**
 * The Creative Decision service (P2.18).
 *
 * Re-validates the round-tripped artifacts, then calls the pure
 * `buildCreativeDecision`. It records a human's decision about one exact visual;
 * it NEVER calls a model or a provider, so an `approved` or `regenerate`
 * decision cannot trigger generation. The freshness gate lives in the engine —
 * this layer only shapes the input and the errors.
 */

export type CreativeDecisionDeps = {
  readonly clock: ClockPort;
};

export function getCreativeDecisionDeps(): CreativeDecisionDeps {
  return { clock: systemClock };
}

export type CreativeDecisionInput = {
  readonly action: DecisionAction;
  readonly projectId: string;
  readonly note?: string | null;
  /** Until P2.20 wires real users, the actor defaults to the local stand-in. */
  readonly actor?: unknown;
  readonly selectedCorrectionOptions?: readonly string[];

  readonly artifact: unknown;
  readonly recipe: unknown;
  readonly blueprint?: unknown;
  readonly request: unknown;
  readonly evidence?: unknown;
  readonly critique?: unknown;
  readonly recommendation?: unknown;
  readonly correctionCycle?: unknown;
};

export type CreativeDecisionOkResult = { readonly status: "OK"; readonly decision: CreativeDecision };
export type CreativeDecisionFailureResult = {
  readonly status: "ERROR";
  readonly message: string;
  readonly issues?: readonly { code: string; message: string; path?: string }[];
};
export type CreativeDecisionResult = CreativeDecisionOkResult | CreativeDecisionFailureResult;

export function recordCreativeDecision(
  deps: CreativeDecisionDeps,
  input: CreativeDecisionInput
): CreativeDecisionResult {
  const artifact = GeneratedArtifactSchema.safeParse(input.artifact);
  const recipe = DesignRecipeSchema.safeParse(input.recipe);
  const request = GenerationRequestSchema.safeParse(input.request);
  if (!artifact.success || !recipe.success || !request.success) {
    return { status: "ERROR", message: "That visual couldn't be read. Regenerate and try again." };
  }

  const blueprint =
    input.blueprint == null ? null : LayoutBlueprintSchema.safeParse(input.blueprint);
  if (blueprint && !blueprint.success) {
    return { status: "ERROR", message: "That layout blueprint couldn't be read." };
  }

  const evidence = input.evidence == null ? null : VisualEvidenceReportSchema.safeParse(input.evidence);
  const critique = input.critique == null ? null : DesignCritiqueSchema.safeParse(input.critique);
  const recommendation =
    input.recommendation == null ? null : CorrectionRecommendationSchema.safeParse(input.recommendation);
  const cycle =
    input.correctionCycle == null ? null : CorrectionCycleSchema.safeParse(input.correctionCycle);

  const actorParsed = input.actor == null ? null : DecisionActor.safeParse(input.actor);
  if (actorParsed && !actorParsed.success) {
    return { status: "ERROR", message: "That actor identity couldn't be read." };
  }

  const built = buildCreativeDecision({
    action: input.action,
    actor: actorParsed && actorParsed.success ? actorParsed.data : LOCAL_CREATIVE_ACTOR,
    note: input.note ?? null,
    projectId: input.projectId,
    createdAt: deps.clock.now().toISOString(),
    artifact: artifact.data,
    recipe: recipe.data,
    blueprint: blueprint && blueprint.success ? blueprint.data : null,
    request: request.data,
    evidence: evidence && evidence.success ? evidence.data : null,
    critique: critique && critique.success ? critique.data : null,
    recommendation: recommendation && recommendation.success ? recommendation.data : null,
    correctionCycle: cycle && cycle.success ? cycle.data : null,
    selectedCorrectionOptions: input.selectedCorrectionOptions
  });

  if (!built.ok) {
    return {
      status: "ERROR",
      message:
        input.action === "approved"
          ? "This visual can't be approved — it no longer matches the current design. Regenerate, then approve the fresh render."
          : "That decision couldn't be recorded against this visual.",
      issues: built.error.map((issue) => ({ code: issue.code, message: issue.message, path: issue.path }))
    };
  }

  return { status: "OK", decision: built.value };
}
