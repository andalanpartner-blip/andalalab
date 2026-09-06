/**
 * Presentation-only view helpers for the Layout Blueprint stage (UI/UX-02B).
 *
 * Every function here is a pure read over an already-resolved `LayoutBlueprint`.
 * Nothing computes geometry, roles, relationships or rationale — that all
 * happened deterministically in `engine/blueprint/**`. The React layer renders
 * what these return; it never re-derives the blueprint.
 */
import type { LayoutBlueprint } from "../types/schemas/layout-blueprint.schema";
import { percent, titleCase } from "./format";

/** The blueprint was resolved from a recipe whose hash no longer matches the current one. */
export function isBlueprintStale(blueprint: LayoutBlueprint, currentRecipeHash: string): boolean {
  return blueprint.derived_from.recipe_hash !== currentRecipeHash;
}

export type BlueprintMetric = { label: string; value: string };

/** Lightweight metadata for the stage header strip — not a dashboard. */
export function blueprintMetrics(blueprint: LayoutBlueprint): BlueprintMetric[] {
  return [
    { label: "Aspect ratio", value: blueprint.canvas.aspect_ratio_label },
    { label: "Grid", value: `${blueprint.grid.columns} × ${blueprint.grid.rows}` },
    { label: "Zones", value: String(blueprint.zones.length) },
    { label: "Focal dominance", value: percent(blueprint.focal.dominance) },
    { label: "Visual density", value: percent(blueprint.density.visual_density) },
    { label: "Whitespace", value: percent(blueprint.density.whitespace) }
  ];
}

export type ZoneRow = {
  id: string;
  label: string;
  rank: number;
  role: string;
  roleLabel: string;
  areaPct: string;
  required: boolean;
  textBearing: boolean;
  withinSafeArea: boolean;
  readingIndex: number;
};

/** One row per zone, in reading order — the mobile zone list and the desktop legend. */
export function blueprintZoneRows(blueprint: LayoutBlueprint): ZoneRow[] {
  return [...blueprint.zones]
    .sort((a, b) => a.reading_index - b.reading_index)
    .map((zone) => ({
      id: zone.id,
      label: zone.label,
      rank: zone.rank,
      role: zone.role,
      roleLabel: titleCase(zone.role),
      areaPct: percent(zone.area_share),
      required: zone.required,
      textBearing: zone.text_bearing,
      withinSafeArea: zone.within_safe_area,
      readingIndex: zone.reading_index
    }));
}

export type ReadingStep = { step: number; zone: string; label: string };

/** The reading flow as a numbered sequence (mobile) / arrow path (desktop). */
export function readingSequence(blueprint: LayoutBlueprint): ReadingStep[] {
  const labelByZone = new Map(blueprint.zones.map((zone) => [zone.id, zone.label]));
  return blueprint.reading_flow.path.map((zone, index) => ({
    step: index + 1,
    zone,
    label: labelByZone.get(zone) ?? zone
  }));
}

/** The label of the focal zone, e.g. "Hero image". */
export function focalZoneLabel(blueprint: LayoutBlueprint): string {
  return blueprint.zones.find((zone) => zone.id === blueprint.focal.zone)?.label ?? blueprint.focal.zone;
}

/** The compliance-style back-link shown on the Prompt stage. */
export function promptBackLinkLabel(blueprint: LayoutBlueprint): string {
  const n = blueprint.zones.length;
  return `Layout: ${n} zone${n === 1 ? "" : "s"} · focal on ${focalZoneLabel(blueprint).toLowerCase()}`;
}

export type CanvasAnnotation = { from: string; label: string; signal: string };

/**
 * A sparse set of the most communicative relationships to annotate on the
 * schematic — never every relationship (there can be 30+). Kinds are picked in
 * priority order and capped.
 */
export function canvasAnnotations(blueprint: LayoutBlueprint, limit = 3): CanvasAnnotation[] {
  // Only relationships the schematic actually draws — figure/ground and nesting.
  // Declared overlaps / framing from a graphic device are explained in the
  // rationale instead, so the diagram never claims a relationship it isn't showing.
  const priority = ["contrasts_with", "contains"] as const;
  const labelFor: Record<string, (to: string) => string> = {
    contrasts_with: (to) => `vs ${to}`,
    contains: (to) => `holds ${to}`
  };
  const out: CanvasAnnotation[] = [];
  for (const kind of priority) {
    for (const rel of blueprint.relationships) {
      if (rel.kind !== kind) continue;
      out.push({ from: rel.from, label: labelFor[kind]?.(String(rel.to)) ?? kind, signal: rel.signal });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
