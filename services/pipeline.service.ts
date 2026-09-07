import { join } from "node:path";

import type { DatasetRegistry } from "../types/datasets";
import type { ClockPort } from "../ports/clock.port";
import type { IdPort } from "../ports/id.port";
import type { LlmIssue, LlmPort } from "../ports/llm.port";
import type { NormalizedBrief } from "../types/schemas/brief.schema";
import type { DesignContract } from "../types/schemas/contract.schema";
import { DesignContract as DesignContractSchema } from "../types/schemas/contract.schema";
import type { DesignDirection } from "../types/schemas/direction.schema";
import { DesignDirection as DesignDirectionSchema } from "../types/schemas/direction.schema";
import { CreativeConcept as CreativeConceptSchema } from "../types/schemas/concept.schema";
import type { DesignRecipe } from "../types/schemas/recipe.schema";
import { DesignRecipe as DesignRecipeSchema } from "../types/schemas/recipe.schema";
import { CorrectionPatch as CorrectionPatchSchema } from "../types/schemas/correction.schema";
import { VisualEvidence as VisualEvidenceSchema } from "../types/schemas/visual-evidence.schema";

import { loadDatasets } from "../data/loader";
import { createGeminiLlm } from "../adapters/llm/gemini";
import { systemClock } from "../ports/clock.port";
import { randomIds } from "../ports/id.port";
import { createCostLedger } from "./cost.service";

import {
  progressiveBriefing,
  appendClarificationAnswers,
  buildDesignContract,
  buildDesignDirection,
  selectedCandidate,
  generateConcepts,
  buildDesignRecipe,
  compilePromptSet,
  auditDesign,
  reviewDesign,
  applyCorrection,
  resolveLayoutBlueprint,
  retargetLayout,
  layoutTemplateOverview,
  retargetDirection,
  visualDirectionOverview,
  type LayoutTemplateOverview,
  type VisualDirectionOverview,
  type ClarificationQuestion,
  type ConceptGenerationOutcome,
  type PromptLanguage,
  type PromptSet,
  type DesignCriticReport,
  type VisualReviewReport,
  type CorrectionReport,
  type LayoutBlueprint
} from "../engine";

/**
 * The orchestration layer.
 *
 * This file makes zero design decisions. It wires the pure engine functions
 * (contract, direction, concepts, recipe) to the datasets, the LLM adapter and
 * identity/clock ports, and translates their Result values into the small set
 * of shapes the UI needs. Every field on every response here is either copied
 * straight from an engine artifact or a plain-language message — nothing is
 * computed, scored or decided in this file or in the routes that call it.
 */

export type EngineDeps = {
  readonly datasets: DatasetRegistry;
  readonly llm: LlmPort;
  readonly ids: IdPort;
  readonly clock: ClockPort;
};

let cachedDatasets: DatasetRegistry | null = null;
let cachedLlm: LlmPort | null = null;

/** Real, process-wide dependencies for the API routes. Lazily built once. */
export function getEngineDeps(): EngineDeps {
  if (!cachedDatasets) {
    // Resolved from the process cwd (the project root under Next.js), not from
    // this module's own location — the loader's default import.meta.url
    // resolution is not reliable once this file is bundled by Next.js.
    cachedDatasets = loadDatasets({ root: join(process.cwd(), "data") });
  }
  if (!cachedLlm) {
    const ledger = createCostLedger({ clock: systemClock });
    cachedLlm = createGeminiLlm({
      apiKey: process.env["GEMINI_API_KEY"]?.trim() ?? "",
      clock: systemClock,
      ledger,
      maxAttempts: 2
    });
  }
  return { datasets: cachedDatasets, llm: cachedLlm, ids: randomIds, clock: systemClock };
}

function friendlyLlmMessage(issues: readonly LlmIssue[]): string {
  const codes = new Set(issues.map((issue) => issue.code));
  if (codes.has("not_configured")) {
    return "The AI design engine isn't connected yet. Add a Gemini API key to enable it.";
  }
  if (codes.has("rate_limited")) {
    return "The design engine is handling a lot of requests right now. Please try again in a moment.";
  }
  if (codes.has("timeout")) {
    return "That took longer than expected. Please try again.";
  }
  return "I had trouble reading that brief. Try describing it with a bit more detail.";
}

export type DirectionSummary = {
  readonly movement: string;
  readonly layout: string;
  readonly visual_tone: string;
  readonly composition: string;
  readonly typography: string;
  readonly hierarchy_strength: number;
  readonly whitespace: number;
  readonly contrast: number;
};

export type CountryInfluence = {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
};

export type BriefReadyResult = {
  readonly status: "READY";
  readonly brief: NormalizedBrief;
  readonly derived: readonly string[];
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly directionSummary: DirectionSummary;
  readonly countries: readonly CountryInfluence[];
  readonly concepts: ConceptGenerationOutcome;
};

export type BriefClarifyResult = {
  readonly status: "NEEDS_CLARIFICATION";
  readonly rawBrief: string;
  readonly questions: readonly ClarificationQuestion[];
};

export type BriefFailureResult = {
  readonly status: "INVALID" | "ERROR";
  readonly message: string;
  /** The text actually attempted (original, or original + appended answers), if any. */
  readonly rawBrief?: string;
};

export type BriefPipelineResult = BriefReadyResult | BriefClarifyResult | BriefFailureResult;

export type BriefPipelineInput = {
  readonly rawBrief: string;
  /** Answers to a previous round of clarification questions, in order asked. */
  readonly answers?: Record<string, string>;
};

/**
 * Brief -> contract -> direction -> concepts, in one call.
 *
 * Stops and reports at the first stage that isn't READY / doesn't succeed.
 * `deps` is injected so tests can run this with a fake LLM and fixture
 * datasets, with no network and no Next.js runtime involved.
 */
export async function runBriefPipeline(
  deps: EngineDeps,
  input: BriefPipelineInput
): Promise<BriefPipelineResult> {
  const trimmed = input.rawBrief.trim();
  if (trimmed.length === 0) {
    return { status: "ERROR", message: "Please describe what you'd like designed." };
  }

  const finalRawBrief = input.answers
    ? appendClarificationAnswers(trimmed, input.answers)
    : trimmed;
  const projectId = deps.ids.next("project");

  const briefing = await progressiveBriefing({
    rawBrief: finalRawBrief,
    projectId,
    datasets: deps.datasets,
    llm: deps.llm,
    ids: deps.ids
  });

  if (!briefing.ok) {
    return { status: "ERROR", message: friendlyLlmMessage(briefing.error), rawBrief: finalRawBrief };
  }

  const outcome = briefing.value;

  if (outcome.readiness.status === "INVALID") {
    return {
      status: "INVALID",
      message:
        "This brief has a detail that contradicts itself, so I can't safely design from it yet. Try clarifying the conflicting part and describe it again.",
      rawBrief: finalRawBrief
    };
  }

  if (outcome.readiness.status === "NEEDS_CLARIFICATION" || !outcome.brief) {
    // Some missing fields (e.g. industry) are inferred silently rather than
    // asked about, so it is possible for the policy to report "not ready" with
    // no question attached to any of them. There is nothing for a clarify form
    // to show in that case — ask for more detail in the brief itself instead.
    if (outcome.readiness.questions.length === 0) {
      return {
        status: "ERROR",
        message:
          "I still need a bit more detail — try mentioning what's being designed (the business, product or event) along with the audience and platform.",
        rawBrief: finalRawBrief
      };
    }
    return {
      status: "NEEDS_CLARIFICATION",
      rawBrief: finalRawBrief,
      questions: outcome.readiness.questions
    };
  }

  const contractResult = buildDesignContract({
    projectId,
    brief: outcome.brief,
    brand: null,
    datasets: deps.datasets,
    clock: deps.clock,
    ids: deps.ids
  });
  if (!contractResult.ok) {
    return {
      status: "ERROR",
      message:
        "This brief couldn't be turned into a design contract. Try naming the industry or platform a little more clearly.",
      rawBrief: finalRawBrief
    };
  }

  const directionResult = buildDesignDirection({
    projectId,
    contract: contractResult.value,
    datasets: deps.datasets,
    clock: deps.clock,
    ids: deps.ids
  });
  if (!directionResult.ok) {
    return {
      status: "ERROR",
      message:
        "No design direction could be resolved for this brief. Try a different industry, platform or country.",
      rawBrief: finalRawBrief
    };
  }

  const conceptsResult = await generateConcepts({
    projectId,
    contract: contractResult.value,
    direction: directionResult.value,
    datasets: deps.datasets,
    llm: deps.llm,
    ids: deps.ids,
    clock: deps.clock
  });
  if (!conceptsResult.ok) {
    return {
      status: "ERROR",
      message: "The creative engine couldn't produce concepts this time. Please try again.",
      rawBrief: finalRawBrief
    };
  }

  const chosen = selectedCandidate(directionResult.value).candidate;

  const countries: CountryInfluence[] = Object.entries(contractResult.value.country)
    .map(([id, weight]) => ({ id, name: deps.datasets.countries.get(id)?.name ?? id, weight }))
    .sort((a, b) => b.weight - a.weight);

  return {
    status: "READY",
    brief: outcome.brief,
    derived: outcome.derived,
    contract: contractResult.value,
    direction: directionResult.value,
    directionSummary: {
      movement: chosen.movement_name,
      layout: chosen.layout_name,
      visual_tone: chosen.color_strategy,
      composition: chosen.composition_strategy,
      typography: chosen.typography_strategy,
      hierarchy_strength: directionResult.value.dkv_targets.hierarchy_strength,
      whitespace: directionResult.value.dkv_targets.whitespace,
      contrast: directionResult.value.dkv_targets.contrast
    },
    countries,
    concepts: conceptsResult.value
  };
}

export type RecipePipelineInput = {
  readonly contract: unknown;
  readonly direction: unknown;
  readonly concept: unknown;
  /** Language for the compiled prompt set. Defaults to English. */
  readonly promptLanguage?: PromptLanguage;
  /**
   * Optional P4.1 visual evidence — a structured description of a rendered
   * candidate image. When present and its `recipe_hash` matches, the Visual
   * Review report's visual-quality and technical-quality dimensions are
   * assessed; otherwise they are reported `unassessed`. Never required.
   */
  readonly visualEvidence?: unknown;
};

export type RecipeOkResult = {
  readonly status: "OK";
  readonly recipe: DesignRecipe;
  readonly promptSet: PromptSet;
  /**
   * The P4.0 Design Critic verdict on this finished design. Deterministic,
   * read-only, no model — additive diagnostics only. It never blocks the
   * pipeline; a `BLOCK` verdict is advice for the reviewer, not an error.
   */
  readonly critic: DesignCriticReport;
  /**
   * The P4.1 Visual Review — the P4.0 report mapped into the twelve-category
   * model plus visual/technical dimensions that stay `unassessed` until a
   * `VisualEvidence` fixture is supplied. Also deterministic and read-only.
   */
  readonly review: VisualReviewReport;
  /**
   * The P2.10 Layout Blueprint — a derived, deterministic, content-hashed
   * structural plan (canvas, grid, zones, geometry, hierarchy, reading flow,
   * focal area, relationships, rationale). Bound to this recipe by
   * `blueprint.derived_from.recipe_hash`. Read-only; it never alters the recipe,
   * critic or review, and it is computed after them.
   */
  readonly blueprint: LayoutBlueprint;
  /**
   * P2.10 additive — the nine visual layout templates with per-template
   * availability for this design's visual type, and which one presents the
   * layout the recipe currently holds. Purely presentational; changing the
   * template re-derives the design through /api/layout.
   */
  readonly layoutTemplates: LayoutTemplateOverview;
  /**
   * P2.10 additive — the nine user-facing visual directions, the AI's
   * recommended one (read from the resolved recipe's generation adapter) and a
   * short rationale. Purely presentational; changing it re-derives the design
   * through /api/direction.
   */
  readonly visualDirections: VisualDirectionOverview;
};
export type RecipeFailureResult = { readonly status: "ERROR"; readonly message: string };
export type RecipePipelineResult = RecipeOkResult | RecipeFailureResult;

/**
 * Concept selection -> design recipe -> compiled prompt set.
 *
 * The contract, direction and concept round-trip through the client between
 * calls (there is no database), so they arrive here as `unknown` and are
 * re-validated against the same schemas the engine produced them with before
 * a single engine function sees them. The prompt compiler that follows the
 * recipe makes no further design decisions — it only translates the recipe
 * (and the same concept) into natural-language instructions.
 */
export function runRecipePipeline(
  deps: Pick<EngineDeps, "datasets" | "ids" | "clock">,
  input: RecipePipelineInput
): RecipePipelineResult {
  const contractParsed = DesignContractSchema.safeParse(input.contract);
  const directionParsed = DesignDirectionSchema.safeParse(input.direction);
  const conceptParsed = CreativeConceptSchema.safeParse(input.concept);

  if (!contractParsed.success || !directionParsed.success || !conceptParsed.success) {
    return { status: "ERROR", message: "That selection couldn't be read. Please start a new brief." };
  }

  const recipeResult = buildDesignRecipe({
    projectId: contractParsed.data.project_id,
    contract: contractParsed.data,
    direction: directionParsed.data,
    datasets: deps.datasets,
    clock: deps.clock,
    ids: deps.ids,
    concept: conceptParsed.data
  });

  if (!recipeResult.ok) {
    return {
      status: "ERROR",
      message: "The design recipe couldn't be assembled for this concept. Please try another one."
    };
  }

  const language = input.promptLanguage ?? "en";
  const promptSet = compilePromptSet({
    recipe: recipeResult.value,
    concept: conceptParsed.data,
    language
  });

  const auditInput = {
    contract: contractParsed.data,
    direction: directionParsed.data,
    recipe: recipeResult.value,
    promptSet,
    promptLanguage: language,
    concept: conceptParsed.data
  };
  const critic = auditDesign(auditInput);

  // P4.1 — parse visual evidence if supplied; a parse failure is not an error,
  // the review simply runs with the two renderable dimensions unassessed.
  const evidenceParsed =
    input.visualEvidence == null ? null : VisualEvidenceSchema.safeParse(input.visualEvidence);
  const review = reviewDesign({
    ...auditInput,
    visualEvidence: evidenceParsed && evidenceParsed.success ? evidenceParsed.data : null
  });

  // P2.10 — the Layout Blueprint, resolved AFTER the critic and the review from
  // the same finished recipe. It never recomputes or mutates the recipe. A P0
  // resolver failure means the recipe / contract / direction are structurally
  // inconsistent; surface it through the existing ERROR result rather than
  // returning a design that cannot be laid out.
  const blueprintResult = resolveLayoutBlueprint({
    recipe: recipeResult.value,
    contract: contractParsed.data,
    direction: directionParsed.data,
    datasets: deps.datasets
  });
  if (!blueprintResult.ok) {
    return {
      status: "ERROR",
      message: `The layout blueprint couldn't be resolved for this design (${blueprintResult.error
        .map((issue) => issue.code)
        .join(", ")}).`
    };
  }

  return {
    status: "OK",
    recipe: recipeResult.value,
    promptSet,
    critic,
    review,
    blueprint: blueprintResult.value,
    layoutTemplates: layoutTemplateOverview(
      deps.datasets,
      contractParsed.data.visual_type.id,
      blueprintResult.value.provenance.layout_id
    ),
    visualDirections: visualDirectionOverview(deps.datasets, recipeResult.value, conceptParsed.data)
  };
}

// --- P6: correction engine ---------------------------------------------

export type CorrectionPipelineInput = {
  /** The recipe being corrected (round-trips from the client). */
  readonly parentRecipe: unknown;
  readonly contract: unknown;
  readonly direction: unknown;
  readonly concept?: unknown;
  readonly patch: unknown;
  readonly promptLanguage?: PromptLanguage;
};

export type CorrectionAdjustmentResult = {
  readonly status: "OK";
  readonly outcome: "adjustment";
  readonly correction: CorrectionReport;
  /** The derived recipe + the contract / direction it was built from. Carry all three forward. */
  readonly recipe: DesignRecipe;
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly promptSet: PromptSet;
  readonly critic: DesignCriticReport;
  /**
   * A FRESH P2.10 Layout Blueprint resolved from the derived recipe — never the
   * parent's. Bound to the corrected recipe by `blueprint.derived_from.recipe_hash`.
   */
  readonly blueprint: LayoutBlueprint;
};
export type CorrectionRejectedResult = {
  readonly status: "REDESIGN" | "NOOP";
  readonly correction: CorrectionReport;
};
export type CorrectionFailureResult = { readonly status: "ERROR"; readonly message: string };
export type CorrectionPipelineResult =
  | CorrectionAdjustmentResult
  | CorrectionRejectedResult
  | CorrectionFailureResult;

/**
 * Apply a bounded structured correction to a finished recipe (P6).
 *
 * Deterministic and read-only with respect to the parent — a new derived
 * recipe is produced (`derived_from = parent.id`), never a mutation. On an
 * accepted `adjustment` the derived recipe is re-compiled, re-guarded (P3.0)
 * and re-audited (P4.0). A `redesign` or `noop` produces no recipe.
 */
export function runCorrectionPipeline(
  deps: Pick<EngineDeps, "datasets" | "ids" | "clock">,
  input: CorrectionPipelineInput
): CorrectionPipelineResult {
  const parentParsed = DesignRecipeSchema.safeParse(input.parentRecipe);
  const contractParsed = DesignContractSchema.safeParse(input.contract);
  const directionParsed = DesignDirectionSchema.safeParse(input.direction);
  const patchParsed = CorrectionPatchSchema.safeParse(input.patch);
  const conceptParsed =
    input.concept == null ? null : CreativeConceptSchema.safeParse(input.concept);

  if (
    !parentParsed.success ||
    !contractParsed.success ||
    !directionParsed.success ||
    !patchParsed.success ||
    (conceptParsed && !conceptParsed.success)
  ) {
    return { status: "ERROR", message: "That correction couldn't be read. Please start again from the recipe." };
  }

  const applied = applyCorrection({
    parentRecipe: parentParsed.data,
    contract: contractParsed.data,
    direction: directionParsed.data,
    patch: patchParsed.data,
    datasets: deps.datasets,
    ids: deps.ids,
    clock: deps.clock,
    concept: conceptParsed ? conceptParsed.data : null
  });

  if (!applied.ok) {
    return { status: "ERROR", message: "This correction couldn't be applied to that recipe." };
  }

  const { report, recipe, contract, direction } = applied.value;

  if (report.outcome !== "adjustment" || !recipe || !contract || !direction) {
    return { status: report.outcome === "redesign" ? "REDESIGN" : "NOOP", correction: report };
  }

  const language = input.promptLanguage ?? "en";
  const promptSet = compilePromptSet({
    recipe,
    concept: conceptParsed ? conceptParsed.data : null,
    language
  });
  const critic = auditDesign({
    contract,
    direction,
    recipe,
    promptSet,
    promptLanguage: language,
    concept: conceptParsed ? conceptParsed.data : null
  });

  // P2.10 — a fresh blueprint from the DERIVED recipe (never the parent). Its
  // `derived_from.recipe_hash` therefore tracks the corrected recipe's hash.
  const blueprintResult = resolveLayoutBlueprint({ recipe, contract, direction, datasets: deps.datasets });
  if (!blueprintResult.ok) {
    return {
      status: "ERROR",
      message: `The layout blueprint couldn't be resolved for the corrected design (${blueprintResult.error
        .map((issue) => issue.code)
        .join(", ")}).`
    };
  }

  return {
    status: "OK",
    outcome: "adjustment",
    correction: report,
    recipe,
    contract,
    direction,
    promptSet,
    critic,
    blueprint: blueprintResult.value
  };
}

// --- P2.10 additive: layout template retarget -------------------------

export type LayoutRetargetInput = {
  /** The design being retargeted (all round-trip from the client). */
  readonly contract: unknown;
  readonly direction: unknown;
  readonly concept?: unknown;
  readonly parentRecipe: unknown;
  /** Canonical layout id chosen by the designer. */
  readonly layoutId: unknown;
  readonly promptLanguage?: PromptLanguage;
};

export type LayoutRetargetOkResult = {
  readonly status: "OK";
  /** The re-derived recipe — a new `recipe_hash`. The parent stays immutable. */
  readonly recipe: DesignRecipe;
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly promptSet: PromptSet;
  /** Deterministic Design Critic re-run on the new recipe (no model, no cost). */
  readonly critic: DesignCriticReport;
  /** A fresh Layout Blueprint from the new recipe — a new `blueprint_hash`. */
  readonly blueprint: LayoutBlueprint;
  /** The template picture for the retargeted design (recommendation now points at the chosen layout). */
  readonly layoutTemplates: LayoutTemplateOverview;
};
export type LayoutRetargetResult = LayoutRetargetOkResult | RecipeFailureResult;

/**
 * Re-derive a design onto a different canonical layout (P2.10 additive).
 *
 * Composes the existing engine primitives exactly like `runCorrectionPipeline`:
 * `retargetLayout` (pins movement + layout, rebuilds direction + recipe) →
 * prompt compile → deterministic critic → fresh blueprint. It never calls the
 * generation provider, the vision loop, the correction engine or an approval —
 * it only changes design structure.
 */
export function runLayoutRetargetPipeline(
  deps: Pick<EngineDeps, "datasets" | "ids" | "clock">,
  input: LayoutRetargetInput
): LayoutRetargetResult {
  const contractParsed = DesignContractSchema.safeParse(input.contract);
  const directionParsed = DesignDirectionSchema.safeParse(input.direction);
  const parentParsed = DesignRecipeSchema.safeParse(input.parentRecipe);
  const conceptParsed = input.concept == null ? null : CreativeConceptSchema.safeParse(input.concept);

  if (
    !contractParsed.success ||
    !directionParsed.success ||
    !parentParsed.success ||
    (conceptParsed && !conceptParsed.success)
  ) {
    return { status: "ERROR", message: "That design couldn't be read. Please rebuild the recipe and try again." };
  }
  if (typeof input.layoutId !== "string" || input.layoutId.length === 0) {
    return { status: "ERROR", message: "No layout was selected." };
  }

  const retargeted = retargetLayout({
    contract: contractParsed.data,
    direction: directionParsed.data,
    concept: conceptParsed ? conceptParsed.data : null,
    parentRecipe: parentParsed.data,
    layoutId: input.layoutId,
    datasets: deps.datasets,
    ids: deps.ids,
    clock: deps.clock
  });
  if (!retargeted.ok) {
    return {
      status: "ERROR",
      message: `That layout couldn't be applied to this design (${retargeted.error.map((issue) => issue.code).join(", ")}).`
    };
  }

  const { contract, direction, recipe } = retargeted.value;
  const language = input.promptLanguage ?? "en";
  const promptSet = compilePromptSet({
    recipe,
    concept: conceptParsed ? conceptParsed.data : null,
    language
  });
  const critic = auditDesign({
    contract,
    direction,
    recipe,
    promptSet,
    promptLanguage: language,
    concept: conceptParsed ? conceptParsed.data : null
  });

  const blueprintResult = resolveLayoutBlueprint({ recipe, contract, direction, datasets: deps.datasets });
  if (!blueprintResult.ok) {
    return {
      status: "ERROR",
      message: `The layout blueprint couldn't be resolved for this layout (${blueprintResult.error
        .map((issue) => issue.code)
        .join(", ")}).`
    };
  }

  return {
    status: "OK",
    recipe,
    contract,
    direction,
    promptSet,
    critic,
    blueprint: blueprintResult.value,
    layoutTemplates: layoutTemplateOverview(
      deps.datasets,
      contract.visual_type.id,
      blueprintResult.value.provenance.layout_id
    )
  };
}

// --- P2.10 additive: visual direction retarget ------------------------

export type DirectionRetargetInput = {
  readonly contract: unknown;
  readonly direction: unknown;
  readonly concept?: unknown;
  readonly parentRecipe: unknown;
  /** Visual direction id chosen by the designer. */
  readonly directionId: unknown;
  readonly promptLanguage?: PromptLanguage;
};

export type DirectionRetargetOkResult = {
  readonly status: "OK";
  readonly recipe: DesignRecipe;
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly promptSet: PromptSet;
  readonly critic: DesignCriticReport;
  readonly blueprint: LayoutBlueprint;
  readonly layoutTemplates: LayoutTemplateOverview;
  readonly visualDirections: VisualDirectionOverview;
};
export type DirectionRetargetResult = DirectionRetargetOkResult | RecipeFailureResult;

/**
 * Re-derive a design onto a different visual direction (P2.10 additive).
 *
 * Composes existing engine primitives exactly like `runLayoutRetargetPipeline`:
 * `retargetDirection` (re-runs the recipe with the direction's bias overrides)
 * → prompt compile → deterministic critic → fresh blueprint. It never calls the
 * generation provider, the vision loop, the correction engine or an approval.
 * The contract, direction, movement, concept, layout and core message are
 * unchanged — only how the design is expressed.
 */
export function runDirectionRetargetPipeline(
  deps: Pick<EngineDeps, "datasets" | "ids" | "clock">,
  input: DirectionRetargetInput
): DirectionRetargetResult {
  const contractParsed = DesignContractSchema.safeParse(input.contract);
  const directionParsed = DesignDirectionSchema.safeParse(input.direction);
  const parentParsed = DesignRecipeSchema.safeParse(input.parentRecipe);
  const conceptParsed = input.concept == null ? null : CreativeConceptSchema.safeParse(input.concept);

  if (
    !contractParsed.success ||
    !directionParsed.success ||
    !parentParsed.success ||
    (conceptParsed && !conceptParsed.success)
  ) {
    return { status: "ERROR", message: "That design couldn't be read. Please rebuild the recipe and try again." };
  }
  if (typeof input.directionId !== "string" || input.directionId.length === 0) {
    return { status: "ERROR", message: "No visual direction was selected." };
  }

  const concept = conceptParsed ? conceptParsed.data : null;
  const retargeted = retargetDirection({
    contract: contractParsed.data,
    direction: directionParsed.data,
    concept,
    parentRecipe: parentParsed.data,
    directionId: input.directionId,
    datasets: deps.datasets,
    ids: deps.ids,
    clock: deps.clock
  });
  if (!retargeted.ok) {
    return {
      status: "ERROR",
      message: `That visual direction couldn't be applied (${retargeted.error.map((issue) => issue.code).join(", ")}).`
    };
  }

  const recipe = retargeted.value.recipe;
  const contract = contractParsed.data;
  const direction = directionParsed.data;
  const language = input.promptLanguage ?? "en";
  const promptSet = compilePromptSet({ recipe, concept, language });
  const critic = auditDesign({
    contract,
    direction,
    recipe,
    promptSet,
    promptLanguage: language,
    concept
  });

  const blueprintResult = resolveLayoutBlueprint({ recipe, contract, direction, datasets: deps.datasets });
  if (!blueprintResult.ok) {
    return {
      status: "ERROR",
      message: `The layout blueprint couldn't be resolved for this direction (${blueprintResult.error
        .map((issue) => issue.code)
        .join(", ")}).`
    };
  }

  return {
    status: "OK",
    recipe,
    contract,
    direction,
    promptSet,
    critic,
    blueprint: blueprintResult.value,
    layoutTemplates: layoutTemplateOverview(
      deps.datasets,
      contract.visual_type.id,
      blueprintResult.value.provenance.layout_id
    ),
    visualDirections: visualDirectionOverview(deps.datasets, recipe, concept)
  };
}
