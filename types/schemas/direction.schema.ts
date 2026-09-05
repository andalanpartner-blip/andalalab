import { z } from "zod";
import { DatasetVersion, Id, IsoDate, NonEmptyText, Note, SemVer, Slug } from "../primitives";
import { DKV_PARAM_KEYS, DkvBias, DkvParams } from "./dkv.schema";

/**
 * The Design Direction — the deterministic strategic output of P1.
 *
 * Everything in here is computed by arithmetic over the reference datasets.
 * No language model is involved, which is what makes it reproducible, cheap,
 * inspectable and arguable. If a client asks why the movement was chosen, the
 * answer is a number and a named rule, not a vibe.
 */

/** Doctrine layers, repeated as a schema so stored artifacts validate. */
export const DoctrineLayer = z.enum([
  "communication_objective",
  "audience",
  "industry_requirements",
  "brand_identity",
  "dkv_fundamentals",
  "platform_constraints",
  "country_visual_dna",
  "design_movement",
  "contemporary_trends",
  "decorative_treatment"
]);
export type DoctrineLayer = z.infer<typeof DoctrineLayer>;

/**
 * Derived strategies.
 *
 * These are NOT enumerated as separate candidate axes. A colour strategy is a
 * function of the movement, the country blend and the industry — enumerating
 * it would multiply the candidate space without adding information, and would
 * let the scorer pick a palette that contradicts the movement that produced it.
 * They are derived per (movement × layout) pair and recorded for traceability.
 */
export const ColorStrategy = z.enum([
  "monochrome-structural",
  "restrained-neutral",
  "single-accent",
  "duotone-editorial",
  "high-chroma-vernacular"
]);
export type ColorStrategy = z.infer<typeof ColorStrategy>;

export const CompositionStrategy = z.enum([
  "modular-grid",
  "asymmetric-editorial",
  "centred-frontal",
  "full-bleed-focal",
  "stacked-vertical"
]);
export type CompositionStrategy = z.infer<typeof CompositionStrategy>;

export const TypographyStrategy = z.enum([
  "neutral-system",
  "editorial-contrast",
  "display-dominant",
  "structural-mono"
]);
export type TypographyStrategy = z.infer<typeof TypographyStrategy>;

export const Candidate = z.object({
  candidate_id: NonEmptyText,
  movement_id: Slug,
  movement_name: NonEmptyText,
  layout_id: Slug,
  layout_name: NonEmptyText,
  color_strategy: ColorStrategy,
  composition_strategy: CompositionStrategy,
  typography_strategy: TypographyStrategy,
  /** Merged DKV opinion of movement + layout + visual type, before doctrine. */
  bias: DkvBias
});
export type Candidate = z.infer<typeof Candidate>;

/** The eight scoring dimensions and their fixed weights (P1 spec §4). */
export const ScoreDimension = z.enum([
  "communication_fit",
  "industry_fit",
  "audience_fit",
  "brand_fit",
  "culture_fit",
  "movement_fit",
  "platform_fit",
  "distinctiveness"
]);
export type ScoreDimension = z.infer<typeof ScoreDimension>;

/**
 * One named, inspectable scoring rule.
 *
 * Every point a candidate gains or loses is attributable to one of these.
 * `detail` is generated from structured data, never hand-written per case.
 */
export const ScoreRule = z.object({
  id: NonEmptyText,
  dimension: ScoreDimension,
  detail: NonEmptyText,
  /** Contribution to the dimension's raw 0..1 score, before weighting. */
  delta: z.number()
});
export type ScoreRule = z.infer<typeof ScoreRule>;

export const DimensionScore = z.object({
  dimension: ScoreDimension,
  raw: z.number().min(0).max(1),
  weight: z.number().min(0).max(1),
  weighted: z.number(),
  /** False when the dimension has no evidence (e.g. no brand supplied). */
  applicable: z.boolean()
});
export type DimensionScore = z.infer<typeof DimensionScore>;

export const ScoredCandidate = z.object({
  candidate: Candidate,
  total_score: z.number().min(0).max(1),
  score_breakdown: z.array(DimensionScore).length(8),
  matched_rules: z.array(ScoreRule),
  failed_rules: z.array(ScoreRule)
});
export type ScoredCandidate = z.infer<typeof ScoredCandidate>;

/** A demand made on one DKV parameter by one doctrine layer. */
export const DkvClaim = z.object({
  param: z.enum(DKV_PARAM_KEYS),
  layer: DoctrineLayer,
  rank: z.number().int().min(1).max(10),
  kind: z.enum(["band", "target"]),
  min: z.number().optional(),
  max: z.number().optional(),
  target: z.number().optional(),
  source: NonEmptyText
});
export type DkvClaim = z.infer<typeof DkvClaim>;

export const ConflictSeverity = z.enum(["P0", "P1", "P2"]);
export type ConflictSeverity = z.infer<typeof ConflictSeverity>;

export const Conflict = z.object({
  conflict_id: NonEmptyText,
  param: z.enum(DKV_PARAM_KEYS),
  severity: ConflictSeverity,
  claims: z.array(DkvClaim).min(2),
  description: NonEmptyText
});
export type Conflict = z.infer<typeof Conflict>;

/**
 * A machine-readable conflict resolution (P1 spec §5).
 *
 * The higher-authority layer is kept and the lower one is modified, never the
 * other way round, and never by silent averaging.
 */
export const Resolution = z.object({
  conflict_id: NonEmptyText,
  param: z.enum(DKV_PARAM_KEYS),
  winner: DoctrineLayer,
  loser: DoctrineLayer,
  rule: NonEmptyText,
  action: NonEmptyText,
  requested: z.number(),
  resolved: z.number(),
  reason: NonEmptyText
});
export type Resolution = z.infer<typeof Resolution>;

/** How one parameter's final value was arrived at. Feeds explainability. */
export const DkvDerivation = z.object({
  param: z.enum(DKV_PARAM_KEYS),
  base: z.number(),
  weighted_target: z.number(),
  clamped_to: z.object({ min: z.number(), max: z.number() }),
  final: z.number(),
  governing_layer: DoctrineLayer,
  contributors: z.array(
    z.object({ layer: DoctrineLayer, rank: z.number().int(), value: z.number(), authority: z.number() })
  ),
  explanation: NonEmptyText
});
export type DkvDerivation = z.infer<typeof DkvDerivation>;

export const RejectedCandidate = z.object({
  candidate_id: NonEmptyText,
  reason: NonEmptyText,
  severity: ConflictSeverity
});

export const DesignDirection = z.object({
  id: Id,
  project_id: Id,
  schema_version: SemVer,
  dataset_version: DatasetVersion,
  created_at: IsoDate,
  created_by: z.string().min(1),

  contract_id: Id,
  contract_hash: z.string().length(8),
  scoring_version: SemVer,

  candidates: z.array(ScoredCandidate).min(1),
  rejected: z.array(RejectedCandidate),
  selected_candidate_id: NonEmptyText,

  dkv_targets: DkvParams,
  derivations: z.array(DkvDerivation).length(8),
  conflicts: z.array(Conflict),
  resolutions: z.array(Resolution),

  /** Plain-language, generated from the structures above. Never from an LLM. */
  rationale: z.array(Note).min(1),
  direction_hash: z.string().length(8)
});
export type DesignDirection = z.infer<typeof DesignDirection>;
