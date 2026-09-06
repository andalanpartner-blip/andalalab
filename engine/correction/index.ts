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
