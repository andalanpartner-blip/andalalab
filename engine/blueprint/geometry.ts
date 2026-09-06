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
  GridCellSpan,
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
 * down). Load-bearing zones are placed inside the CONTENT BOX — the tighter of
 * the layout margin and the platform safe area — and each edge lands on a grid
 * line, so the geometry is both grid-aligned and safe by construction. In a
 * split column the priority-1 (image/hero) zone is allowed to bleed to the
 * margin box.
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
type Placed = { zone: ZoneId; rect: Rect; grid_span: GridCellSpan };

const rectArea = (rect: Rect): number => rect.w * rect.h;

function withinSafeArea(rect: Rect, safe: GeometrySafeArea): boolean {
  return (
    rect.x >= safe.left - EPS &&
    rect.y >= safe.top - EPS &&
    rect.x + rect.w <= 1 - safe.right + EPS &&
    rect.y + rect.h <= 1 - safe.bottom + EPS
  );
}

type Box = { top: number; bottom: number; left: number; right: number };

/** The content box: the tighter of the layout margin and the platform safe area. */
function contentBox(margin: number, safe: GeometrySafeArea): Box {
  return {
    top: Math.max(margin, safe.top),
    bottom: Math.max(margin, safe.bottom),
    left: Math.max(margin, safe.left),
    right: Math.max(margin, safe.right)
  };
}

/**
 * Split `total` integer grid rows among `shares`, each zone getting at least one
 * row, the remainder handed out by largest fractional part (ties → lower index).
 * Deterministic. `total` is assumed `>= shares.length` (the caller guarantees it).
 */
function allocateRows(shares: readonly number[], total: number): number[] {
  const n = shares.length;
  if (n === 0) return [];
  if (total <= n) return shares.map(() => 1);

  const sum = shares.reduce((acc, share) => acc + share, 0) || 1;
  const ideal = shares.map((share) => (share / sum) * (total - n) + 1);
  const alloc = ideal.map((value) => Math.max(1, Math.floor(value)));
  let remainder = total - alloc.reduce((acc, value) => acc + value, 0);

  const byFraction = ideal
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (let cursor = 0; remainder > 0; cursor += 1) {
    const target = byFraction[cursor % n]!.index;
    alloc[target] = alloc[target]! + 1;
    remainder -= 1;
  }
  while (remainder < 0) {
    const largest = alloc
      .map((value, index) => ({ index, value }))
      .filter((entry) => entry.value > 1)
      .sort((a, b) => b.value - a.value || a.index - b.index)[0];
    if (!largest) break;
    alloc[largest.index] = alloc[largest.index]! - 1;
    remainder += 1;
  }
  return alloc;
}

/**
 * Stack `zones` as full-width bands inside a grid-line window
 * [rowStart, rowEnd) x [colStart, colEnd), heights proportional to `shares`.
 * When there are more zones than window rows, band height is compressed evenly
 * and the caller has already recorded a `zone_overflow` issue.
 */
function stackBands(
  zones: readonly ZoneId[],
  shares: readonly number[],
  window: { rowStart: number; rowEnd: number; colStart: number; colEnd: number },
  grid: GeometryGrid
): Placed[] {
  const margin = grid.margin_ratio;
  const usable = 1 - 2 * margin;
  const rowUnit = usable / grid.rows;
  const colUnit = usable / grid.columns;
  const { rowStart, rowEnd, colStart, colEnd } = window;

  const windowRows = rowEnd - rowStart;
  const availRows = Math.max(zones.length, windowRows);
  const bandUnit = (windowRows * rowUnit) / availRows;
  const alloc = allocateRows(shares, availRows);

  const x = round(margin + colStart * colUnit, 6);
  const w = round((colEnd - colStart) * colUnit, 6);
  const top = margin + rowStart * rowUnit;

  let cursor = 0;
  return zones.map((zone, index) => {
    const y = round(top + cursor * bandUnit, 6);
    const h = round(alloc[index]! * bandUnit, 6);
    cursor += alloc[index]!;
    const gridRow = Math.max(0, Math.min(grid.rows - 1, Math.round((y - margin) / rowUnit)));
    return {
      zone,
      rect: { x, y, w, h },
      grid_span: {
        col: colStart,
        row: gridRow,
        cols: colEnd - colStart,
        rows: Math.max(1, Math.min(grid.rows - gridRow, Math.round(h / rowUnit) || 1))
      }
    };
  });
}

function placeStacked(levels: readonly Level[], grid: GeometryGrid, safe: GeometrySafeArea, issues: BlueprintIssue[]): Placed[] {
  const margin = grid.margin_ratio;
  const usable = 1 - 2 * margin;
  const rowUnit = usable / grid.rows;
  const colUnit = usable / grid.columns;
  const box = contentBox(margin, safe);

  // Round toward the interior — a load-bearing band must not straddle the safe edge.
  let rowStart = Math.max(0, Math.min(grid.rows - 1, Math.ceil((box.top - margin) / rowUnit - EPS)));
  let rowEnd = Math.max(rowStart + 1, Math.min(grid.rows, grid.rows - Math.ceil((box.bottom - margin) / rowUnit - EPS)));
  if (rowEnd - rowStart < levels.length) {
    rowStart = 0;
    rowEnd = grid.rows;
  }
  if (rowEnd - rowStart < levels.length) {
    issues.push({
      code: "zone_overflow",
      severity: "P1",
      path: "geometry.bands",
      message:
        "The zone set needs more grid rows than the layout grid provides; band heights were compressed to fit the frame.",
      zone: null
    });
  }
  const colStart = Math.max(0, Math.min(grid.columns - 1, Math.ceil((box.left - margin) / colUnit - EPS)));
  const colEnd = Math.max(colStart + 1, Math.min(grid.columns, grid.columns - Math.ceil((box.right - margin) / colUnit - EPS)));

  return stackBands(
    levels.map((level) => level.zone as ZoneId),
    levels.map((level) => level.area_share),
    { rowStart, rowEnd, colStart, colEnd },
    grid
  );
}

function placeSplitColumn(
  levels: readonly Level[],
  grid: GeometryGrid,
  layout: LayoutSystem,
  safe: GeometrySafeArea,
  issues: BlueprintIssue[]
): Placed[] {
  const margin = grid.margin_ratio;
  const usable = 1 - 2 * margin;
  const colUnit = usable / grid.columns;
  const rowUnit = usable / grid.rows;

  const primary = levels[0]!;
  const primaryCols = Math.max(
    1,
    Math.min(grid.columns - 1, Math.round(Math.min(0.6, Math.max(0.34, clampRatio(primary.area_share))) * grid.columns))
  );
  const flowStartsLeft = layout.flow === "z-pattern" || layout.flow === "f-pattern";
  const primaryColStart = flowStartsLeft ? 0 : grid.columns - primaryCols;

  const primaryRect: Rect = {
    x: round(margin + primaryColStart * colUnit, 6),
    y: round(margin, 6),
    w: round(primaryCols * colUnit, 6),
    h: round(usable, 6)
  };

  const out: Placed[] = [
    {
      zone: primary.zone as ZoneId,
      rect: primaryRect,
      grid_span: { col: primaryColStart, row: 0, cols: primaryCols, rows: grid.rows }
    }
  ];

  const rest = levels.slice(1);
  if (rest.length > 0) {
    const box = contentBox(margin, safe);
    let rowStart = Math.max(0, Math.min(grid.rows - 1, Math.ceil((box.top - margin) / rowUnit - EPS)));
    let rowEnd = Math.max(rowStart + 1, Math.min(grid.rows, grid.rows - Math.ceil((box.bottom - margin) / rowUnit - EPS)));
    if (rowEnd - rowStart < rest.length) {
      rowStart = 0;
      rowEnd = grid.rows;
    }
    if (rowEnd - rowStart < rest.length) {
      issues.push({
        code: "zone_overflow",
        severity: "P1",
        path: "geometry.bands.secondary",
        message:
          "The secondary column needs more grid rows than the layout grid provides; band heights were compressed to fit.",
        zone: null
      });
    }
    const secColStart = flowStartsLeft ? primaryCols : 0;
    const secColEnd = flowStartsLeft ? grid.columns : grid.columns - primaryCols;

    out.push(
      ...stackBands(
        rest.map((level) => level.zone as ZoneId),
        rest.map((level) => level.area_share),
        { rowStart, rowEnd, colStart: secColStart, colEnd: secColEnd },
        grid
      )
    );
  }

  const order = new Map(levels.map((level, index) => [level.zone, index]));
  return out.sort((a, b) => (order.get(a.zone) ?? 0) - (order.get(b.zone) ?? 0));
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
      ? placeSplitColumn(levels, grid, layout, safeArea, issues)
      : placeStacked(levels, grid, safeArea, issues);

  const focalRect = placed[0]?.rect;
  const focalArea = focalRect ? rectArea(focalRect) : 1;

  const bands: ZoneBand[] = placed.map(({ zone, rect, grid_span }) => {
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
      grid_span,
      area_fraction: round(area, 4),
      vs_focal: round(area / (focalArea || 1), 4),
      within_safe_area: withinSafeArea(rect, safeArea)
    };
  });

  return { canvas, grid, safe_area: safeArea, arrangement, bands, issues };
}
