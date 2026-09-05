import type { ConceptScoreDimension } from "../../types/schemas/concept.schema";

/**
 * Every tunable number for the Creative Concept Engine, in one file.
 *
 * These are judgement calls that will move once real concepts have been read by
 * a designer. Keeping them together means tuning is one diff, and nobody has to
 * hunt for a threshold buried in a scorer.
 */

/** How many concepts a generation call must return. */
export const CONCEPT_COUNT = 3;

/** One generation call plus at most one targeted regeneration. Never a third. */
export const MAX_CONCEPT_CALLS = 2;

/** Below this pairwise distance, two concepts are the same idea repainted. */
export const MIN_CONCEPT_DISTANCE = 0.35;

/** Weights for pairwise concept distance. Sum to 1. */
export const DISTANCE_WEIGHTS = {
  concept_type: 0.18,
  metaphor_family: 0.14,
  subject_strategy: 0.14,
  narrative_strategy: 0.12,
  composition_intent: 0.08,
  emotional_strategy: 0.06,
  human_presence: 0.06,
  abstraction_level: 0.04,
  /**
   * Lexical distance carries the most weight of any single feature because it
   * is the only one the model cannot game: two concepts can be labelled with
   * different enums and still be the same sentence twice.
   */
  lexical: 0.18
} as const;

/** Specificity thresholds. Ratios, not lengths — long generic prose must still fail. */
export const SPECIFICITY = {
  /** Distinct content words required across the conceptual fields. */
  minUniqueContentWords: 12,
  /** Distinct content words required in a single field. */
  minFieldContentWords: 4,
  /** Share of content words allowed to be vague adjectives before rejection. */
  maxVaguenessRatio: 0.25,
  /** unique / total content words. Below this the text is circling itself. */
  minLexicalVariety: 0.55,
  /** A field made mostly of styling vocabulary is describing execution. */
  maxStylingRatio: 0.4
} as const;

/** Fields carrying the WHAT / WHY / HOW of a concept, all specificity-checked. */
export const CONCEPTUAL_FIELDS = [
  "big_idea",
  "creative_tension",
  "visual_metaphor",
  "why",
  "visual_world"
] as const;

/** Deterministic concept scoring weights. Sum to 1. */
export const CONCEPT_SCORE_WEIGHTS: Record<ConceptScoreDimension, number> = {
  strategic_relevance: 0.2,
  audience_relevance: 0.15,
  industry_fit: 0.13,
  brand_fit: 0.1,
  originality: 0.12,
  visual_potential: 0.1,
  cultural_coherence: 0.1,
  platform_suitability: 0.06,
  production_feasibility: 0.04
};

export const CONCEPT_TEMPLATE_VERSION = "concept-generator@1.0.0";
