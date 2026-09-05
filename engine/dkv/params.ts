import type { DkvBias, DkvParams } from "../../types/schemas/dkv.schema";
import { DKV_PARAM_KEYS } from "../../types/schemas/dkv.schema";

export const clampRatio = (value: number): number => Math.min(1, Math.max(0, value));

export const round = (value: number, places = 4): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/**
 * Weighted merge of partial DKV biases.
 *
 * Contributions are averaged per parameter using only the sources that actually
 * express an opinion about it — a layout that says nothing about colour
 * complexity must not drag the value toward zero.
 */
export function mergeBias(contributions: readonly { bias: DkvBias; weight: number }[]): DkvBias {
  const merged: Record<string, number> = {};

  for (const key of DKV_PARAM_KEYS) {
    let total = 0;
    let weightSum = 0;
    for (const contribution of contributions) {
      const value = contribution.bias[key];
      if (typeof value !== "number" || contribution.weight <= 0) continue;
      total += value * contribution.weight;
      weightSum += contribution.weight;
    }
    if (weightSum > 0) merged[key] = round(total / weightSum);
  }

  return merged as DkvBias;
}

/** Is a full parameter set inside every band it is subject to? */
export function withinBand(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

export const DEFAULT_DKV: DkvParams = {
  whitespace: 0.5,
  contrast: 0.6,
  visual_density: 0.5,
  alignment: 0.8,
  hierarchy_strength: 0.6,
  color_complexity: 0.4,
  focal_dominance: 0.6,
  typographic_scale_ratio: 1.5
};
