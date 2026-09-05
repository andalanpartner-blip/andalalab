import type { DatasetRegistry } from "../../types/datasets";
import type { DesignMovement } from "../../types/schemas/reference/movement.schema";
import type { IndustryDNA } from "../../types/schemas/reference/industry.schema";
import type { DkvRule } from "../../types/schemas/dkv.schema";
import { rankOf } from "../dkv/doctrine";

/** Closes the P0 asymmetry: movement now resolves like every other reference type. */
export function resolveMovement(datasets: DatasetRegistry, id: string): DesignMovement | null {
  return datasets.movements.get(id) ?? null;
}

/**
 * Industry compatibility is bidirectional on purpose.
 *
 * A movement may declare it suits an industry, or an industry may declare it
 * prefers a movement. Requiring both would make the data brittle — the two
 * files are authored at different times by different reasoning.
 */
export function movementSuitsIndustry(movement: DesignMovement, industry: IndustryDNA): boolean {
  return (
    movement.suitable_industries.includes(industry.id) ||
    industry.preferred_movements.includes(movement.id)
  );
}

export function movementSuitsObjective(movement: DesignMovement, objective: string): boolean {
  return movement.suitable_objectives.includes(objective);
}

/** Movement opinions enter as targets at doctrine rank 8 — the weakest layer that still speaks. */
export function movementDkvClaims(movement: DesignMovement): DkvRule[] {
  const rank = rankOf("design_movement");
  const claims: DkvRule[] = [];
  for (const [param, value] of Object.entries(movement.dkv_bias)) {
    if (typeof value !== "number") continue;
    claims.push({
      param: param as DkvRule["param"],
      min: 0,
      max: param === "typographic_scale_ratio" ? 4 : 1,
      target: value,
      source: `movement:${movement.id} ${param} bias`,
      doctrine_rank: rank
    });
  }
  return claims.sort((a, b) => a.param.localeCompare(b.param));
}

/** All movements, ordered deterministically. */
export function allMovements(datasets: DatasetRegistry): readonly DesignMovement[] {
  return [...datasets.movements.values()].sort((a, b) => a.id.localeCompare(b.id));
}
