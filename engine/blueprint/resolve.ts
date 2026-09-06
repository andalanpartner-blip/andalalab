import type { DatasetRegistry } from "../../types/datasets";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type { DesignDirection } from "../../types/schemas/direction.schema";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { BlueprintIssue, LayoutBlueprint } from "../../types/schemas/layout-blueprint.schema";
import { LayoutBlueprint as LayoutBlueprintSchema } from "../../types/schemas/layout-blueprint.schema";
import { SCHEMA_VERSIONS } from "../../types/versions";
import { canonicalise, fnv1a } from "../../types/primitives";
import { deepFreeze } from "../../domain/contract";
import { selectedCandidate } from "../decision/resolve";
import { round } from "../dkv/params";
import { err, ok, type Result } from "../util/result";
import { computeGeometry } from "./geometry";
import { resolveFocal, resolveReadingFlow, resolveZones } from "./zones";
import { resolveRelationships } from "./relationships";
import { resolveRationale } from "./rationale";
import { detectImageIntegration } from "./signals";

/**
 * The canonical Layout Blueprint resolver (P2.10.5).
 *
 * `DesignRecipe + DesignContract + DesignDirection + datasets → LayoutBlueprint`.
 *
 * Pure and deterministic. It does NOT silently repair invalid input: an id
 * mismatch, a missing dataset reference, an empty zone set or a reading order
 * that contradicts the zone set returns `err([...])` with explicit issues.
 * Advisory problems (a required zone reaching the safe-area edge, a geometry
 * overflow) ride on `blueprint.issues` and the blueprint is still returned so
 * the problem is visible.
 *
 * Same recipe + same `dataset_version` + same `RESOLVER_VERSION` ⇒ byte-identical
 * blueprint and `blueprint_hash`. `Math.random`, `Date` and model calls are
 * forbidden by the `engine/**` lint boundary.
 */

export const RESOLVER_VERSION = "1.0.0";

export type ResolveBlueprintInput = {
  readonly recipe: DesignRecipe;
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly datasets: DatasetRegistry;
};

const pct = (ratio: number): number => round(ratio * 100, 0);

export function resolveLayoutBlueprint(
  input: ResolveBlueprintInput
): Result<LayoutBlueprint, BlueprintIssue[]> {
  const { recipe, contract, direction, datasets } = input;
  const fatal: BlueprintIssue[] = [];

  // --- linkage ------------------------------------------------------
  if (recipe.contract_id !== contract.id) {
    fatal.push({
      code: "recipe_contract_mismatch",
      severity: "P0",
      path: "recipe.contract_id",
      message: `The recipe was built for contract ${recipe.contract_id}, not ${contract.id}.`,
      zone: null
    });
  }
  if (recipe.direction_id !== direction.id) {
    fatal.push({
      code: "recipe_direction_mismatch",
      severity: "P0",
      path: "recipe.direction_id",
      message: `The recipe references direction ${recipe.direction_id}, not ${direction.id}.`,
      zone: null
    });
  }
  if (fatal.length > 0) return err(fatal);

  // --- resolved references ----------------------------------------
  const layoutId = selectedCandidate(direction).candidate.layout_id;
  const visualType = datasets.visualTypes.get(contract.visual_type.id) ?? null;
  const layout = datasets.layouts.get(layoutId) ?? null;

  if (!visualType) {
    fatal.push({
      code: "missing_visual_type",
      severity: "P0",
      path: "contract.visual_type.id",
      message: `Visual type "${contract.visual_type.id}" is not in dataset ${datasets.version}.`,
      zone: null
    });
  }
  if (!layout) {
    fatal.push({
      code: "missing_layout",
      severity: "P0",
      path: "direction.selected_candidate.layout_id",
      message: `Layout "${layoutId}" is not in dataset ${datasets.version}.`,
      zone: null
    });
  }
  if (!visualType || !layout) return err(fatal);

  const aspectRatio =
    visualType.aspect_ratios.find((ratio) => ratio.id === contract.visual_type.aspect_ratio_id) ??
    null;
  if (!aspectRatio) {
    return err([
      {
        code: "missing_aspect_ratio",
        severity: "P0",
        path: "contract.visual_type.aspect_ratio_id",
        message: `Aspect ratio "${contract.visual_type.aspect_ratio_id}" is not defined on visual type "${visualType.id}".`,
        zone: null
      }
    ]);
  }

  if (recipe.hierarchy.levels.length === 0) {
    return err([
      {
        code: "empty_zone_set",
        severity: "P0",
        path: "recipe.hierarchy.levels",
        message: "The recipe hierarchy has no zones; there is nothing to lay out.",
        zone: null
      }
    ]);
  }

  // --- derivation -------------------------------------------------
  const issues: BlueprintIssue[] = [];
  const geometry = computeGeometry({ recipe, visualType, layout, aspectRatio });
  issues.push(...geometry.issues);

  const integration = detectImageIntegration(recipe);

  const { zones, issues: zoneIssues } = resolveZones({
    recipe,
    layout,
    visualType,
    geometry,
    layerContext: { integratesImage: integration.integrates }
  });
  issues.push(...zoneIssues);

  const readingFlow = resolveReadingFlow(recipe, geometry, issues);
  const focal = resolveFocal(recipe, geometry, issues);

  // An image / hero / product field is allowed to bleed; a text or brand mark is not.
  const BLEED_OK = new Set(["image", "hero", "product"]);
  for (const zone of zones) {
    if (zone.required && !zone.within_safe_area && !BLEED_OK.has(zone.id)) {
      issues.push({
        code: "zone_out_of_safe_area",
        severity: "P1",
        path: `zones[${zone.id}]`,
        message: `The required ${zone.id} zone reaches past the ${visualType.name} safe area and may be cropped or covered.`,
        zone: zone.id
      });
    }
  }

  // A P0 issue from derivation is a structural contradiction, not an advisory.
  const derivationP0 = issues.filter((issue) => issue.severity === "P0");
  if (derivationP0.length > 0) return err(derivationP0);

  const relationships = resolveRelationships({
    recipe,
    layout,
    zones,
    geometry,
    focal,
    integratesImage: integration.integrates,
    integrationSignal: integration.signal
  });

  const rationale = resolveRationale({
    contract,
    direction,
    recipe,
    layout,
    visualType,
    geometry,
    zones,
    focal,
    readingFlow,
    integratesImage: integration.integrates,
    integrationDeviceName: integration.deviceName
  });

  // --- constraints + anchors -------------------------------------
  const hasRequiredText = zones.some((zone) => zone.required && zone.text_bearing);
  const constraints: LayoutBlueprint["constraints"] = [
    {
      kind: "safe_area",
      statement: `Load-bearing zones stay inside the ${visualType.name} safe area.`,
      source: `visual_type:${visualType.id}.safe_area`
    },
    {
      kind: "focal",
      statement: `One dominant focal zone (${focal.zone}) at ${pct(focal.dominance)}% dominance.`,
      source: "recipe.hierarchy.focal_dominance"
    },
    {
      kind: "aspect_ratio",
      statement: `Composed for ${aspectRatio.label} (${aspectRatio.width}x${aspectRatio.height}).`,
      source: `visual_type:${visualType.id} aspect ratio`
    },
    {
      kind: "grid",
      statement: `Every zone aligns to a ${geometry.grid.columns}x${geometry.grid.rows} grid.`,
      source: `recipe.grid + layout:${layout.id}`
    }
  ];
  if (hasRequiredText) {
    constraints.push({
      kind: "text_zone",
      statement:
        "Text-bearing zones are reserved as clean typographic space; final copy is set in a later pass.",
      source: "recipe.hierarchy + engine/prompt/text-mode"
    });
  }

  const anchorValue = (kind: string): string | null =>
    recipe.anchors.find((anchor) => anchor.kind === kind)?.value ?? null;

  const anchors: LayoutBlueprint["anchors"] = [];
  const pvd = anchorValue("primary_visual_direction");
  if (pvd) {
    anchors.push({
      kind: "primary_visual_direction",
      value: pvd,
      source: "recipe.anchors[primary_visual_direction]"
    });
  }
  const conceptAnchor = anchorValue("concept");
  if (conceptAnchor) {
    anchors.push({ kind: "concept", value: conceptAnchor, source: "recipe.anchors[concept]" });
  }
  anchors.push({
    kind: "grid",
    value: `${geometry.grid.columns}x${geometry.grid.rows}`,
    source: "recipe.grid"
  });
  anchors.push({
    kind: "focal_zone",
    value: focal.zone,
    source: "recipe.hierarchy.levels[priority=1]"
  });

  // --- assembly + hash -----------------------------------------
  const sortedIssues = [...issues].sort(
    (a, b) =>
      ({ P0: 0, P1: 1, P2: 2 })[a.severity] - ({ P0: 0, P1: 1, P2: 2 })[b.severity] ||
      a.code.localeCompare(b.code) ||
      a.path.localeCompare(b.path)
  );

  const body = {
    schema_version: SCHEMA_VERSIONS.layoutBlueprint,
    resolver_version: RESOLVER_VERSION,
    dataset_version: datasets.version,
    mode: "schematic" as const,
    provenance: {
      recipe_id: recipe.id,
      recipe_hash: recipe.recipe_hash,
      contract_id: contract.id,
      direction_id: direction.id,
      concept_ref: recipe.concept_ref,
      layout_id: layout.id,
      visual_type_id: visualType.id,
      objective: recipe.objective
    },
    canvas: { ...geometry.canvas, channel: recipe.platform.channel, basis: "structural" as const },
    grid: {
      ...geometry.grid,
      basis: "structural" as const,
      source: `layout:${layout.id} + movement:${recipe.movement.id}`
    },
    safe_area: {
      ...geometry.safe_area,
      basis: "structural" as const,
      source: `visual_type:${visualType.id}.safe_area`
    },
    layout_strategy: {
      composition_strategy: recipe.composition.strategy,
      balance: recipe.composition.balance,
      arrangement: geometry.arrangement,
      spatial_behavior: recipe.composition.spatial_behavior,
      basis: "structural" as const,
      source: "recipe.composition"
    },
    zones,
    reading_flow: readingFlow,
    focal,
    relationships,
    hierarchy: {
      strength: recipe.hierarchy.strength,
      focal_dominance: recipe.hierarchy.focal_dominance,
      reading_order: readingFlow.path,
      basis: "structural" as const,
      source: "recipe.hierarchy"
    },
    density: {
      visual_density: recipe.composition.density,
      whitespace: recipe.composition.whitespace,
      basis: "structural" as const,
      source: "recipe.composition"
    },
    constraints,
    anchors,
    rationale,
    issues: sortedIssues,
    unassessed: [] as string[]
  };

  const blueprint = { ...body, blueprint_hash: fnv1a(canonicalise(body)) };

  const validated = LayoutBlueprintSchema.safeParse(blueprint);
  if (!validated.success) {
    return err(
      validated.error.issues.map((problem) => ({
        code: "blueprint_invalid" as const,
        severity: "P0" as const,
        path: problem.path.join(".") || "(root)",
        message: `Assembled blueprint failed its own schema: ${problem.message}`,
        zone: null
      }))
    );
  }

  return ok(deepFreeze(validated.data));
}
