import type { DatasetRegistry } from "../../types/datasets";
import type { AspectRatio, VisualType } from "../../types/schemas/reference/visual-type.schema";
import type { DkvRule } from "../../types/schemas/dkv.schema";
import { rankOf } from "../dkv/doctrine";
import { clampRatio } from "../dkv/params";

export function resolveVisualType(datasets: DatasetRegistry, id: string): VisualType | null {
  return datasets.visualTypes.get(id) ?? null;
}

export function resolveAspectRatio(visualType: VisualType, id: string): AspectRatio | null {
  return visualType.aspect_ratios.find((ratio) => ratio.id === id) ?? null;
}

/**
 * Structural rules of the deliverable become bands at doctrine rank 6.
 *
 * The focal band is the important one: a feed asset is first seen at roughly a
 * tenth of its rendered size, so anything without a dominant focal element has
 * already failed before the design is judged.
 */
export function visualTypeDkvBands(visualType: VisualType): DkvRule[] {
  const rank = rankOf("platform_constraints");
  const bands: DkvRule[] = [];
  const bias = visualType.dkv_bias;

  if (typeof bias.focal_dominance === "number") {
    bands.push({
      param: "focal_dominance",
      min: clampRatio(bias.focal_dominance - 0.15),
      max: 1,
      target: bias.focal_dominance,
      source: `visual_type:${visualType.id} focal requirement`,
      doctrine_rank: rank
    });
  }
  if (typeof bias.hierarchy_strength === "number") {
    bands.push({
      param: "hierarchy_strength",
      min: clampRatio(bias.hierarchy_strength - 0.2),
      max: 1,
      target: bias.hierarchy_strength,
      source: `visual_type:${visualType.id} hierarchy requirement`,
      doctrine_rank: rank
    });
  }
  if (typeof bias.contrast === "number") {
    bands.push({
      param: "contrast",
      min: clampRatio(bias.contrast - 0.15),
      max: 1,
      target: bias.contrast,
      source: `visual_type:${visualType.id} legibility at thumbnail scale`,
      doctrine_rank: rank
    });
  }

  return bands;
}
