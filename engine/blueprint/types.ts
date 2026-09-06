import type { ZoneId } from "../../types/schemas/reference/layout.schema";
import type { BlueprintIssue } from "../../types/schemas/layout-blueprint.schema";

/**
 * Engine-internal types for the Layout Blueprint resolver (P2.10).
 *
 * These are the intermediate shapes the geometry / zones / relationships /
 * rationale layers pass between each other before `resolveLayoutBlueprint`
 * assembles the public `LayoutBlueprint` artifact.
 */

/** A normalised rectangle in 0..1 canvas space. Origin top-left, y grows down. */
export type Rect = { x: number; y: number; w: number; h: number };

export type GridCellSpan = { col: number; row: number; cols: number; rows: number };

export type BlueprintArrangement = "stacked" | "split-column";

export type GeometryCanvas = {
  visual_type_id: string;
  aspect_ratio_id: string;
  aspect_ratio_label: string;
  width: number;
  height: number;
  orientation: "portrait" | "landscape" | "square";
  ratio: number;
};

export type GeometryGrid = {
  columns: number;
  rows: number;
  gutter_ratio: number;
  margin_ratio: number;
  modularity: number;
  column_width: number;
  row_height: number;
};

export type GeometrySafeArea = { top: number; right: number; bottom: number; left: number };

/** One placed zone rectangle, before roles / labels / relationships are added. */
export type ZoneBand = {
  zone: ZoneId;
  rect: Rect;
  grid_span: GridCellSpan;
  /** Rect area / canvas area. */
  area_fraction: number;
  /** Rect area / focal-zone rect area. */
  vs_focal: number;
  within_safe_area: boolean;
};

export type GeometryResult = {
  canvas: GeometryCanvas;
  grid: GeometryGrid;
  safe_area: GeometrySafeArea;
  arrangement: BlueprintArrangement;
  /** One band per `recipe.hierarchy.levels` entry, in priority (reading) order. */
  bands: readonly ZoneBand[];
  /** Non-fatal geometry problems found while placing zones. */
  issues: readonly BlueprintIssue[];
};
