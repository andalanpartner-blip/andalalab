import { describe, expect, it } from "vitest";
import {
  computeGeometry,
  resolveArrangement,
  resolveCanvas,
  resolveGrid,
  resolveSafeArea
} from "../../engine/blueprint/geometry";
import { blueprintInputs, BLUEPRINT_FIXTURES } from "../fixtures/blueprint-inputs";

const geo = (name: string) => {
  const i = blueprintInputs(name);
  return computeGeometry({
    recipe: i.recipe,
    visualType: i.visualType,
    layout: i.layout,
    aspectRatio: i.aspectRatio
  });
};

describe("blueprint geometry (P2.10.2)", () => {
  describe("canvas", () => {
    it("carries the resolved aspect ratio and derives orientation + ratio", () => {
      const i = blueprintInputs("story-skincare-launch");
      const canvas = resolveCanvas(i.visualType, i.aspectRatio);
      expect(canvas.width).toBe(i.aspectRatio.width);
      expect(canvas.height).toBe(i.aspectRatio.height);
      expect(canvas.orientation).toBe("portrait");
      expect(canvas.ratio).toBeCloseTo(canvas.width / canvas.height, 4);
    });

    it("labels a wide billboard landscape", () => {
      const i = blueprintInputs("ooh-hospitality-billboard");
      expect(resolveCanvas(i.visualType, i.aspectRatio).orientation).toBe("landscape");
    });

    it("labels a square feed square", () => {
      const i = blueprintInputs("northbeam-saas-launch");
      expect(resolveCanvas(i.visualType, i.aspectRatio).orientation).toBe("square");
    });
  });

  describe("grid", () => {
    it("carries recipe grid values verbatim and derives module size", () => {
      const i = blueprintInputs("kopi-lawas-promotion");
      const grid = resolveGrid(i.recipe);
      expect(grid.columns).toBe(i.recipe.grid.columns);
      expect(grid.rows).toBe(i.recipe.grid.rows);
      expect(grid.gutter_ratio).toBe(i.recipe.grid.gutter_ratio);
      expect(grid.margin_ratio).toBe(i.recipe.grid.margin_ratio);
      const usable = 1 - 2 * grid.margin_ratio;
      expect(grid.column_width).toBeCloseTo(usable / grid.columns, 4);
      expect(grid.row_height).toBeCloseTo(usable / grid.rows, 4);
    });
  });

  describe("safe area", () => {
    it("comes straight from the visual type dataset", () => {
      const i = blueprintInputs("story-skincare-launch");
      expect(resolveSafeArea(i.visualType)).toEqual({
        top: i.visualType.safe_area.top,
        right: i.visualType.safe_area.right,
        bottom: i.visualType.safe_area.bottom,
        left: i.visualType.safe_area.left
      });
    });
  });

  describe("arrangement", () => {
    it("splits the two -split layouts and stacks the rest", () => {
      expect(resolveArrangement(blueprintInputs("kopi-lawas-promotion").layout)).toBe(
        blueprintInputs("kopi-lawas-promotion").layout.id.endsWith("-split")
          ? "split-column"
          : "stacked"
      );
      // deterministic string rule
      for (const name of BLUEPRINT_FIXTURES) {
        const { layout } = blueprintInputs(name);
        const expected = layout.id.endsWith("-split") ? "split-column" : "stacked";
        expect(resolveArrangement(layout)).toBe(expected);
      }
    });
  });

  describe("zone placement", () => {
    it.each(BLUEPRINT_FIXTURES)("%s — every band is grid-aligned and inside the canvas", (name) => {
      const result = geo(name);
      const grid = result.grid;
      const margin = grid.margin_ratio;
      const usable = 1 - 2 * margin;
      const rowUnit = usable / grid.rows;

      expect(result.bands.length).toBe(blueprintInputs(name).recipe.hierarchy.levels.length);

      for (const band of result.bands) {
        // inside the canvas
        expect(band.rect.x).toBeGreaterThanOrEqual(-1e-6);
        expect(band.rect.y).toBeGreaterThanOrEqual(-1e-6);
        expect(band.rect.x + band.rect.w).toBeLessThanOrEqual(1 + 1e-6);
        expect(band.rect.y + band.rect.h).toBeLessThanOrEqual(1 + 1e-6);
        // positive area
        expect(band.rect.w).toBeGreaterThan(0);
        expect(band.rect.h).toBeGreaterThan(0);
        // grid-aligned: top edge lands on a row line (within float tolerance)
        const rows = (band.rect.y - margin) / rowUnit;
        expect(Math.abs(rows - Math.round(rows))).toBeLessThan(1e-3);
        // span is consistent
        expect(band.grid_span.cols).toBeGreaterThanOrEqual(1);
        expect(band.grid_span.rows).toBeGreaterThanOrEqual(1);
        expect(band.grid_span.col + band.grid_span.cols).toBeLessThanOrEqual(grid.columns);
        expect(band.grid_span.row + band.grid_span.rows).toBeLessThanOrEqual(grid.rows);
      }
    });

    it("stacked bands follow reading order top to bottom and tile the margin box", () => {
      const result = geo("print-property-brochure");
      expect(result.arrangement).toBe("stacked");
      const order = blueprintInputs("print-property-brochure").recipe.hierarchy.reading_order;
      expect(result.bands.map((b) => b.zone)).toEqual(order);

      const margin = result.grid.margin_ratio;
      let cursor = margin;
      for (const band of result.bands) {
        expect(band.rect.y).toBeCloseTo(cursor, 4);
        cursor = band.rect.y + band.rect.h;
      }
      expect(cursor).toBeCloseTo(1 - margin, 4);
    });

    it("split-column places the priority-1 zone as a full-height column", () => {
      const inputs = blueprintInputs("kopi-lawas-promotion");
      if (resolveArrangement(inputs.layout) !== "split-column") return;
      const result = geo("kopi-lawas-promotion");
      const primaryZone = inputs.recipe.hierarchy.levels[0]!.zone;
      const primary = result.bands.find((b) => b.zone === primaryZone)!;
      const margin = result.grid.margin_ratio;
      expect(primary.rect.h).toBeCloseTo(1 - 2 * margin, 3);
      expect(primary.rect.w).toBeLessThan(1 - 2 * margin);
    });

    it("focal band area fraction and vs_focal are reported", () => {
      const result = geo("northbeam-saas-launch");
      expect(result.bands[0]!.vs_focal).toBeCloseTo(1, 4);
      for (const band of result.bands) {
        expect(band.area_fraction).toBeGreaterThan(0);
        expect(band.area_fraction).toBeLessThanOrEqual(1);
      }
    });

    it("flags within_safe_area per band", () => {
      const result = geo("story-skincare-launch");
      // the tall story frame has a deep bottom safe band — the last utility zone
      // typically sits at the very bottom and may breach it; the flag must exist
      for (const band of result.bands) {
        expect(typeof band.within_safe_area).toBe("boolean");
      }
    });
  });

  describe("determinism", () => {
    it.each(BLUEPRINT_FIXTURES)("%s — identical inputs produce a byte-identical geometry", (name) => {
      expect(JSON.stringify(geo(name))).toEqual(JSON.stringify(geo(name)));
    });
  });

  describe("no design decisions beyond resolved signals", () => {
    it("does not touch DKV values or invent zones", () => {
      const inputs = blueprintInputs("kopi-lawas-promotion");
      const result = geo("kopi-lawas-promotion");
      const recipeZones = new Set(inputs.recipe.hierarchy.levels.map((l) => l.zone));
      for (const band of result.bands) expect(recipeZones.has(band.zone)).toBe(true);
      expect(result.bands.length).toBe(recipeZones.size);
    });
  });
});
