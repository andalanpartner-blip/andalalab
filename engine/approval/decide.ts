import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { LayoutBlueprint } from "../../types/schemas/layout-blueprint.schema";
import type {
  GeneratedArtifact,
  GenerationRequest
} from "../../types/schemas/visual-generation.schema";
import type { VisualEvidenceReport } from "../../types/schemas/visual-evidence-report.schema";
import type { DesignCritique } from "../../types/schemas/design-critique.schema";
import type { CorrectionRecommendation } from "../../types/schemas/correction-recommendation.schema";
import type { CorrectionCycle } from "../../types/schemas/correction-cycle.schema";
import type {
  CreativeDecision,
  DecisionAction,
  DecisionActor
} from "../../types/schemas/creative-decision.schema";
import { CreativeDecision as CreativeDecisionSchema } from "../../types/schemas/creative-decision.schema";
import { SCHEMA_VERSIONS } from "../../types/versions";
import { canonicalise, fnv1a } from "../../types/primitives";
import { deepFreeze } from "../../domain/contract";
import { err, ok, type Result } from "../util/result";
import type { DirectionIssue } from "../../domain/errors";
import { directionIssue } from "../../domain/errors";

/**
 * The Creative Decision builder (P2.18).
 *
 * Pure and deterministic. It records a human's explicit decision about ONE
 * exact generated visual and — for an `approved` decision especially — refuses
 * to record a decision about STALE content: the artifact's own provenance must
 * still match the current recipe / blueprint / prompt / generation request.
 *
 * It calls no model and no provider. Creating a `regenerate` or `approved`
 * decision never triggers generation — that stays a separate explicit action.
 * A `needs_correction` decision requires explicitly-selected options from an
 * existing `CorrectionRecommendation`; it selects nothing on the human's behalf
 * and introduces no new correction parameter.
 */

export const CREATIVE_DECISION_RESOLVER_VERSION = "1.0.0";

export type BuildCreativeDecisionInput = {
  readonly action: DecisionAction;
  readonly actor: DecisionActor;
  readonly note?: string | null;
  readonly projectId: string;
  readonly createdAt: string;

  readonly artifact: GeneratedArtifact;
  readonly recipe: DesignRecipe;
  readonly blueprint: LayoutBlueprint | null;
  readonly request: GenerationRequest;

  readonly evidence?: VisualEvidenceReport | null;
  readonly critique?: DesignCritique | null;
  readonly recommendation?: CorrectionRecommendation | null;
  readonly correctionCycle?: CorrectionCycle | null;

  /** For `needs_correction` — the option codes the human explicitly selected. */
  readonly selectedCorrectionOptions?: readonly string[];
};

function freshnessIssues(input: BuildCreativeDecisionInput): DirectionIssue[] {
  const { artifact, recipe, blueprint, request } = input;
  const issues: DirectionIssue[] = [];

  if (request.provenance.recipe_hash !== recipe.recipe_hash) {
    issues.push(
      directionIssue(
        "recipe_invalid",
        "request.provenance.recipe_hash",
        `the generation request is for recipe ${request.provenance.recipe_hash}, not the current one (${recipe.recipe_hash})`
      )
    );
  }
  if (artifact.provenance.recipe_hash !== recipe.recipe_hash) {
    issues.push(
      directionIssue(
        "recipe_invalid",
        "artifact.provenance.recipe_hash",
        `this visual was generated from recipe ${artifact.provenance.recipe_hash}, not the current one (${recipe.recipe_hash})`
      )
    );
  }
  if (
    blueprint &&
    artifact.provenance.blueprint_hash !== null &&
    artifact.provenance.blueprint_hash !== blueprint.blueprint_hash
  ) {
    issues.push(
      directionIssue(
        "recipe_invalid",
        "artifact.provenance.blueprint_hash",
        `this visual was generated from blueprint ${artifact.provenance.blueprint_hash}, not the current one (${blueprint.blueprint_hash})`
      )
    );
  }
  if (artifact.request_hash !== request.request_hash) {
    issues.push(
      directionIssue(
        "recipe_invalid",
        "artifact.request_hash",
        `this visual was generated from request ${artifact.request_hash}, not the current one (${request.request_hash})`
      )
    );
  }
  if (artifact.provenance.prompt_hash !== request.provenance.prompt_hash) {
    issues.push(
      directionIssue(
        "recipe_invalid",
        "artifact.provenance.prompt_hash",
        `this visual was generated from prompt ${artifact.provenance.prompt_hash}, not the current one (${request.provenance.prompt_hash})`
      )
    );
  }
  return issues;
}

export function buildCreativeDecision(
  input: BuildCreativeDecisionInput
): Result<CreativeDecision, DirectionIssue[]> {
  const selected = [...(input.selectedCorrectionOptions ?? [])];

  // --- freshness gate ---------------------------------------------------
  // An `approved` decision is the FINAL word on a visual — it must never be
  // recorded about stale content. `regenerate` and `needs_correction` are
  // decisions to CHANGE the visual, so a stale render is a valid (indeed
  // expected) subject; the correction path enforces its own recipe match.
  if (input.action === "approved") {
    const stale = freshnessIssues(input);
    if (stale.length > 0) return err(stale);
  }

  // --- action-specific validation ---------------------------------------
  if (input.action === "needs_correction") {
    if (!input.recommendation) {
      return err([
        directionIssue("recipe_invalid", "recommendation", "a correction decision requires a CorrectionRecommendation")
      ]);
    }
    if (input.recommendation.provenance.recipe_hash !== input.recipe.recipe_hash) {
      return err([
        directionIssue(
          "recipe_invalid",
          "recommendation.provenance.recipe_hash",
          `the recommendation is for recipe ${input.recommendation.provenance.recipe_hash}, not the current one (${input.recipe.recipe_hash})`
        )
      ]);
    }
    if (selected.length === 0) {
      return err([
        directionIssue("recipe_invalid", "selectedCorrectionOptions", "a correction decision requires at least one explicitly selected option")
      ]);
    }
    const byCode = new Map(input.recommendation.options.map((o) => [o.code, o]));
    for (const code of selected) {
      const option = byCode.get(code);
      if (!option) {
        return err([
          directionIssue("recipe_invalid", "selectedCorrectionOptions", `option "${code}" is not in this recommendation`)
        ]);
      }
      if (option.scope !== "single_parameter") {
        return err([
          directionIssue(
            "recipe_invalid",
            "selectedCorrectionOptions",
            `option "${code}" is ${option.scope}, not a bounded parameter correction — choose "regenerate" instead`
          )
        ]);
      }
    }
  } else if (selected.length > 0) {
    return err([
      directionIssue(
        "recipe_invalid",
        "selectedCorrectionOptions",
        `an ${input.action} decision must not carry selected correction options`
      )
    ]);
  }

  // --- assemble --------------------------------------------------------
  const body = {
    schema_version: SCHEMA_VERSIONS.creativeDecision,
    resolver_version: CREATIVE_DECISION_RESOLVER_VERSION,
    dataset_version: input.artifact.provenance.dataset_version,
    project_id: input.projectId,
    action: input.action,
    actor: input.actor,
    note: input.note && input.note.trim().length > 0 ? input.note.trim() : null,
    subject: {
      generated_artifact_id: input.artifact.artifact_id,
      artifact_hash: input.artifact.artifact_hash,
      recipe_id: input.recipe.id,
      recipe_hash: input.recipe.recipe_hash,
      blueprint_id: input.blueprint ? input.blueprint.derived_from.recipe_id : input.artifact.provenance.blueprint_id,
      blueprint_hash: input.blueprint ? input.blueprint.blueprint_hash : input.artifact.provenance.blueprint_hash,
      prompt_hash: input.artifact.provenance.prompt_hash,
      generation_request_hash: input.artifact.request_hash
    },
    context: {
      evidence_id: input.evidence?.evidence_id ?? null,
      evidence_hash: input.evidence?.evidence_hash ?? null,
      critique_id: input.critique?.critique_id ?? null,
      critique_hash: input.critique?.critique_hash ?? null,
      recommendation_id: input.recommendation?.recommendation_id ?? null,
      recommendation_hash: input.recommendation?.recommendation_hash ?? null,
      correction_cycle_id: input.correctionCycle?.cycle_id ?? null,
      correction_cycle_hash: input.correctionCycle?.cycle_hash ?? null
    },
    selected_correction_options: selected
  };

  const decision = {
    ...body,
    decision_id: `decision_${fnv1a(canonicalise(body))}`,
    created_at: input.createdAt,
    decision_hash: fnv1a(canonicalise(body))
  };

  const validated = CreativeDecisionSchema.safeParse(decision);
  if (!validated.success) {
    return err(
      validated.error.issues.map((problem) =>
        directionIssue("recipe_invalid", problem.path.join(".") || "(root)", problem.message)
      )
    );
  }
  return ok(deepFreeze(validated.data));
}

/** Whether an approved decision is CURRENT for a given artifact (unlocks Final). */
export function decisionApprovesArtifact(
  decision: CreativeDecision | null,
  artifact: GeneratedArtifact | null
): boolean {
  return (
    decision !== null &&
    artifact !== null &&
    decision.action === "approved" &&
    decision.subject.artifact_hash === artifact.artifact_hash &&
    decision.subject.recipe_hash === artifact.provenance.recipe_hash
  );
}
