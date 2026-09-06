import { describe, expect, it } from "vitest";
import { computeGeometry } from "../../engine/blueprint/geometry";
import {
  ZONE_LABEL,
  resolveFocal,
  resolveReadingFlow,
  resolveZones,
  roleFor
} from "../../engine/blueprint/zones";
import { ZoneId } from "../../types/schemas/reference/layout.schema";
import { BlueprintReadingFlow, BlueprintZone } from "../../types/schemas/layout-blueprint.schema";
import { blueprintInputs, BLUEPRINT_FIXTURES } from "../fixtures/blueprint-inputs";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";

const geo = (name: string) => {
  const i = blueprintInputs(name);
  return computeGeometry({ recipe: i.recipe, visualType: i.visualType, layout: i.layout, aspectRatio: i.aspectRatio });
};

const zonesFor = (name: string, integratesImage = false) => {
  const i = blueprintInputs(name);
  return resolveZones({
    recipe: i.recipe,
    layout: i.layout,
    visualType: i.visualType,
    geometry: geo(name),
    layerContext: { integratesImage }
  });
};

describe("blueprint zones + reading flow (P2.10.3)", () => {
  it("has a label for every zone in the shared vocabulary", () => {
    for (const zone of ZoneId.options) expect(ZONE_LABEL[zone]).toBeTruthy();
  });

  describe("role bucketing is deterministic", () => {
    it("the priority-1 zone is always primary", () => {
      for (const name of BLUEPRINT_FIXTURES) {
        const { recipe } = blueprintInputs(name);
        const first = [...recipe.hierarchy.levels].sort((a, b) => a.priority - b.priority)[0]!;
        expect(roleFor(first)).toBe("primary");
      }
    });

    it("a small required brand mark is utility", () => {
      expect(roleFor({ zone: "brand", priority: 5, area_share: 0.05, required: true })).toBe("utility");
      expect(roleFor({ zone: "footer", priority: 7, area_share: 0.05, required: false })).toBe("utility");
    });

    it("a large early zone is secondary, a late small one is supporting", () => {
      expect(roleFor({ zone: "headline", priority: 2, area_share: 0.18, required: true })).toBe("secondary");
      expect(roleFor({ zone: "data", priority: 6, area_share: 0.05, required: false })).toBe("supporting");
    });
  });

  describe("zone assembly", () => {
    it.each(BLUEPRINT_FIXTURES)("%s — one schema-valid zone per recipe level", (name) => {
      const { zones, issues } = zonesFor(name);
      const { recipe } = blueprintInputs(name);
      expect(zones.map((z) => z.id)).toEqual(recipe.hierarchy.levels.map((l) => l.zone));
      for (const zone of zones) expect(BlueprintZone.safeParse(zone).success).toBe(true);
      // clean fixtures raise no zone issues
      expect(issues.filter((i) => i.severity === "P0")).toHaveLength(0);
    });

    it("carries area_share verbatim (structural) and derives the rest", () => {
      const { zones } = zonesFor("kopi-lawas-promotion");
      const { recipe } = blueprintInputs("kopi-lawas-promotion");
      for (const zone of zones) {
        const level = recipe.hierarchy.levels.find((l) => l.zone === zone.id)!;
        expect(zone.area_share).toBe(level.area_share);
        expect(zone.rank).toBe(level.priority);
        expect(zone.basis).toBe("derived");
      }
    });

    it("dominance is 0..1 and highest for the focal zone", () => {
      for (const name of BLUEPRINT_FIXTURES) {
        const { zones } = zonesFor(name);
        for (const zone of zones) {
          expect(zone.dominance).toBeGreaterThanOrEqual(0);
          expect(zone.dominance).toBeLessThanOrEqual(1);
        }
        const max = Math.max(...zones.map((z) => z.dominance));
        expect(zones.find((z) => z.rank === 1)!.dominance).toBe(max);
      }
    });

    it("layers non-primary zones over the hero only when an integration device is present", () => {
      const flat = zonesFor("story-skincare-launch", false).zones;
      expect(flat.every((z) => z.layer === 0)).toBe(true);
      // with integration + a real geometric overlap the schema still validates
      const layered = zonesFor("story-skincare-launch", true).zones;
      for (const zone of layered) expect(zone.layer).toBeGreaterThanOrEqual(0);
    });

    it("flags a zone the visual type does not allow", () => {
      const i = blueprintInputs("northbeam-saas-launch");
      const recipe = {
        ...i.recipe,
        hierarchy: {
          ...i.recipe.hierarchy,
          levels: i.recipe.hierarchy.levels.map((l, idx) =>
            idx === 0 ? { ...l, zone: "navigation" } : l
          ),
          reading_order: i.recipe.hierarchy.reading_order.map((z, idx) => (idx === 0 ? "navigation" : z))
        }
      } as DesignRecipe;
      const { issues } = resolveZones({
        recipe,
        layout: i.layout,
        visualType: i.visualType,
        geometry: computeGeometry({ recipe, visualType: i.visualType, layout: i.layout, aspectRatio: i.aspectRatio }),
        layerContext: { integratesImage: false }
      });
      expect(issues.some((x) => x.code === "unknown_zone")).toBe(true);
    });
  });

  describe("reading flow", () => {
    it.each(BLUEPRINT_FIXTURES)("%s — pattern + path come straight from the recipe", (name) => {
      const { recipe } = blueprintInputs(name);
      const issues: never[] = [];
      const flow = resolveReadingFlow(recipe, geo(name), issues as unknown as never);
      expect(BlueprintReadingFlow.safeParse(flow).success).toBe(true);
      expect(flow.pattern).toBe(recipe.composition.flow);
      expect(flow.path).toEqual(recipe.hierarchy.reading_order);
      expect(flow.entry).toBe(flow.path[0]);
      expect(flow.exit).toBe(flow.path[flow.path.length - 1]);
      expect(flow.waypoints).toHaveLength(flow.path.length);
    });

    it("raises a P0 issue when the reading order does not match the zone set", () => {
      const i = blueprintInputs("northbeam-saas-launch");
      const recipe = {
        ...i.recipe,
        hierarchy: { ...i.recipe.hierarchy, reading_order: i.recipe.hierarchy.reading_order.slice(0, 2) }
      } as DesignRecipe;
      const issues: { code: string; severity: string }[] = [];
      resolveReadingFlow(recipe, geo("northbeam-saas-launch"), issues as never);
      expect(issues.some((x) => x.code === "reading_order_mismatch" && x.severity === "P0")).toBe(true);
    });
  });

  describe("focal region", () => {
    it.each(BLUEPRINT_FIXTURES)("%s — focal zone is the priority-1 zone, dominance verbatim", (name) => {
      const { recipe } = blueprintInputs(name);
      const issues: never[] = [];
      const focal = resolveFocal(recipe, geo(name), issues as unknown as never);
      const p1 = [...recipe.hierarchy.levels].sort((a, b) => a.priority - b.priority)[0]!;
      expect(focal.zone).toBe(p1.zone);
      expect(focal.dominance).toBe(recipe.hierarchy.focal_dominance);
      expect(focal.x).toBeGreaterThan(0);
      expect(focal.y).toBeGreaterThan(0);
      expect(focal.basis).toBe("structural");
    });
  });

  describe("determinism", () => {
    it.each(BLUEPRINT_FIXTURES)("%s — identical inputs, identical zones", (name) => {
      expect(JSON.stringify(zonesFor(name))).toEqual(JSON.stringify(zonesFor(name)));
    });
  });
});
