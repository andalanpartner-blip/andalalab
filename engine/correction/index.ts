export { applyCorrection, type ApplyCorrectionInput, type ApplyCorrectionResult } from "./apply";
export { classifyRecipeDiff, STRUCTURAL_PREFIXES, type DiffClassification } from "./classify";
export type {
  CorrectionField,
  CorrectionAdjustment,
  CorrectionPatch,
  CorrectionOutcome,
  AppliedChange,
  CorrectionReport
} from "../../types/schemas/correction.schema";
export { DKV_CORRECTION_FIELDS } from "../../types/schemas/correction.schema";

// --- P2.16: correction recommendation (bounded options from a critique) ---
export {
  recommendCorrections,
  toCorrectionPatch,
  RECOMMENDATION_RESOLVER_VERSION,
  PRESERVED_INVARIANTS,
  type RecommendCorrectionsInput,
  type CorrectionPatchDraft
} from "./recommend";
export {
  RECOMMENDABLE_FIELDS,
  MAX_ABS_DELTA,
  isRecommendableField,
  boundedProposal,
  parameterPathFor,
  fieldRangeFor,
  currentValueFor,
  type RecommendableField,
  type BoundedProposal
} from "./policy";
export type {
  CorrectionRecommendation,
  CorrectionOption,
  RecommendationScope,
  RecommendationProvenance,
  UnactionableFinding
} from "../../types/schemas/correction-recommendation.schema";
