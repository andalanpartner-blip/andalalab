import type { DesignContract } from "../../types/schemas/contract.schema";
import type { DesignDirection } from "../../types/schemas/direction.schema";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { LayoutSystem } from "../../types/schemas/reference/layout.schema";
import type { VisualType } from "../../types/schemas/reference/visual-type.schema";
import type {
  BlueprintFocal,
  BlueprintRationale,
  BlueprintReadingFlow,
  BlueprintZone
} from "../../types/schemas/layout-blueprint.schema";
import { DOCTRINE_PRINCIPLES } from "../../types/schemas/visual-review.schema";
import { round } from "../dkv/params";
import { ZONE_LABEL } from "./zones";
import type { GeometryResult } from "./types";

/**
 * The Layout Blueprint rationale layer (P2.10.4).
 *
 * Deterministic explanations generated from resolved values — never from a
 * model, and never a fabricated cultural or strategic claim. Each entry answers
 * three questions: what is happening (`claim`), why (`reason`), and which
 * concrete upstream signal caused it (`signal`). `basis` names the artifact(s)
 * the signal comes from; `principle` is the doctrine rule it upholds.
 */

const P = {
  communication: DOCTRINE_PRINCIPLES[0], // "Communication before decoration."
  function: DOCTRINE_PRINCIPLES[1], // "Function before style."
  hierarchy: DOCTRINE_PRINCIPLES[2], // "Hierarchy before detail."
  brand: DOCTRINE_PRINCIPLES[3], // "Brand before trend."
  consistency: DOCTRINE_PRINCIPLES[5], // "Consistency before novelty."
  decisions: DOCTRINE_PRINCIPLES[6] // "Design decisions before prompt generation."
} as const;

const pct = (ratio: number): number => round(ratio * 100, 0);

export type RationaleInput = {
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly recipe: DesignRecipe;
  readonly layout: LayoutSystem;
  readonly visualType: VisualType;
  readonly geometry: GeometryResult;
  readonly zones: readonly BlueprintZone[];
  readonly focal: BlueprintFocal;
  readonly readingFlow: BlueprintReadingFlow;
  readonly integratesImage: boolean;
  readonly integrationDeviceName: string | null;
};

export function resolveRationale(input: RationaleInput): BlueprintRationale[] {
  const { contract, recipe, layout, visualType, geometry, zones, focal, readingFlow } = input;
  const out: BlueprintRationale[] = [];
  const label = (id: string): string => ZONE_LABEL[id as keyof typeof ZONE_LABEL] ?? id;
  const focalZone = zones.find((zone) => zone.id === focal.zone);

  // 1 — the focal claim
  if (focalZone) {
    out.push({
      claim: `The ${label(focal.zone)} zone carries the dominant focal claim.`,
      reason: `It is the priority-1 zone and holds the largest planned area (${pct(
        focalZone.area_share
      )}% of the surface).`,
      signal: `recipe.hierarchy.focal_dominance=${focal.dominance}, recipe.hierarchy.levels[${focal.zone}].area_share=${focalZone.area_share}`,
      basis: ["recipe", "dkv"],
      principle: P.hierarchy
    });
  }

  // 2 — reading flow
  out.push({
    claim: `The eye moves ${readingFlow.pattern} from ${label(readingFlow.entry)} to ${label(
      readingFlow.exit
    )}.`,
    reason: `The layout grammar sets a ${readingFlow.pattern} flow and the recipe fixed the reading order across ${readingFlow.path.length} zones.`,
    signal: `recipe.composition.flow=${recipe.composition.flow}, recipe.hierarchy.reading_order=[${readingFlow.path.join(
      ", "
    )}]`,
    basis: ["recipe", "layout"],
    principle: P.function
  });

  // 3 — whitespace / density
  out.push({
    claim: `About ${pct(recipe.composition.whitespace)}% of the surface is kept as clear space.`,
    reason:
      "The recipe's whitespace target is preserved around the primary message so it is not crowded by supporting elements.",
    signal: `recipe.composition.whitespace=${recipe.composition.whitespace}, recipe.composition.density=${recipe.composition.density}`,
    basis: ["recipe", "dkv"],
    principle: P.communication
  });

  // 4 — safe area
  const requiredZones = zones.filter((zone) => zone.required);
  const allRequiredInside = requiredZones.length > 0 && requiredZones.every((zone) => zone.within_safe_area);
  out.push({
    claim: allRequiredInside
      ? `Load-bearing zones stay inside the ${visualType.name} safe area.`
      : `Some load-bearing zones reach the edge of the ${visualType.name} safe area.`,
    reason: visualType.safe_area.reason,
    signal: `visual_type:${visualType.id}.safe_area (top ${visualType.safe_area.top}, bottom ${visualType.safe_area.bottom})`,
    basis: ["visual_type"],
    principle: P.function
  });

  // 5 — grid
  out.push({
    claim: `Every zone snaps to the ${geometry.grid.columns}x${geometry.grid.rows} grid.`,
    reason: `The grid comes from the ${layout.name} layout and the movement's module discipline; zone edges are placed on grid lines, not floated.`,
    signal: `recipe.grid=${geometry.grid.columns}x${geometry.grid.rows} (gutter ${geometry.grid.gutter_ratio}, margin ${geometry.grid.margin_ratio}), layout:${layout.id}`,
    basis: ["recipe", "layout", "geometry"],
    principle: P.consistency
  });

  // 6 — hierarchy strength
  const strength = recipe.hierarchy.strength;
  out.push({
    claim: `Visual hierarchy is enforced at ${pct(strength)}%.`,
    reason:
      strength >= 0.75
        ? "A strong hierarchy means the size and position gaps between ranks are wide and unambiguous."
        : "A moderate hierarchy keeps rank differences readable without a dramatic size jump.",
    signal: `recipe.hierarchy.strength=${strength}`,
    basis: ["dkv"],
    principle: P.hierarchy
  });

  // 7 — objective drives action placement
  const actionZone = zones.find((zone) => zone.id === "cta" || zone.id === "offer");
  if (actionZone) {
    out.push({
      claim: `The ${label(actionZone.id)} zone sits late in the reading order, after the message.`,
      reason: `The ${contract.objective} objective needs the proposition understood before the action is offered.`,
      signal: `contract.objective=${contract.objective}, recipe.hierarchy.reading_order position ${actionZone.reading_index + 1}/${zones.length}`,
      basis: ["objective", "contract"],
      principle: P.communication
    });
  }

  // 8 — arrangement
  out.push({
    claim: `The composition is read as a ${geometry.arrangement.replace("-", " ")} structure.`,
    reason: layout.description,
    signal: `layout:${layout.id}, recipe.composition.strategy=${recipe.composition.strategy}`,
    basis: ["layout", "recipe"],
    principle: P.function
  });

  // 9 — movement grid modularity
  if (geometry.grid.modularity >= 0.7) {
    out.push({
      claim: `The grid keeps modules regular (modularity ${geometry.grid.modularity}).`,
      reason: `The ${recipe.movement.name} movement, which survived doctrine at ${pct(
        recipe.movement.influence
      )}% influence, favours a disciplined modular field.`,
      signal: `recipe.grid.modularity=${geometry.grid.modularity}, recipe.movement.id=${recipe.movement.id}`,
      basis: ["recipe", "direction"],
      principle: P.brand
    });
  }

  // 10 — declared graphic integration
  if (input.integratesImage && input.integrationDeviceName) {
    out.push({
      claim: `The "${input.integrationDeviceName}" graphic device frames or integrates the hero image.`,
      reason:
        "The recipe's graphic treatment already selected this device; the blueprint places the hero as a field the other zones sit over.",
      signal: `recipe.graphic_treatment device "${input.integrationDeviceName}" (purpose: framing / image_integration)`,
      basis: ["graphic_treatment"],
      principle: P.function
    });
  }

  return out;
}
