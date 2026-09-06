import { z } from "zod";
import { Id, NonEmptyText, Note } from "../primitives";
import { DesignCriticReport } from "./design-critic.schema";
import { ReviewCategory, ReviewSeverity } from "./visual-evidence.schema";

/**
 * Visual Review — P4.1.
 *
 * The image-measuring half of the Design Critic named in ADR 0009. It extends
 * the P4.0 pre-generation critic; it does not replace it. The P4.0
 * `DesignCriticReport` is embedded verbatim as `pre_generation`.
 *
 * Three dimensions:
 *   - design_compliance  — the deterministic pre-generation checks. Always
 *                          assessable from pipeline artifacts. `evidence-backed`.
 *   - visual_quality     — composition / hierarchy / typography / color / imagery
 *                          as RENDERED. `unassessed` until a `VisualEvidence`
 *                          fixture is supplied; then `fixture-backed`.
 *   - technical_quality  — artifacts, text rendering, aspect ratio, resolution.
 *                          Same: `unassessed` → `fixture-backed`.
 *
 * Hard rule: no visual-quality or technical-quality claim is presented as fact
 * without evidence. Every issue carries a `basis`, and a schema refinement
 * forbids an `evidence-backed` / `fixture-backed` issue with no `evidence`.
 *
 * See `docs/visual-review.md`.
 */

export { ReviewCategory, ReviewSeverity };
export type { ReviewCategory as ReviewCategoryT, ReviewSeverity as ReviewSeverityT };

/** How a claim is supported. `unassessed` = we could not check it — say so plainly. */
export const EvidenceBasis = z.enum(["evidence-backed", "fixture-backed", "unassessed"]);
export type EvidenceBasis = z.infer<typeof EvidenceBasis>;

export const ReviewDimension = z.enum(["design_compliance", "visual_quality", "technical_quality"]);
export type ReviewDimension = z.infer<typeof ReviewDimension>;

export const DimensionStatus = z.enum(["assessed", "unassessed"]);
export type DimensionStatus = z.infer<typeof DimensionStatus>;

/** One issue. `unassessed` issues have empty evidence and an explicit "not assessed" `what`. */
export const ReviewIssue = z
  .object({
    dimension: ReviewDimension,
    category: ReviewCategory,
    severity: ReviewSeverity,
    basis: EvidenceBasis,
    /** What was observed / found. */
    what: Note,
    /** Why it matters, in doctrine terms. */
    why: Note,
    /** The consequence for the finished visual. */
    impact: Note,
    /** The concrete corrective action. */
    fix: Note,
    /** Which doctrine principle this upholds, or null. */
    upholds: NonEmptyText.nullable().default(null),
    /** Concrete values behind the issue. Empty ONLY when basis is "unassessed". */
    evidence: z.array(NonEmptyText)
  })
  .strict()
  .superRefine((issue, ctx) => {
    if (issue.basis !== "unassessed" && issue.evidence.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a ${issue.basis} issue must carry at least one evidence entry`
      });
    }
    if (issue.basis === "unassessed" && issue.evidence.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "an unassessed issue must not carry evidence"
      });
    }
  });
export type ReviewIssue = z.infer<typeof ReviewIssue>;

export const DimensionReport = z.object({
  dimension: ReviewDimension,
  status: DimensionStatus,
  basis: EvidenceBasis,
  /** 0..1 quality score, or null when the dimension is unassessed. */
  score: z.number().min(0).max(1).nullable(),
  issue_count: z.number().int().min(0)
});
export type DimensionReport = z.infer<typeof DimensionReport>;

export const CategoryStatus = z.object({
  category: ReviewCategory,
  dimension: ReviewDimension,
  status: DimensionStatus,
  issue_count: z.number().int().min(0)
});
export type CategoryStatus = z.infer<typeof CategoryStatus>;

/** The seven ordering principles the critic preserves, in priority order. */
export const DOCTRINE_PRINCIPLES = [
  "Communication before decoration.",
  "Function before style.",
  "Hierarchy before detail.",
  "Brand before trend.",
  "Context before stereotype.",
  "Consistency before novelty.",
  "Design decisions before prompt generation."
] as const;

export const VisualReviewReport = z
  .object({
    schema_version: NonEmptyText,
    /** BLOCK / REVIEW / PASS as advice; UNASSESSED only if compliance itself could not run. */
    verdict: z.enum(["PASS", "REVIEW", "BLOCK", "UNASSESSED"]),
    summary: Note,
    /** The seven doctrine principles, verbatim, in order — a fixed reference. */
    doctrine: z.array(NonEmptyText).length(7),
    dimensions: z.array(DimensionReport).length(3),
    categories: z.array(CategoryStatus).length(12),
    issues: z.array(ReviewIssue),
    overall: z.object({
      /** Mean of assessed dimension scores, or null when a renderable dimension is unassessed. */
      score: z.number().min(0).max(1).nullable(),
      status: z.enum(["assessed", "partially-assessed", "unassessed"]),
      verdict: z.enum(["PASS", "REVIEW", "BLOCK", "UNASSESSED"])
    }),
    /** The P4.0 report, embedded verbatim — never re-derived. */
    pre_generation: DesignCriticReport,
    audited: z.object({
      contract_id: Id,
      direction_id: Id,
      recipe_id: Id,
      recipe_hash: z.string().length(8),
      prompt_language: NonEmptyText,
      concept_ref: Id.nullable(),
      /** The evidence_id used, or null when visual/technical stayed unassessed. */
      visual_evidence_ref: Id.nullable(),
      /** True when evidence was supplied but its recipe_hash did not match. */
      visual_evidence_stale: z.boolean()
    })
  })
  .strict();
export type VisualReviewReport = z.infer<typeof VisualReviewReport>;
