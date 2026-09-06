import { z } from "zod";
import { DatasetVersion, Id, IsoDate, NonEmptyText, Note, Ratio, SemVer } from "../primitives";
import { ZoneId } from "./reference/layout.schema";

/**
 * Design Critique — P2.15.
 *
 * The vision-aware half of the Design Critic. Where P2.14 answers "what do we
 * see?", this answers "how does what we see compare to what we INTENDED?".
 *
 * Input: DesignRecipe + LayoutBlueprint + DesignContract + VisualEvidenceReport.
 * Output: this artifact — a set of per-dimension findings, each one tied to a
 * specific upstream intent signal and a specific observed value.
 *
 * Hard rules:
 *   - Deterministic. Same inputs ⇒ byte-identical critique and `critique_hash`.
 *   - It NEVER rewrites the recipe, blueprint, concept or prompt, and it never
 *     regenerates the image.
 *   - It does NOT decide the correction. It says "there is a mismatch"; the
 *     P2.16 recommender later says "here is a bounded corrective option".
 *   - No vague prose. Every finding names the intended signal, the observed
 *     value and the comparison.
 *   - No universal "design quality score" — per-dimension classification only.
 *
 * See `docs/vision-design-critic.md`.
 */

/** How the observed value compares to the intended one. */
export const CritiqueClassification = z.enum([
  "compliant",
  "minor_mismatch",
  "major_mismatch",
  "unassessed"
]);
export type CritiqueClassification = z.infer<typeof CritiqueClassification>;

/** P0 critical · P1 major · P2 moderate · P3 minor. `unassessed` findings are P3. */
export const CritiqueSeverity = z.enum(["P0", "P1", "P2", "P3"]);
export type CritiqueSeverity = z.infer<typeof CritiqueSeverity>;

/** The comparison dimensions. Each is evaluated against a concrete upstream signal. */
export const CritiqueDimension = z.enum([
  "aspect_ratio",
  "platform_format",
  "focal_alignment",
  "subject_placement",
  "composition_alignment",
  "whitespace_alignment",
  "density_alignment",
  "text_region_alignment",
  "safe_area_alignment",
  "color_relationship"
]);
export type CritiqueDimension = z.infer<typeof CritiqueDimension>;

export const CritiqueFinding = z
  .object({
    /** Stable slug, e.g. "focal-alignment". */
    code: NonEmptyText,
    dimension: CritiqueDimension,
    classification: CritiqueClassification,
    severity: CritiqueSeverity,
    title: NonEmptyText,
    /** What the pipeline intended, and where it is written. */
    intended: z
      .object({ signal: NonEmptyText, value: NonEmptyText })
      .strict(),
    /** What was observed, and which evidence field / region it came from. */
    observed: z
      .object({ value: NonEmptyText, evidence_ref: NonEmptyText })
      .strict(),
    /** One deterministic sentence stating the comparison. Never model-generated. */
    comparison: Note,
    /** min(intent certainty, observation confidence). 0 for unassessed. */
    confidence: Ratio,
    basis: z.enum(["evidence-backed", "unassessed"]),
    /** The zone and/or recipe parameter this finding is about, when applicable. */
    affected: z
      .object({
        zone: ZoneId.nullable().default(null),
        parameter: NonEmptyText.nullable().default(null)
      })
      .strict()
  })
  .strict();
export type CritiqueFinding = z.infer<typeof CritiqueFinding>;

export const CritiqueDimensionRollup = z
  .object({
    dimension: CritiqueDimension,
    classification: CritiqueClassification,
    finding_count: z.number().int().min(0)
  })
  .strict();
export type CritiqueDimensionRollup = z.infer<typeof CritiqueDimensionRollup>;

export const CritiqueProvenance = z
  .object({
    evidence_id: Id,
    evidence_hash: z.string().length(8),
    artifact_hash: z.string().length(8),
    contract_id: Id,
    recipe_id: Id,
    recipe_hash: z.string().length(8),
    blueprint_id: Id.nullable(),
    blueprint_hash: z.string().length(8).nullable(),
    prompt_hash: z.string().length(8),
    generation_request_hash: z.string().length(8)
  })
  .strict();
export type CritiqueProvenance = z.infer<typeof CritiqueProvenance>;

export const DesignCritique = z
  .object({
    schema_version: SemVer,
    resolver_version: SemVer,
    dataset_version: DatasetVersion,
    critique_id: Id,
    created_at: IsoDate,

    provenance: CritiqueProvenance,

    /** PASS / REVIEW as advice; BLOCK only for a P0; UNASSESSED if nothing could be compared. */
    verdict: z.enum(["PASS", "REVIEW", "BLOCK", "UNASSESSED"]),
    summary: Note,

    /** Most severe first, then dimension order, then code. */
    findings: z.array(CritiqueFinding),
    dimensions: z.array(CritiqueDimensionRollup),

    /** The seven doctrine principles, verbatim, in order. */
    doctrine: z.array(NonEmptyText).length(7),
    /** Dimensions that had an intent signal but no usable observation. */
    unassessed_dimensions: z.array(CritiqueDimension),

    /** fnv1a(canonicalise(body without critique_id / created_at / critique_hash)). */
    critique_hash: z.string().length(8)
  })
  .strict();
export type DesignCritique = z.infer<typeof DesignCritique>;
