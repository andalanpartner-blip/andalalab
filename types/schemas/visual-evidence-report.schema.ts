import { z } from "zod";
import { DatasetVersion, Id, IsoDate, NonEmptyText, Note, Ratio, SemVer, Slug } from "../primitives";

/**
 * Visual Evidence Report — P2.14.
 *
 * A bounded, structured description of what is OBSERVED in one generated image.
 * It is the machine-observation counterpart to the P4.1 `VisualEvidence`
 * (which is a human / QA reviewer's note). Where P4.1 evidence already carries
 * a `polarity` (supports / concern), this artifact carries none: it answers
 * only "what appears to be present in the generated visual?" and never "is the
 * design good?".
 *
 * Hard rule: every field here is an OBSERVATION or a piece of provenance.
 * There are no quality scores, no pass/fail, no recommendations, no
 * corrections, no approval and no critique. Interpretation happens later, in
 * the P2.15 vision-aware Design Critic, which reads this as data and never
 * re-derives it.
 *
 * It binds to exactly one `GeneratedArtifact` by hash so a stale observation
 * can never be attached to a design it was not made against.
 *
 * Determinism: the artifact id and `created_at` are volatile and excluded from
 * `evidence_hash`; everything else (provenance + source + image + observations
 * + confidence + issues + unassessed) is hashed, so replaying the same provider
 * response for the same artifact yields the same `evidence_hash`.
 */

const Hash8 = z.string().length(8);

/** A normalised rectangle in 0..1 image space. Origin top-left, y grows down. */
export const EvidenceRect = z
  .object({ x: Ratio, y: Ratio, w: Ratio, h: Ratio })
  .strict()
  .superRefine((rect, ctx) => {
    if (rect.w <= 0 || rect.h <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "rect must have positive area" });
    }
    if (rect.x + rect.w > 1 + 1e-6 || rect.y + rect.h > 1 + 1e-6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "rect overflows the image bounds" });
    }
  });
export type EvidenceRect = z.infer<typeof EvidenceRect>;

/** What a provider says a region looks like — never what it should be. */
export const ObservedRegionKind = z.enum([
  "image",
  "text",
  "graphic",
  "product",
  "person",
  "background",
  "unknown"
]);
export type ObservedRegionKind = z.infer<typeof ObservedRegionKind>;

export const ObservedRegion = z
  .object({
    id: Slug,
    kind: ObservedRegionKind,
    rect: EvidenceRect,
    /** Fraction of the frame this region covers, as observed. */
    area_share: Ratio,
    /** Provider confidence for THIS observation, or the neutral 0.5 when none is supplied. */
    confidence: Ratio
  })
  .strict();
export type ObservedRegion = z.infer<typeof ObservedRegion>;

export const ObservedTextBlock = z
  .object({
    id: Slug,
    rect: EvidenceRect,
    /** OCR-like transcription when the provider supplies it; null otherwise. Never invented. */
    text: z.string().nullable().default(null),
    confidence: Ratio
  })
  .strict();
export type ObservedTextBlock = z.infer<typeof ObservedTextBlock>;

export const ObservedColorSummary = z
  .object({
    /** Up to eight dominant colours as hex, in descending coverage. */
    dominant_hexes: z.array(z.string().regex(/^#?[0-9a-fA-F]{6}$/)).max(8).default([]),
    approx_palette_size: z.number().int().min(0).max(64).nullable().default(null),
    approx_contrast: Ratio.nullable().default(null)
  })
  .strict();
export type ObservedColorSummary = z.infer<typeof ObservedColorSummary>;

/**
 * The structured observation set. Any field a provider cannot supply is `null`
 * (or an empty array) and its name is listed in `report.unassessed` — it is
 * never guessed from the recipe, the blueprint or the prompt.
 */
export const EvidenceObservations = z
  .object({
    region_count: z.number().int().min(0).max(64).nullable().default(null),
    regions: z.array(ObservedRegion).default([]),
    text_region_count: z.number().int().min(0).max(64).nullable().default(null),
    text_blocks: z.array(ObservedTextBlock).default([]),
    /** Ref into `regions[].id`, or null. The single largest / most salient region. */
    dominant_region_id: Slug.nullable().default(null),
    /** Approx centre of the main subject in 0..1 image space, when detectable. */
    approx_subject_position: z.object({ x: Ratio, y: Ratio }).strict().nullable().default(null),
    person_present: z.boolean().nullable().default(null),
    whitespace_share: Ratio.nullable().default(null),
    approx_visual_density: Ratio.nullable().default(null),
    color: ObservedColorSummary.nullable().default(null),
    edge_bleed: z.enum(["none", "partial", "full"]).nullable().default(null),
    crop_behavior: z.enum(["as-requested", "cropped", "padded", "unknown"]).nullable().default(null),
    /** Provider object / scene tags, verbatim. Descriptive only. */
    semantic_descriptors: z.array(NonEmptyText).max(32).default([])
  })
  .strict();
export type EvidenceObservations = z.infer<typeof EvidenceObservations>;

/** Where the numbers came from. Never presented as ground truth. */
export const EvidenceSource = z
  .object({
    kind: z.enum(["vision-model", "replay-fixture", "human"]),
    provider: NonEmptyText,
    model: NonEmptyText,
    /** The observation-mapping contract version the adapter implemented. */
    observation_schema_version: SemVer,
    observed_at: IsoDate
  })
  .strict();
export type EvidenceSource = z.infer<typeof EvidenceSource>;

/**
 * Full provenance binding. Every hash is copied from an upstream artifact — the
 * report never recomputes one. A resolver rejects a report whose
 * `generated_artifact` provenance does not match the artifact under review.
 */
export const EvidenceProvenance = z
  .object({
    generated_artifact_id: Id,
    artifact_hash: Hash8,
    recipe_id: Id,
    recipe_hash: Hash8,
    blueprint_id: Id.nullable(),
    blueprint_hash: Hash8.nullable(),
    prompt_hash: Hash8,
    generation_request_hash: Hash8,
    /** The image-generation provider / model that produced the frame. */
    provider: NonEmptyText,
    model: NonEmptyText,
    adapter_id: NonEmptyText
  })
  .strict();
export type EvidenceProvenance = z.infer<typeof EvidenceProvenance>;

export const EvidenceIssue = z
  .object({
    code: NonEmptyText,
    severity: z.enum(["P0", "P1", "P2"]),
    path: NonEmptyText,
    message: Note
  })
  .strict();
export type EvidenceIssue = z.infer<typeof EvidenceIssue>;

export const VisualEvidenceReport = z
  .object({
    schema_version: SemVer,
    /** The observation-mapping / assembly logic version. Part of the hashed body. */
    resolver_version: SemVer,
    dataset_version: DatasetVersion,
    evidence_id: Id,
    created_at: IsoDate,

    provenance: EvidenceProvenance,
    source: EvidenceSource,

    image: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        /** Observed aspect ratio as a reduced "w:h" string. */
        aspect_ratio: NonEmptyText,
        mime_type: NonEmptyText
      })
      .strict(),

    observations: EvidenceObservations,

    confidence: z
      .object({
        basis: z.enum(["provider-reported", "fixture", "none"]),
        /** Overall provider confidence in the observation set, or null. */
        overall: Ratio.nullable()
      })
      .strict(),

    /** Observation fields the provider could not produce. Named, never guessed. */
    unassessed: z.array(NonEmptyText),

    /** Structural problems found while resolving. The resolver never silently repairs. */
    issues: z.array(EvidenceIssue),

    /** fnv1a(canonicalise(body without evidence_id / created_at / evidence_hash)). */
    evidence_hash: Hash8
  })
  .strict();
export type VisualEvidenceReport = z.infer<typeof VisualEvidenceReport>;

/** The current observation-mapping contract version. */
export const OBSERVATION_SCHEMA_VERSION = "1.0.0";
