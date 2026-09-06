import type { DesignContract } from "../../types/schemas/contract.schema";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { LayoutBlueprint } from "../../types/schemas/layout-blueprint.schema";
import type { VisualEvidenceReport } from "../../types/schemas/visual-evidence-report.schema";
import type { CritiqueFinding, DesignCritique } from "../../types/schemas/design-critique.schema";
import type { CorrectionPatch } from "../../types/schemas/correction.schema";
import type {
  CorrectionOption,
  CorrectionRecommendation,
  UnactionableFinding
} from "../../types/schemas/correction-recommendation.schema";
import { CorrectionRecommendation as CorrectionRecommendationSchema } from "../../types/schemas/correction-recommendation.schema";
import { SCHEMA_VERSIONS } from "../../types/versions";
import { canonicalise, fnv1a } from "../../types/primitives";
import { deepFreeze } from "../../domain/contract";
import { round } from "../dkv/params";
import { err, ok, type Result } from "../util/result";
import type { DirectionIssue } from "../../domain/errors";
import { directionIssue } from "../../domain/errors";
import {
  boundedProposal,
  currentValueFor,
  fieldRangeFor,
  parameterPathFor,
  type RecommendableField
} from "./policy";

/**
 * Correction Recommendation (P2.16).
 *
 * `recipe + blueprint + contract + evidence + critique → CorrectionRecommendation`.
 *
 * Pure and deterministic. It maps each critique mismatch to the smallest safe
 * change expressed through a parameter the P6 Correction Engine already
 * supports — or, when no such lever exists, to a `regenerate_only` /
 * `not_actionable` option. It NEVER applies anything: `toCorrectionPatch`
 * builds a patch only from options the caller explicitly selects.
 */

export const RECOMMENDATION_RESOLVER_VERSION = "1.0.0";

/** What a bounded correction always leaves untouched. */
export const PRESERVED_INVARIANTS = [
  "concept",
  "brand",
  "design movement",
  "layout grammar (grid, zones, reading flow)",
  "visual type",
  "platform / format",
  "objective",
  "core message"
] as const;

export type RecommendCorrectionsInput = {
  readonly recipe: DesignRecipe;
  readonly contract: DesignContract;
  readonly blueprint: LayoutBlueprint | null;
  readonly evidence: VisualEvidenceReport;
  readonly critique: DesignCritique;
};

/** dimension → (field, direction-toward-intent). `null` ⇒ not a single-parameter fix. */
type ParamMap = {
  field: RecommendableField;
  /** How to pick the direction: "close-gap" uses sign(intended − observed); "increase" is fixed. */
  mode: "close-gap" | "increase";
};

const DIMENSION_PARAM: Partial<Record<CritiqueFinding["dimension"], ParamMap>> = {
  focal_alignment: { field: "focal_dominance", mode: "increase" },
  subject_placement: { field: "focal_dominance", mode: "increase" },
  whitespace_alignment: { field: "whitespace", mode: "close-gap" },
  density_alignment: { field: "visual_density", mode: "close-gap" },
  composition_alignment: { field: "hierarchy_strength", mode: "increase" },
  color_relationship: { field: "color_complexity", mode: "close-gap" }
};

const REGENERATE_ONLY = new Set<CritiqueFinding["dimension"]>([
  "aspect_ratio",
  "platform_format",
  "text_region_alignment",
  "safe_area_alignment"
]);

function magnitudeFor(finding: CritiqueFinding): number {
  return finding.classification === "major_mismatch" ? 0.12 : 0.06;
}

/** Parse a numeric leading token out of an intended/observed value string, or null. */
function num(value: string): number | null {
  const match = value.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function regenerateReason(dimension: CritiqueFinding["dimension"]): string {
  switch (dimension) {
    case "aspect_ratio":
      return "Aspect ratio is a generation-target parameter, not a recipe value. Regenerate with the target ratio set explicitly — no recipe change is needed or allowed.";
    case "platform_format":
      return "Crop / fill behaviour is provider-side. Regenerate; if it recurs, the provider ratio parameter is the lever, not the recipe.";
    case "text_region_alignment":
      return "Rendered-text placement is fixed by regenerating with the 'leave text zones clean' instruction — typography is applied in a later pass. A DKV correction would not change it.";
    case "safe_area_alignment":
      return "Edge / safe-area behaviour is resolved by regenerating; the layout grammar itself is an anchor and a correction never rewrites it.";
    default:
      return "This mismatch has no bounded recipe-parameter lever; regenerate and re-inspect.";
  }
}

export function recommendCorrections(
  input: RecommendCorrectionsInput
): Result<CorrectionRecommendation, DirectionIssue[]> {
  const { recipe, contract, blueprint, evidence, critique } = input;

  // --- provenance / staleness gate --------------------------------
  if (critique.provenance.recipe_hash !== recipe.recipe_hash) {
    return err([
      directionIssue(
        "recipe_invalid",
        "critique.provenance.recipe_hash",
        `the critique was made against recipe ${critique.provenance.recipe_hash}, not this one (${recipe.recipe_hash})`
      )
    ]);
  }
  if (critique.provenance.evidence_hash !== evidence.evidence_hash) {
    return err([
      directionIssue(
        "recipe_invalid",
        "critique.provenance.evidence_hash",
        `the critique cites evidence ${critique.provenance.evidence_hash}, not the supplied one (${evidence.evidence_hash})`
      )
    ]);
  }

  const options: CorrectionOption[] = [];
  const unactionable: UnactionableFinding[] = [];

  const mismatches = critique.findings.filter(
    (f) => f.classification === "minor_mismatch" || f.classification === "major_mismatch"
  );

  for (const finding of mismatches) {
    if (REGENERATE_ONLY.has(finding.dimension)) {
      options.push({
        code: `${finding.code}-regenerate`,
        critique_ref: finding.code,
        evidence_ref: finding.observed.evidence_ref,
        dimension: finding.dimension,
        problem: finding.title,
        affected_signal: finding.intended.signal,
        scope: "regenerate_only",
        parameter_path: null,
        correction_field: null,
        current_value: null,
        proposed_value: null,
        delta: null,
        bounds: null,
        preserve: [...PRESERVED_INVARIANTS],
        rationale: regenerateReason(finding.dimension),
        confidence: finding.confidence
      });
      continue;
    }

    const map = DIMENSION_PARAM[finding.dimension];
    if (!map) {
      unactionable.push({
        critique_ref: finding.code,
        dimension: finding.dimension,
        reason: "No bounded recipe-parameter lever maps to this dimension."
      });
      continue;
    }

    // Prefer the finding's own affected parameter when it names one we can use.
    const field: RecommendableField =
      finding.affected.parameter === "contrast" && finding.dimension === "color_relationship"
        ? "contrast"
        : map.field;

    let direction: "increase" | "decrease" = "increase";
    if (map.mode === "close-gap") {
      const intended = num(finding.intended.value);
      const observed = num(finding.observed.value);
      if (intended !== null && observed !== null) {
        direction = intended >= observed ? "increase" : "decrease";
      }
    }

    const proposal = boundedProposal(recipe, field, direction, magnitudeFor(finding));

    if (proposal.exhausted) {
      unactionable.push({
        critique_ref: finding.code,
        dimension: finding.dimension,
        reason: `No bounded room to move ${field}: it is already at ${round(currentValueFor(recipe, field))} and ${
          proposal.heldBy ?? "the field limit"
        } holds it there.`
      });
      continue;
    }

    const range = fieldRangeFor(field);
    options.push({
      code: `${finding.code}-${field.replace(/_/g, "-")}`,
      critique_ref: finding.code,
      evidence_ref: finding.observed.evidence_ref,
      dimension: finding.dimension,
      problem: finding.title,
      affected_signal: finding.intended.signal,
      scope: "single_parameter",
      parameter_path: parameterPathFor(field),
      correction_field: field,
      current_value: proposal.current,
      proposed_value: proposal.proposed,
      delta: proposal.delta,
      bounds: {
        max_abs_delta: proposal.maxAbsDelta,
        field_min: range.min,
        field_max: range.max,
        held_by: proposal.heldBy
      },
      preserve: [...PRESERVED_INVARIANTS],
      rationale:
        `${finding.comparison} A single bounded ${direction} of ${field.replace(/_/g, " ")} ` +
        `(${proposal.current} → ${proposal.proposed}, Δ${proposal.delta >= 0 ? "+" : ""}${proposal.delta}) ` +
        `pushes the next render toward the intent through the P6 engine. Everything else is preserved.`,
      confidence: finding.confidence
    });
  }

  // deterministic order: single_parameter (by |delta| desc) then regenerate_only, then code
  const scopeRank = { single_parameter: 0, regenerate_only: 1, not_actionable: 2 } as const;
  options.sort(
    (a, b) =>
      scopeRank[a.scope] - scopeRank[b.scope] ||
      Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) ||
      a.code.localeCompare(b.code)
  );
  unactionable.sort((a, b) => a.critique_ref.localeCompare(b.critique_ref));

  const singleCount = options.filter((o) => o.scope === "single_parameter").length;
  const regenCount = options.filter((o) => o.scope === "regenerate_only").length;
  const note =
    options.length === 0 && unactionable.length === 0
      ? "The critique found no mismatch — no correction is recommended."
      : `${singleCount} bounded single-parameter option${singleCount === 1 ? "" : "s"}, ` +
        `${regenCount} regenerate-only option${regenCount === 1 ? "" : "s"}, ` +
        `${unactionable.length} finding${unactionable.length === 1 ? "" : "s"} with no bounded lever. ` +
        `Nothing is applied — a human selects the options to run.`;

  const body = {
    schema_version: SCHEMA_VERSIONS.correctionRecommendation,
    resolver_version: RECOMMENDATION_RESOLVER_VERSION,
    dataset_version: critique.dataset_version,
    provenance: {
      critique_id: critique.critique_id,
      critique_hash: critique.critique_hash,
      evidence_hash: evidence.evidence_hash,
      artifact_hash: critique.provenance.artifact_hash,
      contract_id: contract.id,
      recipe_id: recipe.id,
      recipe_hash: recipe.recipe_hash,
      blueprint_hash: blueprint ? blueprint.blueprint_hash : critique.provenance.blueprint_hash,
      prompt_hash: critique.provenance.prompt_hash,
      generation_request_hash: critique.provenance.generation_request_hash
    },
    options,
    preserved: [...PRESERVED_INVARIANTS],
    unactionable,
    note
  };

  const recommendation = {
    ...body,
    recommendation_id: `rec_${fnv1a(canonicalise(body))}`,
    created_at: critique.created_at,
    recommendation_hash: fnv1a(canonicalise(body))
  };

  const validated = CorrectionRecommendationSchema.safeParse(recommendation);
  if (!validated.success) {
    return err(
      validated.error.issues.map((problem) =>
        directionIssue("recipe_invalid", problem.path.join(".") || "(root)", problem.message)
      )
    );
  }
  return ok(deepFreeze(validated.data));
}

// --- explicit, human-gated conversion to a P6 patch --------------------

export type CorrectionPatchDraft = {
  readonly patch: CorrectionPatch | null;
  /** Option codes actually included. */
  readonly selected: readonly string[];
  /** Option codes asked for but not usable as a parameter change (regenerate-only / unknown). */
  readonly skipped: readonly string[];
};

/**
 * Build a P6 `CorrectionPatch` from the options the caller EXPLICITLY selects.
 * Nothing is selected by default; passing an empty list produces a null patch.
 * This does not apply the patch — the caller hands it to `runCorrectionPipeline`
 * as its own explicit step.
 */
export function toCorrectionPatch(
  recommendation: CorrectionRecommendation,
  selectedCodes: readonly string[]
): CorrectionPatchDraft {
  const wanted = new Set(selectedCodes);
  const selected: string[] = [];
  const skipped: string[] = [];
  const adjustments = [];

  for (const option of recommendation.options) {
    if (!wanted.has(option.code)) continue;
    if (option.scope === "single_parameter" && option.correction_field && option.proposed_value !== null) {
      adjustments.push({ field: option.correction_field, mode: "set" as const, amount: option.proposed_value });
      selected.push(option.code);
    } else {
      skipped.push(option.code);
    }
  }

  if (adjustments.length === 0) return { patch: null, selected, skipped };
  return {
    patch: {
      adjustments,
      note: `Applied from correction recommendation ${recommendation.recommendation_id} (${selected.length} option${selected.length === 1 ? "" : "s"}).`
    },
    selected,
    skipped
  };
}
