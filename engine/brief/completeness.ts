import type { BriefExtraction } from "./extraction";
import { evaluateReadiness, BLOCKING_FIELDS } from "./readiness";

/**
 * Completeness checking — a diagnostics layer over the readiness policy.
 *
 * This module no longer decides whether a brief is usable. That decision
 * belongs entirely to `evaluateReadiness` in `./readiness`; `checkCompleteness`
 * asks it the same question and reports the answer alongside a richer,
 * non-authoritative breakdown (a 0-1 score, low-confidence fields, and the
 * distinction between derivable and genuinely optional fields) that is useful
 * for reporting but must never diverge from — or be consulted ahead of — the
 * readiness verdict.
 *
 * The output drives the CLARIFY state in the project state machine.
 */

/** Re-exported so existing consumers of this module keep working unchanged. */
export { BLOCKING_FIELDS };

/**
 * Fields the engine can supply deterministically.
 *
 * These are still reported as missing — a derived value is not a stated one,
 * and the person reviewing the brief should be able to see the difference.
 */
export const DERIVABLE_FIELDS = [
  "platform.viewing_context",
  "audience.attention_context",
  "audience.age_range",
  "audience.sophistication",
  "audience.price_sensitivity",
  "deliverables"
] as const;

/** Genuinely optional: their absence changes nothing. */
export const OPTIONAL_FIELDS = [
  "core_message",
  "movement_id",
  "brand_name",
  "mandatories",
  "prohibitions",
  "audience.cultural_context",
  "style_notes",
  "visual_references"
] as const;

/** A field extracted with less certainty than this is worth confirming. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/** Blocking fields carry three quarters of the score; the rest share the last quarter. */
export const BLOCKING_WEIGHT = 0.75;

export type CompletenessReport = {
  readonly missing_fields: readonly string[];
  readonly blocking_fields: readonly string[];
  readonly optional_fields: readonly string[];
  readonly derivable_fields: readonly string[];
  readonly low_confidence_fields: readonly { field: string; confidence: number }[];
  readonly completeness_score: number;
  /** True when nothing blocking is missing, so a NormalizedBrief can be built. */
  readonly ready: boolean;
};

export type ReadinessDiagnostics = {
  readonly ready: boolean;
  readonly blocking_fields: readonly string[];
  readonly missing_blocking_fields: readonly string[];
  readonly optional_missing_fields: readonly string[];
  readonly derived_fields: readonly string[];
};

/** Project the existing completeness result into an explicit readiness diagnosis. */
export function getReadinessDiagnostics(
  completeness: CompletenessReport,
  derivedFields: readonly string[] = []
): ReadinessDiagnostics {
  return {
    ready: completeness.ready,
    blocking_fields: [...BLOCKING_FIELDS],
    missing_blocking_fields: [...completeness.blocking_fields],
    optional_missing_fields: [...completeness.optional_fields],
    derived_fields: [...derivedFields]
  };
}

type FieldState = { present: boolean; confidence: number };

function readStates(extraction: BriefExtraction): Record<string, FieldState> {
  const has = (value: unknown, confidence: number): FieldState => ({
    present: value !== null && value !== undefined && value !== "",
    confidence
  });

  return {
    objective: has(extraction.objective.value, extraction.objective.confidence),
    core_message: has(extraction.core_message.value, extraction.core_message.confidence),
    industry_id: has(extraction.industry_id.value, extraction.industry_id.confidence),
    visual_type_id: has(extraction.visual_type_id.value, extraction.visual_type_id.confidence),
    "platform.channel": has(
      extraction.platform.channel.value,
      extraction.platform.channel.confidence
    ),
    "platform.aspect_ratio_id": has(
      extraction.platform.aspect_ratio_id.value,
      extraction.platform.aspect_ratio_id.confidence
    ),
    "platform.viewing_context": has(
      extraction.platform.viewing_context.value,
      extraction.platform.viewing_context.confidence
    ),
    "audience.description": has(
      extraction.audience.description.value,
      extraction.audience.description.confidence
    ),
    "audience.attention_context": has(
      extraction.audience.attention_context.value,
      extraction.audience.attention_context.confidence
    ),
    "audience.age_range": {
      present: extraction.audience.age_min.value !== null && extraction.audience.age_max.value !== null,
      confidence: Math.min(
        extraction.audience.age_min.confidence,
        extraction.audience.age_max.confidence
      )
    },
    "audience.sophistication": has(
      extraction.audience.sophistication.value,
      extraction.audience.sophistication.confidence
    ),
    "audience.price_sensitivity": has(
      extraction.audience.price_sensitivity.value,
      extraction.audience.price_sensitivity.confidence
    ),
    "audience.cultural_context": {
      present: extraction.audience.cultural_context.length > 0,
      confidence: 1
    },
    country: {
      present: extraction.countries.length > 0,
      confidence: Math.min(1, ...extraction.countries.map((entry) => entry.confidence), 1)
    },
    movement_id: has(extraction.movement_id.value, extraction.movement_id.confidence),
    brand_name: has(extraction.brand_name.value, extraction.brand_name.confidence),
    deliverables: { present: extraction.deliverables.length > 0, confidence: 1 },
    mandatories: { present: extraction.mandatories.length > 0, confidence: 1 },
    prohibitions: { present: extraction.prohibitions.length > 0, confidence: 1 },
    style_notes: { present: extraction.style_notes.length > 0, confidence: 1 },
    visual_references: { present: extraction.visual_references.length > 0, confidence: 1 }
  };
}

export function checkCompleteness(extraction: BriefExtraction): CompletenessReport {
  const states = readStates(extraction);
  const missingIn = (fields: readonly string[]): string[] =>
    fields.filter((field) => !states[field]?.present).sort();

  // Blocking-field status is not recomputed here — it is read straight from
  // the readiness policy, so this report can never disagree with it.
  const readiness = evaluateReadiness(extraction);
  const blocking = [...readiness.blocking_fields];
  const derivable = missingIn(DERIVABLE_FIELDS);
  const optional = missingIn(OPTIONAL_FIELDS);

  const blockingPresent = BLOCKING_FIELDS.length - blocking.length;
  const softFields = [...DERIVABLE_FIELDS, ...OPTIONAL_FIELDS];
  const softPresent = softFields.length - derivable.length - optional.length;

  const score =
    BLOCKING_WEIGHT * (blockingPresent / BLOCKING_FIELDS.length) +
    (1 - BLOCKING_WEIGHT) * (softPresent / softFields.length);

  const lowConfidence = Object.entries(states)
    .filter(([, state]) => state.present && state.confidence < LOW_CONFIDENCE_THRESHOLD)
    .map(([field, state]) => ({ field, confidence: state.confidence }))
    .sort((a, b) => a.field.localeCompare(b.field));

  return {
    missing_fields: [...blocking, ...derivable, ...optional].sort(),
    blocking_fields: blocking,
    optional_fields: optional,
    derivable_fields: derivable,
    low_confidence_fields: lowConfidence,
    completeness_score: Math.round(score * 10_000) / 10_000,
    // Not `blocking.length === 0` here on purpose — this must be the exact
    // same predicate normalizeBrief uses, including the INVALID/contradiction
    // case, which blocking-field presence alone would miss.
    ready: readiness.status === "READY"
  };
}
