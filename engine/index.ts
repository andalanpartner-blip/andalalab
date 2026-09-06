/**
 * Public surface of the intelligence engine.
 *
 * Everything exported here is pure: no I/O, no network, no framework. Datasets,
 * time and identity arrive as arguments. This is the boundary the ESLint rules
 * in eslint.config.mjs protect, and the reason the whole layer can be lifted
 * into a standalone package later without edits.
 */
export { buildDesignContract, type BuildContractInput } from "./contract/build";
export { collectConstraints } from "./contract/constraints";
export { deriveAnchors, lockedAnchors } from "./contract/anchors";

export { DOCTRINE, rankOf, labelOf, resolveRank } from "./dkv/doctrine";
export { clampRatio, mergeBias, round, withinBand, DEFAULT_DKV } from "./dkv/params";

export {
  normaliseBlend,
  blendScalar,
  dominantCountry,
  type ResolvedCountry
} from "./country/blend";
export {
  collectBannedTokens,
  mentionsToken,
  positiveFieldText,
  type BannedTokenReport
} from "./country/anti-stereotype";

export { resolveIndustry, industryDkvBands } from "./industry/resolve";
export {
  resolveMovement,
  movementSuitsIndustry,
  movementSuitsObjective,
  movementDkvClaims,
  allMovements
} from "./movement/resolve";
export { resolveVisualType, resolveAspectRatio, visualTypeDkvBands } from "./visual-type/resolve";
export { resolveLayout, layoutSupportsVisualType, candidateLayouts } from "./layout/resolve";

// --- P1: deterministic design core ---------------------------------------
export {
  blendDimensions,
  countryForDimension,
  COUNTRY_DIMENSIONS,
  CONTEST_MARGIN,
  type DimensionOwner
} from "./country/blend";

export {
  resolveDkv,
  toClaims,
  authorityWeight,
  PARAM_LIMITS,
  RESOLUTION_TOLERANCE,
  MAJOR_CLAMP,
  CRITICAL_CLAMP,
  type ResolveResult
} from "./dkv/rules";

export { generateCandidates, BIAS_WEIGHTS, type CandidateSet } from "./decision/candidates";
export {
  deriveColorStrategy,
  deriveCompositionStrategy,
  deriveTypographyStrategy
} from "./decision/strategies";
export {
  scoreCandidate,
  scoreCandidates,
  closeness,
  SCORE_WEIGHTS,
  SCORING_VERSION,
  PASS_MARK,
  OBJECTIVE_DEMANDS,
  OBJECTIVE_ZONE_NEEDS,
  ATTENTION_DEMANDS
} from "./decision/score";
export { collectClaims } from "./decision/conflicts";
export {
  buildDesignDirection,
  selectedCandidate,
  type BuildDirectionInput
} from "./decision/resolve";
export {
  explainSelection,
  explainRejection,
  explainParameter,
  explainResolution,
  buildRationale
} from "./decision/explain";

export { buildDesignRecipe, type BuildRecipeInput } from "./recipe/build";

// --- P2.5: graphic treatment engine ---------------------------------------
export { resolveGraphicTreatment } from "./graphic-treatment/resolve";
export { GRAPHIC_DEVICES } from "./graphic-treatment/data";
export type { GraphicDevice, GraphicTreatmentInput } from "./graphic-treatment/types";

// --- P2.6: photographic character engine ---------------------------------
export { resolvePhotographicCharacter } from "./photographic-character/resolve";
export { NEGATIVE_REALISM_BLOCK } from "./photographic-character/data";
export {
  resolvePhotographicFinish,
  type PhotographicFinishArgs
} from "./photographic-character/finish";
export { COLOR_CHARACTER_VOCABULARY } from "./photographic-character/finish-data";
export type { PhotographicCharacterInput, SubjectKind } from "./photographic-character/types";
export {
  lockDirectionAnchor,
  anchorViolations,
  assertAnchorsIntact,
  PRIMARY_DIRECTION_ANCHOR
} from "./recipe/anchors";
export { diffRecipes, IGNORED_PATHS, type RecipeDiff, type FieldChange } from "./recipe/diff";

// --- P2.1: brief interpretation (LLM boundary) ----------------------------
export {
  normalizeBrief,
  VIEWING_CONTEXT_BY_CHANNEL,
  ATTENTION_BY_CHANNEL,
  NEUTRAL_RATIO,
  DEFAULT_AGE_RANGE,
  type BriefNormalizationOutcome,
  type NormalizeBriefInput
} from "./brief/normalize";
export { buildExtractionSchema, type BriefExtraction } from "./brief/extraction";
export {
  checkCompleteness,
  BLOCKING_FIELDS,
  DERIVABLE_FIELDS,
  OPTIONAL_FIELDS,
  LOW_CONFIDENCE_THRESHOLD,
  type CompletenessReport,
  getReadinessDiagnostics,
  type ReadinessDiagnostics
} from "./brief/completeness";
export {
  evaluateReadiness,
  ASPECT_RATIO_BY_CHANNEL,
  READINESS_STATUSES,
  type ReadinessStatus,
  type ReadinessResult,
  type ClarificationQuestion
} from "./brief/readiness";
export {
  progressiveBriefing,
  formatClarificationRequest,
  appendClarificationAnswers,
  type BriefReadinessOutcome,
  type ProgressiveBriefingInput
} from "./brief/progressive-briefing";
export {
  sanitizeExtraction,
  cleanList,
  normaliseReference,
  sourceOverlap,
  INVENTION_THRESHOLD
} from "./brief/sanitize";
export {
  classifyBrief,
  INDUSTRY_ALIASES,
  AUDIENCE_SIGNALS,
  HIGH_CONFIDENCE,
  CLASSIFICATION_SOURCES,
  type ClassificationSource,
  type ClassificationDiagnostic,
  type BriefClassification
} from "./brief/classify";
export {
  buildBriefNormalizerPrompt,
  BRIEF_NORMALIZER_SYSTEM,
  BRIEF_NORMALIZER_TEMPLATE_VERSION
} from "./brief/prompts/brief-normalizer";

// --- P2.2: creative concept engine ----------------------------------------
export {
  generateConcepts,
  type ConceptGenerationOutcome,
  type GenerateConceptsInput,
  type ConceptRejection
} from "./concept/generate";
export { validateConcept, measureSpecificity, type ConceptValidation } from "./concept/validate";
export {
  buildDiversityVector,
  pairwiseConceptDistance,
  assessDiversity,
  type DiversityReport,
  type DistanceBreakdown
} from "./concept/diversity";
export { scoreConcept, OBJECTIVE_CONCEPT_FIT, INDUSTRY_CONCEPT_FIT } from "./concept/score";
export {
  CONCEPT_COUNT,
  MAX_CONCEPT_CALLS,
  MIN_CONCEPT_DISTANCE,
  DISTANCE_WEIGHTS,
  SPECIFICITY,
  CONCEPT_SCORE_WEIGHTS,
  CONCEPT_TEMPLATE_VERSION
} from "./concept/config";
export {
  conceptLexicon,
  lexicalSignature,
  deriveMetaphorFamily,
  jaccard,
  CONCEPT_LEXICON_ID
} from "./concept/lexicon";
export {
  buildConceptPrompt,
  buildRegenerationPrompt,
  CONCEPT_GENERATOR_SYSTEM
} from "./concept/prompts/concept-generator";
export { lockConceptAnchor, CONCEPT_ANCHOR } from "./recipe/anchors";

export { ok, err, isOk, isErr, unwrap, type Result } from "./util/result";

// --- P2.11: visual generation request builder (pure — no provider) ---------
export {
  buildGenerationRequest,
  PROMPT_COMPILER_VERSION,
  GENERATION_REQUEST_VERSION,
  type BuildGenerationRequestInput
} from "./generation/request";
export type {
  GenerationRequest,
  GeneratedArtifact,
  GenerationProvenance,
  GenerationConfig,
  GenerationTarget
} from "../types/schemas/visual-generation.schema";

// --- P2.3: prompt compiler -------------------------------------------------
export { compilePromptSet } from "./prompt/compile";
export { buildPromptBlocks, type BuildPromptBlocksInput } from "./prompt/blocks";
// --- P3.0: stereotype / banned-token prompt output guard ------------------
export {
  guardPromptSet,
  GUARDED_PROMPT_TIERS,
  type GuardedPromptTier,
  type GuardAction,
  type BannedTokenFinding,
  type PromptGuardReport
} from "./prompt/guard";

// --- P4.0: pre-generation Design Critic ----------------------------------
export {
  auditDesign,
  MOVEMENT_INFLUENCE_FLOOR,
  type AuditInput,
  type AuditPromptSet,
  type DesignCriticReport,
  type CriticFinding,
  type CriticVerdict,
  type CriticSeverity,
  type CriticArea
} from "./critic/audit";

// --- P4.1: Visual Review (image-measuring half of the Design Critic) -----
export {
  reviewDesign,
  DOCTRINE_PRINCIPLES,
  VISUAL_REVIEW_SCHEMA_VERSION,
  type ReviewInput,
  type VisualReviewReport,
  type ReviewIssue,
  type ReviewDimension,
  type ReviewSeverity,
  type ReviewCategory,
  type EvidenceBasis,
  type DimensionReport,
  type CategoryStatus,
  type VisualEvidence,
  type EvidenceObservation
} from "./critic/review";

// --- P2.15: vision-aware Design Critic (evidence vs intent) -------------
export {
  evaluateVisionCritique,
  VISION_CRITIQUE_RESOLVER_VERSION,
  type VisionCritiqueInput
} from "./critic/vision-critique";
export type {
  DesignCritique,
  CritiqueFinding,
  CritiqueDimension,
  CritiqueClassification,
  CritiqueSeverity,
  CritiqueProvenance,
  CritiqueDimensionRollup
} from "../types/schemas/design-critique.schema";

// --- P6: correction engine ---------------------------------------------
export {
  applyCorrection,
  classifyRecipeDiff,
  STRUCTURAL_PREFIXES,
  DKV_CORRECTION_FIELDS,
  type ApplyCorrectionInput,
  type ApplyCorrectionResult,
  type DiffClassification,
  type CorrectionField,
  type CorrectionAdjustment,
  type CorrectionPatch,
  type CorrectionOutcome,
  type AppliedChange,
  type CorrectionReport
} from "./correction";
// --- P2.16: correction recommendation ----------------------------------
export {
  recommendCorrections,
  toCorrectionPatch,
  RECOMMENDATION_RESOLVER_VERSION,
  PRESERVED_INVARIANTS,
  RECOMMENDABLE_FIELDS,
  MAX_ABS_DELTA,
  isRecommendableField,
  boundedProposal,
  parameterPathFor,
  type RecommendCorrectionsInput,
  type CorrectionPatchDraft,
  type RecommendableField
} from "./correction";
export type {
  CorrectionRecommendation,
  CorrectionOption,
  RecommendationScope,
  UnactionableFinding
} from "../types/schemas/correction-recommendation.schema";

// --- P2.18: human creative decision -----------------------------------
export {
  buildCreativeDecision,
  decisionApprovesArtifact,
  CREATIVE_DECISION_RESOLVER_VERSION,
  type BuildCreativeDecisionInput
} from "./approval/decide";
export {
  LOCAL_CREATIVE_ACTOR,
  type CreativeDecision,
  type DecisionAction,
  type DecisionActor,
  type DecisionSubject,
  type DecisionContext
} from "../types/schemas/creative-decision.schema";
// --- P2.10: Layout Blueprint (derived structural plan) ------------------
export { resolveLayoutBlueprint, RESOLVER_VERSION, type ResolveBlueprintInput } from "./blueprint/resolve";
export { computeGeometry, resolveArrangement } from "./blueprint/geometry";
export { resolveZones, resolveReadingFlow, resolveFocal, roleFor, ZONE_LABEL } from "./blueprint/zones";
export { resolveRelationships } from "./blueprint/relationships";
export { resolveRationale } from "./blueprint/rationale";
export { detectImageIntegration } from "./blueprint/signals";
export type {
  LayoutBlueprint,
  BlueprintZone,
  BlueprintIssue,
  ZoneRelationship,
  BlueprintRationale,
  BlueprintReadingFlow,
  BlueprintFocal
} from "../types/schemas/layout-blueprint.schema";

export { resolveTextMode, TEXT_BEARING_ZONES } from "./prompt/text-mode";
export { isUnsupportedConceptStatement, excludeUnsupportedConcepts } from "./prompt/unsupported-concepts";
export { resolveVisualAdapter } from "./prompt/visual-adapter/resolve";
export {
  VISUAL_ADAPTERS,
  VISUAL_ADAPTER_LABEL,
  visualAdapterSummary
} from "./prompt/visual-adapter/data";
export {
  VISUAL_ADAPTER_IDS,
  type VisualAdapterId,
  type VisualAdapterVocabulary,
  type VisualAdapterInput,
  type VisualAdapterResolution
} from "./prompt/visual-adapter/types";
export {
  TEXT_MODES,
  QUALITY_REQUIREMENT_KEYS,
  NEGATIVE_BASELINE_KEYS,
  type PromptLanguage,
  type TextMode,
  type PromptBlocks,
  type PromptSet,
  type VisualGenerationBlock,
  type CompilePromptInput,
  type ConstraintInfo,
  type ConstraintKind,
  type QualityRequirementKey,
  type NegativeBaselineKey
} from "./prompt/types";
