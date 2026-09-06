import { z } from "zod";
import { DatasetVersion, Id, IsoDate, NonEmptyText, Note, Ratio, SemVer } from "../primitives";
import { CorrectionField } from "./correction.schema";
import { CritiqueDimension } from "./design-critique.schema";

/**
 * Correction Recommendation — P2.16.
 *
 * Transforms a `DesignCritique` into bounded corrective OPTIONS. It is NOT
 * autonomous correction: it proposes, the human decides, and only then does an
 * approved option become an ordinary P6 `CorrectionAdjustment`.
 *
 * Every actionable option answers:
 *   1. What is wrong?               → `problem`
 *   2. What upstream signal?        → `affected_signal`
 *   3. What is the smallest change? → `scope`
 *   4. What exact parameter?        → `parameter_path` / `correction_field`
 *   5. What stays unchanged?        → `preserve`
 *   6. Why is it allowed?           → `rationale` + `bounds`
 *
 * Rules:
 *   - Deterministic. Same critique ⇒ byte-identical recommendation.
 *   - `correction_field` is ALWAYS an existing `CorrectionField` — no new
 *     mutation parameter is introduced for this milestone.
 *   - `|delta|` is always within the field's ceiling (`engine/correction/policy`).
 *   - It applies nothing. `toCorrectionPatch` builds a patch only from options
 *     the caller explicitly selects.
 */

export const RecommendationScope = z.enum([
  "single_parameter",
  "regenerate_only",
  "not_actionable"
]);
export type RecommendationScope = z.infer<typeof RecommendationScope>;

export const CorrectionOptionBounds = z
  .object({
    max_abs_delta: z.number().positive(),
    field_min: z.number(),
    field_max: z.number(),
    held_by: NonEmptyText.nullable().default(null)
  })
  .strict();
export type CorrectionOptionBounds = z.infer<typeof CorrectionOptionBounds>;

export const CorrectionOption = z
  .object({
    /** Stable slug, e.g. "focal-alignment-focal-dominance". */
    code: NonEmptyText,
    /** The critique finding this responds to. */
    critique_ref: NonEmptyText,
    /** The evidence field / region the finding was drawn from. */
    evidence_ref: NonEmptyText,
    dimension: CritiqueDimension,

    problem: Note,
    affected_signal: NonEmptyText,

    scope: RecommendationScope,
    /** The recipe path that would change, e.g. "dkv.focal_dominance". Null for non-parameter scopes. */
    parameter_path: NonEmptyText.nullable(),
    /** The exact P6 correction field. Null for non-parameter scopes. */
    correction_field: CorrectionField.nullable(),
    current_value: z.number().nullable(),
    proposed_value: z.number().nullable(),
    delta: z.number().nullable(),
    bounds: CorrectionOptionBounds.nullable(),

    /** What a bounded correction leaves untouched — echoed from the recommendation. */
    preserve: z.array(NonEmptyText),
    rationale: Note,
    confidence: Ratio
  })
  .strict()
  .superRefine((option, ctx) => {
    if (option.scope === "single_parameter") {
      if (option.correction_field === null || option.parameter_path === null || option.bounds === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a single_parameter option must name a field, path and bounds" });
      }
      if (option.proposed_value === null || option.current_value === null || option.delta === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a single_parameter option must carry current / proposed / delta" });
      }
      if (option.delta !== null && option.bounds && Math.abs(option.delta) > option.bounds.max_abs_delta + 1e-9) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "delta exceeds the field ceiling" });
      }
    }
    if (option.scope !== "single_parameter" && option.correction_field !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "only a single_parameter option may name a correction field" });
    }
  });
export type CorrectionOption = z.infer<typeof CorrectionOption>;

export const RecommendationProvenance = z
  .object({
    critique_id: Id,
    critique_hash: z.string().length(8),
    evidence_hash: z.string().length(8),
    artifact_hash: z.string().length(8),
    contract_id: Id,
    recipe_id: Id,
    recipe_hash: z.string().length(8),
    blueprint_hash: z.string().length(8).nullable(),
    prompt_hash: z.string().length(8),
    generation_request_hash: z.string().length(8)
  })
  .strict();
export type RecommendationProvenance = z.infer<typeof RecommendationProvenance>;

export const UnactionableFinding = z
  .object({
    critique_ref: NonEmptyText,
    dimension: CritiqueDimension,
    reason: Note
  })
  .strict();
export type UnactionableFinding = z.infer<typeof UnactionableFinding>;

export const CorrectionRecommendation = z
  .object({
    schema_version: SemVer,
    resolver_version: SemVer,
    dataset_version: DatasetVersion,
    recommendation_id: Id,
    created_at: IsoDate,

    provenance: RecommendationProvenance,

    /** Bounded options, most useful first. Empty when the critique found no mismatch. */
    options: z.array(CorrectionOption),
    /** The global invariants every option preserves. */
    preserved: z.array(NonEmptyText),
    /** Findings that have no bounded corrective option (and why). */
    unactionable: z.array(UnactionableFinding),

    note: Note,

    /** fnv1a(canonicalise(body without recommendation_id / created_at / recommendation_hash)). */
    recommendation_hash: z.string().length(8)
  })
  .strict();
export type CorrectionRecommendation = z.infer<typeof CorrectionRecommendation>;
