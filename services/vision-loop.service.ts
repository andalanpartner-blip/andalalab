import type { DatasetRegistry } from "../types/datasets";
import type { ClockPort } from "../ports/clock.port";
import type { IdPort } from "../ports/id.port";
import type { EvidenceIssue } from "../ports/visual-evidence.port";
import type { VisualEvidenceReport } from "../types/schemas/visual-evidence-report.schema";
import type { DesignCritique } from "../types/schemas/design-critique.schema";
import type { CorrectionRecommendation } from "../types/schemas/correction-recommendation.schema";
import type { CorrectionCycle } from "../types/schemas/correction-cycle.schema";
import { CorrectionCycle as CorrectionCycleSchema } from "../types/schemas/correction-cycle.schema";

import { DesignRecipe as DesignRecipeSchema } from "../types/schemas/recipe.schema";
import { DesignContract as DesignContractSchema } from "../types/schemas/contract.schema";
import { DesignDirection as DesignDirectionSchema } from "../types/schemas/direction.schema";
import { LayoutBlueprint as LayoutBlueprintSchema } from "../types/schemas/layout-blueprint.schema";
import { GeneratedArtifact as GeneratedArtifactSchema } from "../types/schemas/visual-generation.schema";
import { CorrectionRecommendation as CorrectionRecommendationSchema } from "../types/schemas/correction-recommendation.schema";
import { DesignCritique as DesignCritiqueSchema } from "../types/schemas/design-critique.schema";

import { SCHEMA_VERSIONS } from "../types/versions";
import { canonicalise, fnv1a } from "../types/primitives";
import { deepFreeze } from "../domain/contract";
import {
  evaluateVisionCritique,
  recommendCorrections,
  toCorrectionPatch,
  type PromptLanguage,
  type PromptSet
} from "../engine";
import {
  runCorrectionPipeline,
  type CorrectionPipelineResult,
  getEngineDeps
} from "./pipeline.service";
import {
  runVisualEvidence,
  getEvidenceDeps,
  type EvidenceServiceDeps
} from "./evidence.service";

/**
 * The corrected-regeneration loop (P2.17).
 *
 *   generated visual
 *     → [inspect]  evidence → critique → recommendation           (one explicit action)
 *     → [apply]    human-selected options → corrected recipe       (one explicit action)
 *                  via the UNCHANGED P6 engine → fresh blueprint + prompt
 *     → [generate] existing runVisualGeneration                     (one explicit action)
 *
 * There is NO autonomous loop. Each function is a separate, explicitly-triggered
 * step; none of them calls the next. `inspect` books exactly one evidence cost
 * event (a replay observer books none). `apply` books nothing. Regeneration is
 * the existing generation service, unchanged, and books its own one event.
 */

// --- step 1: inspect ------------------------------------------------------

export type InspectVisualInput = {
  readonly artifact: unknown;
  readonly recipe: unknown;
  readonly contract: unknown;
  readonly blueprint?: unknown;
  /** The transient generated image, base64 (or a data: URL). Never persisted. */
  readonly imageBase64: string;
  readonly mimeType: string;
};

export type InspectVisualOkResult = {
  readonly status: "OK";
  readonly evidence: VisualEvidenceReport;
  readonly critique: DesignCritique;
  readonly recommendation: CorrectionRecommendation;
};
export type InspectVisualFailureResult = {
  readonly status: "ERROR";
  readonly message: string;
  readonly issues?: readonly EvidenceIssue[];
};
export type InspectVisualResult = InspectVisualOkResult | InspectVisualFailureResult;

export type VisionLoopDeps = EvidenceServiceDeps;

/** Real dependencies — evidence observer + datasets/ids/clock. */
export function getVisionLoopDeps(): VisionLoopDeps {
  return getEvidenceDeps();
}

/**
 * ONE explicit inspection: observe the render, compare it to the intent, and
 * derive bounded correction options. Books one evidence cost event (real
 * provider) or none (replay). Runs NO generation.
 */
export async function inspectGeneratedVisual(
  deps: VisionLoopDeps,
  input: InspectVisualInput
): Promise<InspectVisualResult> {
  const artifactParsed = GeneratedArtifactSchema.safeParse(input.artifact);
  const recipeParsed = DesignRecipeSchema.safeParse(input.recipe);
  const contractParsed = DesignContractSchema.safeParse(input.contract);
  if (!artifactParsed.success || !recipeParsed.success || !contractParsed.success) {
    return { status: "ERROR", message: "That generation couldn't be read. Regenerate and try again." };
  }
  const blueprintParsed =
    input.blueprint == null ? null : LayoutBlueprintSchema.safeParse(input.blueprint);
  if (blueprintParsed && !blueprintParsed.success) {
    return { status: "ERROR", message: "That layout blueprint couldn't be read." };
  }
  const blueprint = blueprintParsed && blueprintParsed.success ? blueprintParsed.data : null;

  const evidenceResult = await runVisualEvidence(deps, {
    artifact: artifactParsed.data,
    recipe: recipeParsed.data,
    blueprint: blueprint ?? undefined,
    imageBase64: input.imageBase64,
    mimeType: input.mimeType
  });
  if (evidenceResult.status !== "OK") {
    return { status: "ERROR", message: evidenceResult.message, issues: evidenceResult.issues };
  }

  const critique = evaluateVisionCritique({
    recipe: recipeParsed.data,
    contract: contractParsed.data,
    blueprint,
    evidence: evidenceResult.evidence
  });
  if (!critique.ok) {
    return { status: "ERROR", message: "The rendered visual could not be compared to the design intent." };
  }

  const recommendation = recommendCorrections({
    recipe: recipeParsed.data,
    contract: contractParsed.data,
    blueprint,
    evidence: evidenceResult.evidence,
    critique: critique.value
  });
  if (!recommendation.ok) {
    return { status: "ERROR", message: "Correction options could not be derived from the critique." };
  }

  return {
    status: "OK",
    evidence: evidenceResult.evidence,
    critique: critique.value,
    recommendation: recommendation.value
  };
}

// --- step 2: apply the human-selected correction ------------------------

export type ApplyCorrectionCycleInput = {
  readonly recommendation: unknown;
  readonly critique: unknown;
  readonly evidence: unknown;
  readonly artifact: unknown;
  /** Option codes the HUMAN selected. Empty ⇒ nothing to apply. */
  readonly selectedCodes: readonly string[];
  readonly parentRecipe: unknown;
  readonly contract: unknown;
  readonly direction: unknown;
  readonly concept?: unknown;
  readonly promptLanguage?: PromptLanguage;
};

export type ApplyCorrectionCycleOkResult = Extract<CorrectionPipelineResult, { status: "OK" }> & {
  readonly cycle: CorrectionCycle;
};
export type ApplyCorrectionCycleResult =
  | ApplyCorrectionCycleOkResult
  | Exclude<CorrectionPipelineResult, { status: "OK" }>;

function promptSetHash(set: PromptSet): string {
  return fnv1a(
    canonicalise({
      master: set.masterPrompt,
      imageOnly: set.imageOnlyPrompt,
      designLayout: set.designLayoutPrompt,
      negative: set.negativePrompt,
      language: set.language
    })
  );
}

export function getCorrectionCycleDeps(): Pick<
  ReturnType<typeof getEngineDeps>,
  "datasets" | "ids" | "clock"
> {
  const { datasets, ids, clock } = getEngineDeps();
  return { datasets, ids, clock };
}

/**
 * ONE explicit correction cycle. Converts the human-selected recommendation
 * options into a P6 `CorrectionPatch`, runs the UNCHANGED P6 pipeline (corrected
 * recipe + fresh blueprint + fresh prompt + fresh P4.0 critic), and records an
 * immutable `CorrectionCycle` lineage entry. Runs NO generation — regeneration
 * is a separate explicit step.
 */
export function applyRecommendedCorrection(
  deps: { datasets: DatasetRegistry; ids: IdPort; clock: ClockPort },
  input: ApplyCorrectionCycleInput
): ApplyCorrectionCycleResult {
  const recommendationParsed = CorrectionRecommendationSchema.safeParse(input.recommendation);
  const critiqueParsed = DesignCritiqueSchema.safeParse(input.critique);
  const artifactParsed = GeneratedArtifactSchema.safeParse(input.artifact);
  const parentParsed = DesignRecipeSchema.safeParse(input.parentRecipe);
  const contractParsed = DesignContractSchema.safeParse(input.contract);
  const directionParsed = DesignDirectionSchema.safeParse(input.direction);

  if (
    !recommendationParsed.success ||
    !critiqueParsed.success ||
    !artifactParsed.success ||
    !parentParsed.success ||
    !contractParsed.success ||
    !directionParsed.success
  ) {
    return { status: "ERROR", message: "That correction couldn't be read. Re-inspect the visual and try again." };
  }

  const recommendation = recommendationParsed.data;
  const parentRecipe = parentParsed.data;

  if (recommendation.provenance.recipe_hash !== parentRecipe.recipe_hash) {
    return {
      status: "ERROR",
      message: "This recommendation was made for an earlier recipe version. Re-inspect the current visual."
    };
  }

  const draft = toCorrectionPatch(recommendation, input.selectedCodes);
  if (!draft.patch) {
    return {
      status: "ERROR",
      message: "No applicable correction options were selected. Pick at least one bounded option to apply."
    };
  }

  const pipelineResult = runCorrectionPipeline(deps, {
    parentRecipe,
    contract: contractParsed.data,
    direction: directionParsed.data,
    concept: input.concept ?? undefined,
    patch: draft.patch,
    promptLanguage: input.promptLanguage
  });

  if (pipelineResult.status !== "OK") {
    return pipelineResult;
  }

  const artifact = artifactParsed.data;
  const critique = critiqueParsed.data;

  const cycleBody = {
    schema_version: SCHEMA_VERSIONS.correctionCycle,
    dataset_version: recommendation.dataset_version,
    parent: {
      generated_artifact_id: artifact.artifact_id,
      artifact_hash: artifact.artifact_hash,
      recipe_id: parentRecipe.id,
      recipe_hash: parentRecipe.recipe_hash,
      blueprint_hash: artifact.provenance.blueprint_hash,
      evidence_id: critique.provenance.evidence_id,
      evidence_hash: recommendation.provenance.evidence_hash,
      critique_id: critique.critique_id,
      critique_hash: recommendation.provenance.critique_hash,
      recommendation_id: recommendation.recommendation_id,
      recommendation_hash: recommendation.recommendation_hash
    },
    selected_options: draft.selected.map(String),
    skipped_options: draft.skipped.map(String),
    correction: pipelineResult.correction,
    corrected: {
      recipe_id: pipelineResult.recipe.id,
      recipe_hash: pipelineResult.recipe.recipe_hash,
      blueprint_hash: pipelineResult.blueprint.blueprint_hash,
      prompt_hash: promptSetHash(pipelineResult.promptSet)
    },
    regenerated: false as const,
    note:
      `Applied ${draft.selected.length} bounded option${draft.selected.length === 1 ? "" : "s"} ` +
      `to recipe ${parentRecipe.recipe_hash} → ${pipelineResult.recipe.recipe_hash}. ` +
      `Regeneration is a separate explicit step and has not run.`
  };

  const cycle = {
    ...cycleBody,
    cycle_id: `cycle_${fnv1a(canonicalise(cycleBody))}`,
    created_at: deps.clock.now().toISOString(),
    cycle_hash: fnv1a(canonicalise(cycleBody))
  };

  const validated = CorrectionCycleSchema.safeParse(cycle);
  if (!validated.success) {
    return {
      status: "ERROR",
      message: `The correction cycle record could not be assembled: ${validated.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    };
  }

  return { ...pipelineResult, cycle: deepFreeze(validated.data) };
}
