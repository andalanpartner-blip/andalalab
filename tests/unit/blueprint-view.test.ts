import { describe, expect, it } from "vitest";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { datasets } from "../fixtures/load";
import { blueprintInputs, BLUEPRINT_FIXTURES } from "../fixtures/blueprint-inputs";
import {
  blueprintMetrics,
  blueprintZoneRows,
  canvasAnnotations,
  focalZoneLabel,
  isBlueprintStale,
  promptBackLinkLabel,
  readingSequence
} from "../../lib/blueprint-view";
import { percent } from "../../lib/format";
import type { LayoutBlueprint } from "../../types/schemas/layout-blueprint.schema";

/**
 * UI/UX-02B — the view layer for the Layout stage is pure functions over an
 * already-resolved blueprint. These prove the UI reads the blueprint and never
 * re-derives design values.
 */

function bp(name: string): LayoutBlueprint {
  const i = blueprintInputs(name);
  const r = resolveLayoutBlueprint({
    recipe: i.recipe,
    contract: i.contract,
    direction: i.direction,
    datasets
  });
  if (!r.ok) throw new Error("blueprint resolve failed");
  return r.value;
}

describe("blueprint-view helpers", () => {
  it.each(BLUEPRINT_FIXTURES)("%s — zone rows mirror blueprint.zones exactly, no recomputation", (name) => {
    const blueprint = bp(name);
    const rows = blueprintZoneRows(blueprint);
    expect(rows).toHaveLength(blueprint.zones.length);

    for (const row of rows) {
      const zone = blueprint.zones.find((z) => z.id === row.id)!;
      expect(row.rank).toBe(zone.rank); // carried, not derived
      expect(row.role).toBe(zone.role);
      expect(row.required).toBe(zone.required);
      expect(row.areaPct).toBe(percent(zone.area_share));
      expect(row.withinSafeArea).toBe(zone.within_safe_area);
    }
    // ordered by reading index
    expect(rows.map((r) => r.readingIndex)).toEqual([...rows.map((r) => r.readingIndex)].sort((a, b) => a - b));
  });

  it.each(BLUEPRINT_FIXTURES)("%s — reading sequence is the blueprint reading path, numbered", (name) => {
    const blueprint = bp(name);
    const seq = readingSequence(blueprint);
    expect(seq.map((s) => s.zone)).toEqual(blueprint.reading_flow.path);
    expect(seq.map((s) => s.step)).toEqual(blueprint.reading_flow.path.map((_, i) => i + 1));
  });

  it.each(BLUEPRINT_FIXTURES)("%s — metrics are read straight off the blueprint", (name) => {
    const blueprint = bp(name);
    const metrics = blueprintMetrics(blueprint);
    const byLabel = Object.fromEntries(metrics.map((m) => [m.label, m.value]));
    expect(byLabel["Zones"]).toBe(String(blueprint.zones.length));
    expect(byLabel["Grid"]).toBe(`${blueprint.grid.columns} × ${blueprint.grid.rows}`);
    expect(byLabel["Aspect ratio"]).toBe(blueprint.canvas.aspect_ratio_label);
    expect(byLabel["Focal dominance"]).toBe(percent(blueprint.focal.dominance));
    expect(byLabel["Whitespace"]).toBe(percent(blueprint.density.whitespace));
  });

  it("focal zone label and the prompt back-link name the blueprint focal zone", () => {
    const blueprint = bp("northbeam-saas-launch");
    const label = focalZoneLabel(blueprint);
    expect(label).toBe(blueprint.zones.find((z) => z.id === blueprint.focal.zone)!.label);
    const link = promptBackLinkLabel(blueprint);
    expect(link).toContain(`${blueprint.zones.length} zones`);
    expect(link).toContain(label.toLowerCase());
  });

  it("canvas annotations only surface relationships that exist on the blueprint, capped", () => {
    for (const name of BLUEPRINT_FIXTURES) {
      const blueprint = bp(name);
      const anns = canvasAnnotations(blueprint, 4);
      expect(anns.length).toBeLessThanOrEqual(4);
      for (const ann of anns) {
        expect(blueprint.relationships.some((r) => r.from === ann.from && r.signal === ann.signal)).toBe(true);
      }
    }
  });

  describe("stale detection", () => {
    it("is fresh when the current recipe hash matches derived_from", () => {
      const blueprint = bp("kopi-lawas-promotion");
      expect(isBlueprintStale(blueprint, blueprint.derived_from.recipe_hash)).toBe(false);
    });

    it("is stale when the current recipe hash differs (e.g. after a correction)", () => {
      const blueprint = bp("kopi-lawas-promotion");
      expect(isBlueprintStale(blueprint, "ffffffff")).toBe(true);
    });
  });

  it("does not duplicate blueprint design logic — no geometry, roles or rationale are computed here", () => {
    const blueprint = bp("story-skincare-launch");
    // rationale is passed through verbatim by the component; the helper set here
    // exposes only reads. Assert the helpers never invent a zone or a role value.
    const rows = blueprintZoneRows(blueprint);
    const validRoles = new Set(["primary", "secondary", "supporting", "utility"]);
    for (const row of rows) expect(validRoles.has(row.role)).toBe(true);
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(blueprint.zones.map((z) => z.id)));
  });
});
