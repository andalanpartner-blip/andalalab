import type { DatasetRegistry } from "../../types/datasets";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type { Candidate, DkvClaim } from "../../types/schemas/direction.schema";
import type { DkvRule } from "../../types/schemas/dkv.schema";
import { rankOf } from "../dkv/doctrine";
import { toClaims } from "../dkv/rules";
import { movementDkvClaims } from "../movement/resolve";
import { ATTENTION_DEMANDS, OBJECTIVE_DEMANDS } from "./score";

/**
 * Claim assembly.
 *
 * Conflict detection is not a separate algorithm — it falls out of collecting
 * every layer's demand on the same eight numbers and letting resolveDkv()
 * arbitrate. This module's only job is making sure every layer that has a
 * legitimate opinion actually gets to state it, tagged with its doctrine rank.
 */

/** Objective and audience speak as targets at ranks 1 and 2. */
function objectiveClaims(contract: DesignContract): DkvRule[] {
  const rank = rankOf("communication_objective");
  const demand = OBJECTIVE_DEMANDS[contract.objective] ?? { focal: 0.7, hierarchy: 0.7 };
  return [
    {
      param: "focal_dominance",
      min: 0,
      max: 1,
      target: demand.focal,
      source: `objective:${contract.objective} focal demand`,
      doctrine_rank: rank
    },
    {
      param: "hierarchy_strength",
      min: 0,
      max: 1,
      target: demand.hierarchy,
      source: `objective:${contract.objective} hierarchy demand`,
      doctrine_rank: rank
    }
  ];
}

function audienceClaims(contract: DesignContract): DkvRule[] {
  const rank = rankOf("audience");
  const demand = ATTENTION_DEMANDS[contract.audience.attention_context] ?? {
    focal: 0.7,
    density: 0.5
  };
  return [
    {
      param: "focal_dominance",
      min: 0,
      max: 1,
      target: demand.focal,
      source: `audience:${contract.audience.attention_context} focal demand`,
      doctrine_rank: rank
    },
    {
      param: "visual_density",
      min: 0,
      max: 1,
      target: demand.density,
      source: `audience:${contract.audience.attention_context} density tolerance`,
      doctrine_rank: rank
    }
  ];
}

/** A brand with a wide palette raises the ceiling it is willing to live under. */
function brandClaims(contract: DesignContract): DkvRule[] {
  if (!contract.brand) return [];
  const rank = rankOf("brand_identity");
  return [
    {
      param: "color_complexity",
      min: 0,
      max: 1,
      target: Math.min(1, contract.brand.palette.length / 8),
      source: `brand:${contract.brand.brand_id} palette breadth`,
      doctrine_rank: rank
    }
  ];
}

/** Layout structure is a DKV fundamental — rank 5, above platform and movement. */
function layoutClaims(candidate: Candidate, datasets: DatasetRegistry): DkvRule[] {
  const layout = datasets.layouts.get(candidate.layout_id);
  if (!layout) return [];
  const rank = rankOf("dkv_fundamentals");
  return Object.entries(layout.dkv_bias)
    .filter(([, value]) => typeof value === "number")
    .map(([param, value]) => ({
      param: param as DkvRule["param"],
      min: 0,
      max: param === "typographic_scale_ratio" ? 4 : 1,
      target: value as number,
      source: `layout:${layout.id} ${param} bias`,
      doctrine_rank: rank
    }))
    .sort((a, b) => a.param.localeCompare(b.param));
}

/**
 * Every claim on the eight parameters, for one candidate.
 *
 * Contract rules already carry industry (3), platform (6) and country (7).
 * This adds objective (1), audience (2), brand (4), layout (5) and movement (8).
 */
export function collectClaims(
  contract: DesignContract,
  candidate: Candidate,
  datasets: DatasetRegistry
): DkvClaim[] {
  const movement = datasets.movements.get(candidate.movement_id);

  const rules: DkvRule[] = [
    ...contract.dkv_rules,
    ...objectiveClaims(contract),
    ...audienceClaims(contract),
    ...brandClaims(contract),
    ...layoutClaims(candidate, datasets),
    ...(movement ? movementDkvClaims(movement) : [])
  ];

  return toClaims(rules).sort((a, b) =>
    a.param === b.param
      ? a.rank === b.rank
        ? a.source.localeCompare(b.source)
        : a.rank - b.rank
      : a.param.localeCompare(b.param)
  );
}
