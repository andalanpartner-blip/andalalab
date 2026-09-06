import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { LayoutSystem, ZoneId } from "../../types/schemas/reference/layout.schema";
import type { AspectRatio, VisualType } from "../../types/schemas/reference/visual-type.schema";
import type { BlueprintIssue } from "../../types/schemas/layout-blueprint.schema";
import { clampRatio, round } from "../dkv/params";
import type {
  BlueprintArrangement,
  GeometryCanvas,
  GeometryGrid,
  GeometryResult,
  GeometrySafeArea,
  Rect,
  ZoneBand
} from "./types";

/**
 * The Layout Blueprint geometry engine (P2.10.2).
 *
 * Pure, deterministic arithmetic. Given a resolved recipe, visual type, layout
 * and aspect ratio it produces the canonical frame, the grid, the safe area and
 * one candidate rectangle per zone. It makes NO design decision: every number
 * is `recipe.grid`, `recipe.hierarchy`, `recipe.composition`, `visualType` or
 * `aspectRatio`, or a documented function of those.
 *
 * Coordinates are normalised 0..1 in canvas space (origin top-left, y grows
 * down). Zone rectangles are placed inside the margin box and every edge is
 * snapped to a grid line, so the geometry is grid-aligned by construction.
 *
 * No randomness, no clock, no I/O — enforced by the `engine/**` lint boundary.
 */

const EPS = 1e-6;

export type GeometryInput = {
  readonly recipe: DesignRecipe;
  readonly visualType: VisualType;
  readonly layout: LayoutSystem;
  readonly aspectRatio: AspectRatio;
};

// --- frame / grid / safe area ------------------------------------------

export function resolveCanvas(visualType: VisualType, aspectRatio: AspectRatio): GeometryCanvas {
  const { width, height } = aspectRatio;
  const orientation = width > height ? "landscape" : width < height ? "portrait" : "square";
  return {
    visual_type_id: visualType.id,
    aspect_ratio_id: aspectRatio.id,
    aspect_ratio_label: aspectRatio.label,
    width,
    height,
    orientation,
    ratio: round(width / height, 4)
  };
}

export function resolveGrid(recipe: DesignRecipe): GeometryGrid {
  const { columns, rows, gutter_ratio, margin_ratio, modularity } = recipe.grid;
  const usable = 1 - 2 * margin_ratio;
  return {
    columns,
    rows,
    gutter_ratio,
    margin_ratio,
    modularity,
    column_width: round(usable / columns, 4),
    row_height: round(usable / rows, 4)
  };
}

export function resolveSafeArea(visualType: VisualType): GeometrySafeArea {
  const { top, right, bottom, left } = visualType.safe_area;
  return { top, right, bottom, left };
}

/** `image-text-split`, `web-hero-split` → two columns; everything else stacks. */
export function resolveArrangement(layout: LayoutSystem): BlueprintArrangement {
  return layout.id.endsWith("-split") ? "split-column" : "stacked";
}

// --- zone placement --------------------------------------------------

type Level = DesignRecipe["hierarchy"]["levels"][number];

const rectArea = (rect: Rect): number => rect.w * rect.h;

function withinSafeArea(rect: Rect, safe: GeometrySafeArea): boolean {
  return (
    rect.x >= safe.left - EPS &&
    rect.y >= safe.top - EPS &&
    rect.x + rect.w <= 1 - safe.right + EPS &&
    rect.y + rect.h <= 1 - safe.bottom + EPS
  );
}

/**
 * Continuous cumulative band edges (0..extent) for a set of shares, each edge
 * snapped to the nearest grid line and forced strictly monotonic with a
 * one-line minimum gap. Returns `n + 1` edges.
 */
function snappedEdges(
  shares: readonly number[],
  extent: number,
  unit: number,
  issues: BlueprintIssue[],
  path: string
): number[] {
  const total = shares.reduce((sum, share) => sum + share, 0) || 1;
  const raw: number[] = [0];
  let acc = 0;
  for (const share of shares) {
    acc += (share / total) * extent;
    raw.push(acc);
  }
  raw[raw.length - 1] = extent;

  const snapped = raw.map((edge, index) => {
    if (index === 0) return 0;
    if (index === raw.length - 1) return extent;
    return round(Math.round(edge / unit) * unit, 6);
  });

  for (let index = 1; index < snapped.length; index += 1) {
    const floor = snapped[index - 1]! + unit;
    if (snapped[index]! < floor) snapped[index] = round(floor, 6);
  }

  if (snapped[snapped.length - 1]! > extent + EPS) {
    // Too many bands for the row count — pull the tail back onto the grid and
    // record it rather than emitting an invalid rectangle.
    issues.push({
      code: "zone_overflow",
      severity: "P1",
      path,
      message:
        "The zone set needs more grid rows than the layout grid provides; band heights were compressed to fit the frame.",
      zone: null
    });
    for (let index = snapped.length - 1; index >= 1; index -= 1) {
      const ceiling = index === snapped.length - 1 ? extent : snapped[index + 1]! - unit;
      if (snapped[index]! > ceiling) snapped[index] = round(Math.max(0, ceiling), 6);
    }
  }

  return snapped;
}

function spanFor(
  x: number,
  y: number,
  w: number,
  h: number,
  colUnit: number,
  rowUnit: number,
  margin: number,
  columns: number,
  rows: number
) {
  const col = Math.max(0, Math.min(columns - 1, Math.round((x - margin) / colUnit)));
  const row = Math.max(0, Math.min(rows - 1, Math.round((y - margin) / rowUnit)));
  const cols = Math.max(1, Math.min(columns - col, Math.round(w / colUnit)));
  const spanRows = Math.max(1, Math.min(rows - row, Math.round(h / rowUnit)));
  return { col, row, cols, rows: spanRows };
}

function placeStacked(
  levels: readonly Level[],
  grid: GeometryGrid,
  issues: BlueprintIssue[]
): { zone: ZoneId; rect: Rect }[] {
  const margin = grid.margin_ratio;
  const usable = 1 - 2 * margin;
  const rowUnit = usable / grid.rows;
  const edges = snappedEdges(
    levels.map((level) => level.area_share),
    usable,
    rowUnit,
    issues,
    "geometry.bands"
  );

  return levels.map((level, index) => {
    const y = round(margin + edges[index]!, 6);
    const h = round(edges[index + 1]! - edges[index]!, 6);
    return { zone: level.zone as ZoneId, rect: { x: round(margin, 6), y, w: round(usable, 6), h } };
  });
}

function placeSplitColumn(
  levels: readonly Level[],
  grid: GeometryGrid,
  layout: LayoutSystem,
  issues: BlueprintIssue[]
): { zone: ZoneId; rect: Rect }[] {
  const margin = grid.margin_ratio;
  const usableW = 1 - 2 * margin;
  const usableH = 1 - 2 * margin;
  const rowUnit = usableH / grid.rows;

  const primary = levels[0]!;
  const primaryColsFrac = clampRatio(primary.area_share);
  const primaryCols = Math.max(
    1,
    Math.min(grid.columns - 1, Math.round(Math.min(0.6, Math.max(0.34, primaryColsFrac)) * grid.columns))
  );
  const primaryW = round((primaryCols / grid.columns) * usableW, 6);
  const flowStartsLeft = layout.flow === "z-pattern" || layout.flow === "f-pattern";

  const primaryX = round(flowStartsLeft ? margin : margin + usableW - primaryW, 6);
  const secondaryX = round(flowStartsLeft ? margin + primaryW : margin, 6);
  const secondaryW = round(usableW - primaryW, 6);

  const out: { zone: ZoneId; rect: Rect }[] = [
    { zone: primary.zone as ZoneId, rect: { x: primaryX, y: round(margin, 6), w: primaryW, h: round(usableH, 6) } }
  ];

  const rest = levels.slice(1);
  if (rest.length > 0) {
    const edges = snappedEdges(
      rest.map((level) => level.area_share),
      usableH,
      rowUnit,
      issues,
      "geometry.bands.secondary"
    );
    rest.forEach((level, index) => {
      const y = round(margin + edges[index]!, 6);
      const h = round(edges[index + 1]! - edges[index]!, 6);
      out.push({ zone: level.zone as ZoneId, rect: { x: secondaryX, y, w: secondaryW, h } });
    });
  }

  // Restore reading (priority) order.
  const order = new Map(levels.map((level, index) => [level.zone, index]));
  out.sort((a, b) => (order.get(a.zone) ?? 0) - (order.get(b.zone) ?? 0));

  return out;
}

// --- public entry point ---------------------------------------------

export function computeGeometry(input: GeometryInput): GeometryResult {
  const { recipe, visualType, layout, aspectRatio } = input;
  const issues: BlueprintIssue[] = [];

  const canvas = resolveCanvas(visualType, aspectRatio);
  const grid = resolveGrid(recipe);
  const safeArea = resolveSafeArea(visualType);
  const arrangement = resolveArrangement(layout);

  const levels = recipe.hierarchy.levels;
  const shareSum = levels.reduce((sum, level) => sum + level.area_share, 0);
  if (shareSum > 1 + 1e-3) {
    issues.push({
      code: "area_share_exceeds_canvas",
      severity: "P1",
      path: "recipe.hierarchy.levels",
      message: `Zone area shares sum to ${shareSum.toFixed(3)}, above the canvas; band heights were renormalised to fit.`,
      zone: null
    });
  }

  const placed =
    arrangement === "split-column"
      ? placeSplitColumn(levels, grid, layout, issues)
      : placeStacked(levels, grid, issues);

  const margin = grid.margin_ratio;
  const usable = 1 - 2 * margin;
  const colUnit = usable / grid.columns;
  const rowUnit = usable / grid.rows;

  const focalRect = placed[0]?.rect;
  const focalArea = focalRect ? rectArea(focalRect) : 1;

  const bands: ZoneBand[] = placed.map(({ zone, rect }) => {
    const span = spanFor(rect.x, rect.y, rect.w, rect.h, colUnit, rowUnit, margin, grid.columns, grid.rows);
    const area = rectArea(rect);
    if (rect.x + rect.w > 1 + EPS || rect.y + rect.h > 1 + EPS) {
      issues.push({
        code: "zone_overflow",
        severity: "P1",
        path: `geometry.bands[${zone}]`,
        message: `The ${zone} zone rectangle extends past the canvas edge after grid snapping.`,
        zone
      });
    }
    return {
      zone,
      rect,
      grid_span: span,
      area_fraction: round(area, 4),
      vs_focal: round(area / (focalArea || 1), 4),
      within_safe_area: withinSafeArea(rect, safeArea)
    };
  });

  return { canvas, grid, safe_area: safeArea, arrangement, bands, issues };
}
