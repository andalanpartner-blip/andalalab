import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { LayoutSystem, ZoneId } from "../../types/schemas/reference/layout.schema";
import type {
  BlueprintFocal,
  BlueprintZone,
  RelationshipKind,
  ZoneRelationship
} from "../../types/schemas/layout-blueprint.schema";
import { round } from "../dkv/params";
import { TEXT_BEARING_ZONES } from "../prompt/text-mode";
import type { GeometryResult, Rect } from "./types";

/**
 * The Layout Blueprint relationship layer (P2.10.4).
 *
 * Pure and deterministic. Every relationship is a projection of geometry
 * and/or an already-resolved recipe signal — never an independent opinion.
 * Each carries a `signal` naming the concrete cause so it can be traced.
 *
 * Kinds emitted:
 *   precedes       — consecutive zones in the reading order
 *   contained_by   — a zone whose rect sits inside the safe area
 *   aligns_with    — every zone, to the grid (grid-snapped by construction)
 *   adjacent_to    — two zones that share a snapped edge
 *   contains       — one zone rect enclosing another (layered case)
 *   overlaps       — a graphic device that integrates the hero with other zones
 *   dominates      — the focal zone over every other zone
 *   contrasts_with — an image/hero zone against an adjacent text zone
 *   depends_on     — a cta / offer zone on the zone ahead of it in the flow
 */

const EPS = 5e-3;

const KIND_ORDER: RelationshipKind[] = [
  "precedes",
  "dominates",
  "contains",
  "contained_by",
  "overlaps",
  "adjacent_to",
  "aligns_with",
  "contrasts_with",
  "depends_on"
];

const edgeEqual = (a: number, b: number): boolean => Math.abs(a - b) < EPS;
const rectArea = (rect: Rect): number => rect.w * rect.h;
const rectContains = (outer: Rect, inner: Rect): boolean =>
  outer.x <= inner.x + EPS &&
  outer.y <= inner.y + EPS &&
  outer.x + outer.w >= inner.x + inner.w - EPS &&
  outer.y + outer.h >= inner.y + inner.h - EPS &&
  rectArea(outer) > rectArea(inner) + EPS;
const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
const rectsAdjacent = (a: Rect, b: Rect): boolean =>
  edgeEqual(a.y + a.h, b.y) ||
  edgeEqual(b.y + b.h, a.y) ||
  edgeEqual(a.x + a.w, b.x) ||
  edgeEqual(b.x + b.w, a.x);

const isText = (zone: ZoneId): boolean => TEXT_BEARING_ZONES.has(zone);
const IMAGE_ZONES: ReadonlySet<ZoneId> = new Set(["image", "hero", "product"]);

export type RelationshipInput = {
  readonly recipe: DesignRecipe;
  readonly layout: LayoutSystem;
  readonly zones: readonly BlueprintZone[];
  readonly geometry: GeometryResult;
  readonly focal: BlueprintFocal;
  /** A graphic-treatment device frames or integrates the hero/image zone. */
  readonly integratesImage: boolean;
  /** The integrating device's id + category, for the `signal`. */
  readonly integrationSignal: string | null;
};

export function resolveRelationships(input: RelationshipInput): ZoneRelationship[] {
  const { recipe, layout, zones, focal, integratesImage, integrationSignal } = input;
  const out: ZoneRelationship[] = [];
  const byId = new Map(zones.map((zone) => [zone.id, zone]));
  const order = zones.map((zone) => zone.id);
  const orderIndex = new Map(order.map((id, index) => [id, index]));

  // precedes — the reading order, pair by pair
  for (let index = 0; index < order.length - 1; index += 1) {
    out.push({
      kind: "precedes",
      from: order[index]!,
      to: order[index + 1]!,
      detail: `${order[index]} is read before ${order[index + 1]} in the resolved reading order.`,
      signal: "recipe.hierarchy.reading_order"
    });
  }

  // dominates — the focal zone over everything else
  const focalZone = byId.get(focal.zone);
  if (focalZone) {
    for (const zone of zones) {
      if (zone.id === focal.zone) continue;
      const ratio = zone.area_share > 0 ? round(focalZone.area_share / zone.area_share, 2) : 0;
      out.push({
        kind: "dominates",
        from: focal.zone,
        to: zone.id,
        detail: `The ${focal.zone} zone dominates ${zone.id} (focal dominance ${round(
          focal.dominance * 100,
          0
        )}%, area ${ratio}x).`,
        signal: `recipe.hierarchy.focal_dominance=${focal.dominance} + area_share ${focalZone.area_share}/${zone.area_share}`
      });
    }
  }

  // containment + overlap (geometry) + declared integration
  for (let a = 0; a < zones.length; a += 1) {
    for (let b = 0; b < zones.length; b += 1) {
      if (a === b) continue;
      const za = zones[a]!;
      const zb = zones[b]!;
      if (rectContains(za.rect, zb.rect)) {
        out.push({
          kind: "contains",
          from: za.id,
          to: zb.id,
          detail: `The ${za.id} zone encloses the ${zb.id} zone.`,
          signal: "geometry: rect containment"
        });
        out.push({
          kind: "contained_by",
          from: zb.id,
          to: za.id,
          detail: `The ${zb.id} zone sits inside the ${za.id} zone.`,
          signal: "geometry: rect containment"
        });
      } else if (a < b && rectsOverlap(za.rect, zb.rect)) {
        out.push({
          kind: "overlaps",
          from: za.id,
          to: zb.id,
          detail: `The ${za.id} and ${zb.id} zones overlap.`,
          signal: "geometry: rect intersection"
        });
      }
    }
  }

  if (integratesImage) {
    const hero = zones.find((zone) => IMAGE_ZONES.has(zone.id));
    if (hero) {
      for (const zone of zones) {
        if (zone.id === hero.id) continue;
        if (out.some((rel) => rel.kind === "overlaps" && rel.from === hero.id && rel.to === zone.id)) {
          continue;
        }
        out.push({
          kind: "overlaps",
          from: hero.id,
          to: zone.id,
          detail: `A graphic device integrates the ${hero.id} field behind the ${zone.id} zone.`,
          signal: integrationSignal ?? "recipe.graphic_treatment image integration"
        });
      }
    }
  }

  // adjacency (shared snapped edge), consecutive zones only to keep it legible
  for (let index = 0; index < zones.length - 1; index += 1) {
    const za = zones[index]!;
    const zb = zones[index + 1]!;
    if (rectsAdjacent(za.rect, zb.rect)) {
      out.push({
        kind: "adjacent_to",
        from: za.id,
        to: zb.id,
        detail: `The ${za.id} and ${zb.id} zones share a grid edge with no gap.`,
        signal: "geometry: shared snapped edge"
      });
    }
  }

  // alignment to the grid — every zone is snapped by construction
  for (const zone of zones) {
    out.push({
      kind: "aligns_with",
      from: zone.id,
      to: "grid",
      detail: `The ${zone.id} zone occupies grid cells [col ${zone.grid_span.col}+${zone.grid_span.cols}, row ${zone.grid_span.row}+${zone.grid_span.rows}].`,
      signal: "geometry: grid-snapped placement"
    });
    if (zone.within_safe_area) {
      out.push({
        kind: "contained_by",
        from: zone.id,
        to: "safe_area",
        detail: `The ${zone.id} zone sits entirely inside the platform safe area.`,
        signal: "geometry: rect within visual_type.safe_area"
      });
    }
  }

  // contrast — figure/ground between an image zone and the nearest text zone
  const imageZone = zones.find((zone) => IMAGE_ZONES.has(zone.id));
  if (imageZone) {
    const textNeighbour = zones
      .filter((zone) => isText(zone.id))
      .sort(
        (x, y) =>
          Math.abs((orderIndex.get(x.id) ?? 0) - (orderIndex.get(imageZone.id) ?? 0)) -
          Math.abs((orderIndex.get(y.id) ?? 0) - (orderIndex.get(imageZone.id) ?? 0))
      )[0];
    if (textNeighbour) {
      out.push({
        kind: "contrasts_with",
        from: imageZone.id,
        to: textNeighbour.id,
        detail: `The ${imageZone.id} field and the ${textNeighbour.id} type read as figure against ground.`,
        signal: `layout:${layout.id} image/type division`
      });
    }
  }

  // dependency — a cta / offer reads only after the zone ahead of it
  for (const zone of zones) {
    if (zone.id !== "cta" && zone.id !== "offer") continue;
    const idx = orderIndex.get(zone.id) ?? 0;
    if (idx <= 0) continue;
    const prior = order[idx - 1]!;
    out.push({
      kind: "depends_on",
      from: zone.id,
      to: prior,
      detail: `The ${zone.id} zone is only meaningful once ${prior} has been read.`,
      signal: `recipe.hierarchy.reading_order + objective:${recipe.objective}`
    });
  }

  return out.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      (orderIndex.get(a.from) ?? 99) - (orderIndex.get(b.from) ?? 99) ||
      String(a.to).localeCompare(String(b.to))
  );
}
