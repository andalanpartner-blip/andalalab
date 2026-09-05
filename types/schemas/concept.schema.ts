import { z } from "zod";
import { DatasetVersion, Id, IsoDate, NonEmptyText, Note, Ratio, SemVer } from "../primitives";

/**
 * Creative concepts.
 *
 * Two shapes, deliberately. `ConceptProposal` is what the model may say;
 * `CreativeConcept` is what the engine has decided. The model never writes an
 * authoritative score or a diversity vector — those are computed here from what
 * it proposed, which is the whole of "model proposes, engine disposes".
 */

/** Architecture §13. Closed: the model may not invent a thirteenth type. */
export const ConceptType = z.enum([
  "product_hero",
  "human_story",
  "visual_metaphor",
  "cultural_reinterpretation",
  "transformation",
  "contrast",
  "minimal_statement",
  "editorial_narrative",
  "unexpected_juxtaposition",
  "data_information",
  "lifestyle_aspiration",
  "brand_world"
]);
export type ConceptType = z.infer<typeof ConceptType>;

/** What the composition is actually about. */
export const SubjectStrategy = z.enum([
  "product-as-subject",
  "person-as-subject",
  "place-as-subject",
  "typography-as-subject",
  "material-as-subject",
  "process-as-subject",
  "absence-as-subject"
]);

/** How the idea is told. */
export const NarrativeStrategy = z.enum([
  "single-moment",
  "before-after",
  "sequence",
  "juxtaposition",
  "reveal",
  "statement",
  "documentary"
]);

export const EmotionalDirection = z.enum([
  "calm",
  "warm",
  "urgent",
  "confident",
  "playful",
  "reverent",
  "curious",
  "austere"
]);

/**
 * How the idea occupies the frame.
 *
 * NOT the DesignDirection's composition strategy, which is already fixed and
 * which a concept may not touch. This is concept-level: whether the idea is one
 * object, a figure in a place, or a field of type.
 */
export const CompositionIntent = z.enum([
  "single-object-focus",
  "figure-in-environment",
  "grid-of-parts",
  "typographic-field",
  "layered-depth",
  "wide-context"
]);

export const HumanPresence = z.enum(["none", "implied", "partial", "central", "crowd"]);

/** Ordinal: literal → abstract. Distance between them is scaled, not binary. */
export const AbstractionLevel = z.enum(["literal", "stylised", "symbolic", "abstract"]);
export const ABSTRACTION_ORDER = ["literal", "stylised", "symbolic", "abstract"] as const;

export const TemporalStrategy = z.enum([
  "instant",
  "anticipation",
  "aftermath",
  "ritual-repetition",
  "timeless"
]);

export const InteractionStrategy = z.enum(["observed", "addressed", "invited", "participatory"]);

/**
 * What the model returns, per concept. Strict: an unexpected key such as
 * `dkv` or `layout_id` is rejected outright rather than quietly ignored.
 */
export const ConceptProposal = z
  .object({
    name: NonEmptyText.max(80),
    type: ConceptType,

    /** WHAT — the idea in one sentence. */
    big_idea: Note,
    /** The opposition the idea runs on. Without one it is a mood, not a concept. */
    creative_tension: Note,
    /** HOW — the image that carries the idea. */
    visual_metaphor: Note,
    /** WHY — how the idea serves the communication objective. */
    why: Note,
    /** The world the image lives in: place, materials, time of day, staging. */
    visual_world: Note,

    emotional_direction: EmotionalDirection,
    subject_strategy: SubjectStrategy,
    narrative_strategy: NarrativeStrategy,
    composition_intent: CompositionIntent,
    human_presence: HumanPresence,
    abstraction_level: AbstractionLevel,
    temporal_strategy: TemporalStrategy,
    interaction_strategy: InteractionStrategy,

    best_for: z.array(NonEmptyText).min(1).max(5),
    risk: Note,

    /** Advisory only. The engine computes the authoritative score. */
    self_score: Ratio.optional()
  })
  .strict();
export type ConceptProposal = z.infer<typeof ConceptProposal>;

/** The model's whole reply. */
export const ConceptProposalBatch = z
  .object({ concepts: z.array(ConceptProposal).min(1).max(5) })
  .strict();
export type ConceptProposalBatch = z.infer<typeof ConceptProposalBatch>;

/** Deterministic, categorical, cheap. No embedding API in this phase. */
export const DiversityVector = z.object({
  concept_type: NonEmptyText,
  metaphor_family: NonEmptyText,
  subject_strategy: NonEmptyText,
  narrative_strategy: NonEmptyText,
  composition_intent: NonEmptyText,
  emotional_strategy: NonEmptyText,
  human_presence: NonEmptyText,
  abstraction_level: z.number().min(0).max(1),
  temporal_strategy: NonEmptyText,
  interaction_strategy: NonEmptyText,
  /** Content words with styling vocabulary removed — the anti-repaint signature. */
  lexical_signature: z.array(NonEmptyText)
});
export type DiversityVector = z.infer<typeof DiversityVector>;

export const ConceptScoreDimension = z.enum([
  "strategic_relevance",
  "audience_relevance",
  "industry_fit",
  "brand_fit",
  "originality",
  "visual_potential",
  "cultural_coherence",
  "platform_suitability",
  "production_feasibility"
]);
export type ConceptScoreDimension = z.infer<typeof ConceptScoreDimension>;

export const ConceptScore = z.object({
  total: Ratio,
  breakdown: z.array(
    z.object({
      dimension: ConceptScoreDimension,
      raw: Ratio,
      weight: Ratio,
      weighted: z.number(),
      applicable: z.boolean(),
      detail: NonEmptyText
    })
  ),
  /** Whatever the model claimed, kept only so the two can be compared. */
  model_advisory: Ratio.nullable()
});
export type ConceptScore = z.infer<typeof ConceptScore>;

export const CreativeConcept = z.object({
  id: Id,
  project_id: Id,
  schema_version: SemVer,
  dataset_version: DatasetVersion,
  created_at: IsoDate,
  created_by: z.string().min(1),

  direction_id: Id,
  proposal: ConceptProposal,
  diversity_vector: DiversityVector,
  score: ConceptScore,
  /** Identity of the idea, so the anchor can detect a swap. */
  concept_hash: z.string().length(8)
});
export type CreativeConcept = z.infer<typeof CreativeConcept>;

export const ConceptIssueCode = z.enum([
  "SCHEMA_INVALID",
  "GENERIC_LANGUAGE",
  "INSUFFICIENT_SPECIFICITY",
  "CONSTRAINT_VIOLATION",
  "FORBIDDEN_DIRECTION",
  "CULTURAL_STEREOTYPE",
  "INVENTED_CULTURAL_CLAIM",
  "MISSING_MANDATORY",
  "NEAR_DUPLICATE"
]);
export type ConceptIssueCode = z.infer<typeof ConceptIssueCode>;

export const ConceptIssue = z.object({
  code: ConceptIssueCode,
  severity: z.enum(["critical", "major", "minor"]),
  field: NonEmptyText,
  message: NonEmptyText,
  reason: NonEmptyText,
  fix: NonEmptyText
});
export type ConceptIssue = z.infer<typeof ConceptIssue>;
