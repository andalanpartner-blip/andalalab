import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { LayoutSystem, ZoneId } from "../../types/schemas/reference/layout.schema";
import type { VisualType } from "../../types/schemas/reference/visual-type.schema";
import type {
  BlueprintFocal,
  BlueprintIssue,
  BlueprintReadingFlow,
  BlueprintZone,
  ZoneRole
} from "../../types/schemas/layout-blueprint.schema";
import { clampRatio, round } from "../dkv/params";
import { TEXT_BEARING_ZONES } from "../prompt/text-mode";
import type { GeometryResult, Rect } from "./types";

/**
 * The Layout Blueprint zone + reading-flow layer (P2.10.3).
 *
 * Pure and deterministic. It takes the zone set the recipe already selected
 * (`recipe.hierarchy.levels`, itself derived from the layout grammar) and the
 * geometry from P2.10.2, and adds the semantic layer: label, role, text-bearing
 * flag, display dominance, z-layer, plus the reading flow and the focal region.
 *
 * It selects NO zones of its own — a zone that is not in `recipe.hierarchy`
 * cannot appear, and a zone the visual type disallows produces an issue rather
 * than a silent drop or a repair.
 */

/** Human labels for the shared 11-value ZoneId vocabulary. */
export const ZONE_LABEL: Record<ZoneId, string> = {
  hero: "Hero image",
  headline: "Headline",
  body: "Body copy",
  product: "Product",
  image: "Image",
  offer: "Offer",
  data: "Data",
  cta: "Call to action",
  brand: "Brand",
  navigation: "Navigation",
  footer: "Footer"
};

type Level = DesignRecipe["hierarchy"]["levels"][number];

const rectCentre = (rect: Rect): { x: number; y: number } => ({
  x: round(rect.x + rect.w / 2, 4),
  y: round(rect.y + rect.h / 2, 4)
});

const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w - 1e-6 &&
  a.x + a.w > b.x + 1e-6 &&
  a.y < b.y + b.h - 1e-6 &&
  a.y + a.h > b.y + 1e-6;

const isText = (zone: ZoneId): boolean => TEXT_BEARING_ZONES.has(zone);

/** Structural marks that carry no primary content — always utility below priority 1. */
const UTILITY_ZONES: ReadonlySet<ZoneId> = new Set(["brand", "footer"]);

/** Compositional weight, bucketed from priority + area share. Deterministic. */
export function roleFor(level: Level): ZoneRole {
  const zone = level.zone as ZoneId;
  if (level.priority === 1) return "primary";
  if (UTILITY_ZONES.has(zone)) return "utility";
  if ((zone === "cta" || zone === "navigation") && level.area_share < 0.1) return "utility";
  if (level.priority <= 3 && level.area_share >= 0.1) return "secondary";
  return "supporting";
}

/**
 * Display dominance 0..1: a blend of relative rect area and reading rank, with
 * a small focal boost for the priority-1 zone. A derived UI hint — never fed
 * back into the recipe.
 */
function dominanceFor(
  level: Level,
  areaFraction: number,
  areaFractionSum: number,
  readingIndex: number,
  zoneCount: number,
  focalDominance: number
): number {
  const areaComponent = areaFractionSum > 0 ? areaFraction / areaFractionSum : 0;
  const rankTotal = (zoneCount * (zoneCount + 1)) / 2;
  const rankComponent = rankTotal > 0 ? (zoneCount - readingIndex) / rankTotal : 0;
  const focalBoost = level.priority === 1 ? 0.1 * focalDominance : 0;
  return clampRatio(round(0.6 * areaComponent + 0.4 * rankComponent + focalBoost, 4));
}

export type ZoneLayerContext = {
  /** True when a graphic-treatment device integrates or frames the hero/image zone. */
  readonly integratesImage: boolean;
};

function layerFor(zone: ZoneId, bands: GeometryResult["bands"], ctx: ZoneLayerContext): number {
  if (!ctx.integratesImage) return 0;
  if (zone === "image" || zone === "hero") return 0;
  const integrated = bands.find((band) => band.zone === "image" || band.zone === "hero");
  const self = bands.find((band) => band.zone === zone);
  if (integrated && self && rectsOverlap(self.rect, integrated.rect)) return 1;
  return 0;
}

// --- reading flow + focal ---------------------------------------------

export function resolveReadingFlow(
  recipe: DesignRecipe,
  geometry: GeometryResult,
  issues: BlueprintIssue[]
): BlueprintReadingFlow {
  const present = new Set(geometry.bands.map((band) => band.zone));
  const path = recipe.hierarchy.reading_order.filter((zone) => present.has(zone as ZoneId)) as ZoneId[];

  const orderMatches =
    recipe.hierarchy.reading_order.length === recipe.hierarchy.levels.length &&
    recipe.hierarchy.reading_order.every((zone) =>
      recipe.hierarchy.levels.some((level) => level.zone === zone)
    );
  if (!orderMatches) {
    issues.push({
      code: "reading_order_mismatch",
      severity: "P0",
      path: "recipe.hierarchy.reading_order",
      message:
        "The recipe reading order does not match its own zone set; the blueprint cannot derive a trustworthy reading flow.",
      zone: null
    });
  }

  const byZone = new Map(geometry.bands.map((band) => [band.zone, band]));
  const waypoints = path.map((zone) => {
    const centre = rectCentre(byZone.get(zone)!.rect);
    return { zone, x: centre.x, y: centre.y };
  });

  return {
    pattern: recipe.composition.flow,
    path,
    entry: path[0]!,
    exit: path[path.length - 1]!,
    waypoints,
    basis: "derived",
    source: "recipe.composition.flow + recipe.hierarchy.reading_order"
  };
}

export function resolveFocal(
  recipe: DesignRecipe,
  geometry: GeometryResult,
  issues: BlueprintIssue[]
): BlueprintFocal {
  const focalLevel = [...recipe.hierarchy.levels].sort((a, b) => a.priority - b.priority)[0];
  const band = focalLevel
    ? geometry.bands.find((entry) => entry.zone === focalLevel.zone)
    : undefined;

  if (!focalLevel || !band) {
    issues.push({
      code: "focal_zone_missing",
      severity: "P0",
      path: "recipe.hierarchy.levels",
      message: "No priority-1 zone could be identified for the focal region.",
      zone: null
    });
    const fallback = geometry.bands[0];
    return {
      zone: (fallback?.zone ?? "headline") as ZoneId,
      x: fallback ? rectCentre(fallback.rect).x : 0.5,
      y: fallback ? rectCentre(fallback.rect).y : 0.5,
      dominance: recipe.hierarchy.focal_dominance,
      basis: "derived",
      source: "recipe.hierarchy (focal zone missing — fell back to first band)"
    };
  }

  const centre = rectCentre(band.rect);
  return {
    zone: focalLevel.zone as ZoneId,
    x: centre.x,
    y: centre.y,
    dominance: recipe.hierarchy.focal_dominance,
    basis: "structural",
    source: "recipe.hierarchy.focal_dominance + geometry.bands[focal]"
  };
}

// --- zone assembly --------------------------------------------------

export type ResolveZonesInput = {
  readonly recipe: DesignRecipe;
  readonly layout: LayoutSystem;
  readonly visualType: VisualType;
  readonly geometry: GeometryResult;
  readonly layerContext: ZoneLayerContext;
};

export function resolveZones(input: ResolveZonesInput): {
  zones: BlueprintZone[];
  issues: BlueprintIssue[];
} {
  const { recipe, layout, visualType, geometry, layerContext } = input;
  const issues: BlueprintIssue[] = [];

  const allowed = new Set<string>(visualType.allowed_zones);
  for (const required of visualType.required_zones) {
    if (!recipe.hierarchy.levels.some((level) => level.zone === required)) {
      issues.push({
        code: "unknown_zone",
        severity: "P1",
        path: `visual_type:${visualType.id}.required_zones`,
        message: `The visual type requires a "${required}" zone but the recipe hierarchy has none.`,
        zone: required
      });
    }
  }

  const bandByZone = new Map(geometry.bands.map((band) => [band.zone, band]));
  const readingIndex = new Map<string, number>(
    recipe.hierarchy.reading_order.map((zone, index) => [zone, index])
  );
  const areaFractionSum = geometry.bands.reduce((sum, band) => sum + band.area_fraction, 0);
  const zoneCount = recipe.hierarchy.levels.length;

  const zones: BlueprintZone[] = recipe.hierarchy.levels.map((level) => {
    const zone = level.zone as ZoneId;
    const band = bandByZone.get(zone);
    const idx = readingIndex.get(zone) ?? level.priority - 1;

    if (!allowed.has(zone)) {
      issues.push({
        code: "unknown_zone",
        severity: "P1",
        path: `recipe.hierarchy.levels[${zone}]`,
        message: `The recipe places a "${zone}" zone that the "${visualType.id}" visual type does not allow.`,
        zone
      });
    }

    const rect = band?.rect ?? { x: 0, y: 0, w: 1, h: 1 };
    const label = ZONE_LABEL[zone] ?? zone;

    return {
      id: zone,
      label,
      role: roleFor(level),
      rank: level.priority,
      reading_index: idx,
      required: level.required,
      text_bearing: isText(zone),
      area_share: level.area_share,
      rect,
      grid_span: band?.grid_span ?? { col: 0, row: 0, cols: geometry.grid.columns, rows: geometry.grid.rows },
      layer: layerFor(zone, geometry.bands, layerContext),
      dominance: dominanceFor(
        level,
        band?.area_fraction ?? 0,
        areaFractionSum,
        idx,
        zoneCount,
        recipe.hierarchy.focal_dominance
      ),
      within_safe_area: band?.within_safe_area ?? false,
      basis: "derived",
      source: `recipe.hierarchy.levels[${zone}] + layout:${layout.id}`
    };
  });

  return { zones, issues };
}
