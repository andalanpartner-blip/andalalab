import type { DatasetRegistry } from "../../types/datasets";
import type { IndustryDNA } from "../../types/schemas/reference/industry.schema";
import type { DkvRule } from "../../types/schemas/dkv.schema";
import { rankOf } from "../dkv/doctrine";

export function resolveIndustry(datasets: DatasetRegistry, id: string): IndustryDNA | null {
  return datasets.industries.get(id) ?? null;
}

/**
 * Industry provides constraints, not templates (doctrine §10).
 *
 * Floors and ceilings become explicit bands at doctrine rank 3, which is what
 * lets P1 say "Property outranks Brutalism" as a computation: the movement's
 * contrast bias sits at rank 8 and simply loses to the band.
 */
export function industryDkvBands(industry: IndustryDNA): DkvRule[] {
  const rank = rankOf("industry_requirements");
  return [
    {
      param: "contrast",
      min: industry.dkv_floor.contrast,
      max: 1,
      source: `industry:${industry.id} contrast floor`,
      doctrine_rank: rank
    },
    {
      param: "hierarchy_strength",
      min: industry.dkv_floor.hierarchy_strength,
      max: 1,
      source: `industry:${industry.id} hierarchy floor`,
      doctrine_rank: rank
    },
    {
      param: "visual_density",
      min: 0,
      max: industry.dkv_ceiling.visual_density,
      source: `industry:${industry.id} density ceiling`,
      doctrine_rank: rank
    },
    {
      param: "color_complexity",
      min: 0,
      max: industry.dkv_ceiling.color_complexity,
      source: `industry:${industry.id} colour complexity ceiling`,
      doctrine_rank: rank
    }
  ];
}
