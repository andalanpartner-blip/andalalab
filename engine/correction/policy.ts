import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { CorrectionField } from "../../types/schemas/correction.schema";
import { DKV_CORRECTION_FIELDS } from "../../types/schemas/correction.schema";
import type { DkvParamKey } from "../../types/schemas/dkv.schema";
import { PARAM_LIMITS } from "../dkv/rules";
import { round } from "../dkv/params";

/**
 * Correction-recommendation policy (P2.16).
 *
 * The vision critic can only ever recommend a change to a parameter the P6
 * Correction Engine ALREADY supports (`CorrectionField`). This file is the
 * bounded allow-list plus the per-field delta ceiling — a recommendation can
 * never propose an arbitrary jump.
 *
 * It introduces no new mutation parameter. Every field here is already in
 * `CorrectionField`; a recommendation that names one of them produces, when the
 * human approves it, an ordinary `CorrectionAdjustment` that flows through the
 * unchanged P6 engine.
 */

/**
 * The fields a vision-critique mismatch is allowed to map to. A strict subset
 * of `CorrectionField` — framing / crop / aspect problems are NOT here because
 * they are provider-side, and typography case / ornament are not driven by any
 * observation the evidence layer produces.
 */
export const RECOMMENDABLE_FIELDS = [
  "focal_dominance",
  "hierarchy_strength",
  "whitespace",
  "visual_density",
  "contrast",
  "color_complexity",
  "color_saturation"
] as const satisfies readonly CorrectionField[];
export type RecommendableField = (typeof RECOMMENDABLE_FIELDS)[number];

const RECOMMENDABLE_SET = new Set<string>(RECOMMENDABLE_FIELDS);
export function isRecommendableField(field: string): field is RecommendableField {
  return RECOMMENDABLE_SET.has(field);
}

/** Per-field ceiling on |proposed − current| for ONE recommendation. Small by design. */
export const MAX_ABS_DELTA: Record<RecommendableField, number> = {
  focal_dominance: 0.15,
  hierarchy_strength: 0.15,
  whitespace: 0.12,
  visual_density: 0.12,
  contrast: 0.15,
  color_complexity: 0.15,
  color_saturation: 0.15
};

const DKV_FIELD_SET = new Set<string>(DKV_CORRECTION_FIELDS);

/** The recipe parameter path a field reads from — for the recommendation's `parameter_path`. */
export function parameterPathFor(field: RecommendableField): string {
  if (DKV_FIELD_SET.has(field)) return `dkv.${field}`;
  if (field === "color_saturation") return "color.saturation";
  return field;
}

/** The absolute range of a field. */
export function fieldRangeFor(field: RecommendableField): { min: number; max: number } {
  if (DKV_FIELD_SET.has(field)) return PARAM_LIMITS[field as DkvParamKey];
  return { min: 0, max: 1 };
}

/** The recipe's current value for a field. */
export function currentValueFor(recipe: DesignRecipe, field: RecommendableField): number {
  if (DKV_FIELD_SET.has(field)) return recipe.dkv[field as DkvParamKey];
  if (field === "color_saturation") return recipe.color.saturation;
  return 0;
}

export type BoundedProposal = {
  readonly current: number;
  readonly proposed: number;
  readonly delta: number;
  readonly maxAbsDelta: number;
  readonly range: { min: number; max: number };
  /** Set when the ceiling or the field range held the request back. */
  readonly heldBy: string | null;
  /** True when there is no bounded room to move — the option is not actionable. */
  readonly exhausted: boolean;
};

/**
 * Turn "move `field` `direction` by roughly `magnitude`" into a bounded,
 * clamped proposal. `magnitude` is a positive number; it is capped at the
 * field's `MAX_ABS_DELTA` and the result is clamped to the field's range.
 */
export function boundedProposal(
  recipe: DesignRecipe,
  field: RecommendableField,
  direction: "increase" | "decrease",
  magnitude: number
): BoundedProposal {
  const current = round(currentValueFor(recipe, field));
  const range = fieldRangeFor(field);
  const ceiling = MAX_ABS_DELTA[field];

  let heldBy: string | null = null;
  let requested = Math.abs(magnitude);
  if (requested > ceiling) {
    requested = ceiling;
    heldBy = `the ${field} correction ceiling (±${ceiling})`;
  }

  const signed = direction === "increase" ? requested : -requested;
  let proposed = round(current + signed);
  if (proposed > range.max) {
    proposed = range.max;
    heldBy = `the ${field} range limit (${range.min}–${range.max})`;
  } else if (proposed < range.min) {
    proposed = range.min;
    heldBy = `the ${field} range limit (${range.min}–${range.max})`;
  }

  const delta = round(proposed - current);
  return {
    current,
    proposed,
    delta,
    maxAbsDelta: ceiling,
    range,
    heldBy,
    exhausted: Math.abs(delta) < 1e-6
  };
}
