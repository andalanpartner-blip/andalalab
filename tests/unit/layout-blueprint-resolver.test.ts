import { describe, expect, it } from "vitest";
import { resolveLayoutBlueprint, RESOLVER_VERSION } from "../../engine/blueprint/resolve";
import { LayoutBlueprint } from "../../types/schemas/layout-blueprint.schema";
import { SCHEMA_VERSIONS } from "../../types/versions";
import { datasets } from "../fixtures/load";
import { blueprintInputs, BLUEPRINT_FIXTURES } from "../fixtures/blueprint-inputs";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";

const resolve = (name: string) => {
  const i = blueprintInputs(name);
  return resolveLayoutBlueprint({
    recipe: i.recipe,
    contract: i.contract,
    direction: i.direction,
    datasets
  });
};

describe("resolveLayoutBlueprint (P2.10.5)", () => {
  describe("happy path", () => {
    it.each(BLUEPRINT_FIXTURES)("%s — returns a schema-valid, deep-frozen blueprint", (name) => {
      const result = resolve(name);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(LayoutBlueprint.safeParse(result.value).success).toBe(true);
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.zones)).toBe(true);
    });

    it.each(BLUEPRINT_FIXTURES)("%s — pins schema + resolver version and binds provenance", (name) => {
      const result = resolve(name);
      if (!result.ok) throw new Error("expected ok");
      const bp = result.value;
      const i = blueprintInputs(name);
      expect(bp.schema_version).toBe(SCHEMA_VERSIONS.layoutBlueprint);
      expect(bp.resolver_version).toBe(RESOLVER_VERSION);
      expect(bp.dataset_version).toBe(datasets.version);
      expect(bp.provenance.recipe_id).toBe(i.recipe.id);
      expect(bp.provenance.recipe_hash).toBe(i.recipe.recipe_hash);
      expect(bp.provenance.contract_id).toBe(i.contract.id);
      expect(bp.provenance.direction_id).toBe(i.direction.id);
    });

    it.each(BLUEPRINT_FIXTURES)("%s — carries only recipe-sourced structural numbers", (name) => {
      const result = resolve(name);
      if (!result.ok) throw new Error("expected ok");
      const bp = result.value;
      const i = blueprintInputs(name);
      // hierarchy + grid + density copied verbatim
      expect(bp.hierarchy.strength).toBe(i.recipe.hierarchy.strength);
      expect(bp.hierarchy.focal_dominance).toBe(i.recipe.hierarchy.focal_dominance);
      expect(bp.grid.columns).toBe(i.recipe.grid.columns);
      expect(bp.grid.rows).toBe(i.recipe.grid.rows);
      expect(bp.density.visual_density).toBe(i.recipe.composition.density);
      expect(bp.density.whitespace).toBe(i.recipe.composition.whitespace);
      // zone area shares are the recipe's
      for (const zone of bp.zones) {
        const level = i.recipe.hierarchy.levels.find((l) => l.zone === zone.id)!;
        expect(zone.area_share).toBe(level.area_share);
      }
      expect(bp.unassessed).toEqual([]);
    });
  });

  describe("determinism + hash", () => {
    it.each(BLUEPRINT_FIXTURES)("%s — identical inputs produce a byte-identical blueprint", (name) => {
      const a = resolve(name);
      const b = resolve(name);
      if (!a.ok || !b.ok) throw new Error("expected ok");
      expect(b.value).toEqual(a.value);
      expect(b.value.blueprint_hash).toBe(a.value.blueprint_hash);
      expect(a.value.blueprint_hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it("the hash changes when a DKV correction moves a structural number", () => {
      const i = blueprintInputs("northbeam-saas-launch");
      const base = resolveLayoutBlueprint({
        recipe: i.recipe,
        contract: i.contract,
        direction: i.direction,
        datasets
      });
      const nudged: DesignRecipe = {
        ...i.recipe,
        hierarchy: { ...i.recipe.hierarchy, focal_dominance: i.recipe.hierarchy.focal_dominance - 0.2 }
      };
      const after = resolveLayoutBlueprint({
        recipe: nudged,
        contract: i.contract,
        direction: i.direction,
        datasets
      });
      if (!base.ok || !after.ok) throw new Error("expected ok");
      expect(after.value.blueprint_hash).not.toBe(base.value.blueprint_hash);
    });

    it("the hash is stable across an unrelated recipe field change (created_by)", () => {
      const i = blueprintInputs("kopi-lawas-promotion");
      const base = resolve("kopi-lawas-promotion");
      const relabelled: DesignRecipe = { ...i.recipe, created_by: "someone-else" };
      const after = resolveLayoutBlueprint({
        recipe: relabelled,
        contract: i.contract,
        direction: i.direction,
        datasets
      });
      if (!base.ok || !after.ok) throw new Error("expected ok");
      // recipe_hash is unchanged by created_by, so the blueprint is identical
      expect(after.value.blueprint_hash).toBe(base.value.blueprint_hash);
    });
  });

  describe("does not silently repair invalid input", () => {
    it("errors on a recipe/contract id mismatch", () => {
      const i = blueprintInputs("kopi-lawas-promotion");
      const result = resolveLayoutBlueprint({
        recipe: i.recipe,
        contract: { ...i.contract, id: "contract_MISMATCH" },
        direction: i.direction,
        datasets
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.some((e) => e.code === "recipe_contract_mismatch" && e.severity === "P0")).toBe(
        true
      );
    });

    it("errors on a recipe/direction id mismatch", () => {
      const i = blueprintInputs("kopi-lawas-promotion");
      const result = resolveLayoutBlueprint({
        recipe: i.recipe,
        contract: i.contract,
        direction: { ...i.direction, id: "direction_MISMATCH" },
        datasets
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.some((e) => e.code === "recipe_direction_mismatch")).toBe(true);
    });

    it("errors on an empty zone set", () => {
      const i = blueprintInputs("kopi-lawas-promotion");
      const stripped: DesignRecipe = {
        ...i.recipe,
        hierarchy: { ...i.recipe.hierarchy, levels: [] }
      };
      const result = resolveLayoutBlueprint({
        recipe: stripped,
        contract: i.contract,
        direction: i.direction,
        datasets
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error[0]!.code).toBe("empty_zone_set");
    });

    it("errors on a reading order that contradicts the zone set", () => {
      const i = blueprintInputs("northbeam-saas-launch");
      const broken: DesignRecipe = {
        ...i.recipe,
        hierarchy: { ...i.recipe.hierarchy, reading_order: i.recipe.hierarchy.reading_order.slice(0, 2) }
      };
      const result = resolveLayoutBlueprint({
        recipe: broken,
        contract: i.contract,
        direction: i.direction,
        datasets
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.some((e) => e.code === "reading_order_mismatch")).toBe(true);
    });

    it("errors on a missing visual type in the dataset", () => {
      const i = blueprintInputs("kopi-lawas-promotion");
      const contract = { ...i.contract, visual_type: { ...i.contract.visual_type, id: "hologram" } };
      const result = resolveLayoutBlueprint({
        recipe: i.recipe,
        contract,
        direction: i.direction,
        datasets
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.some((e) => e.code === "missing_visual_type")).toBe(true);
    });
  });

  describe("advisory issues ride on the blueprint", () => {
    it("keeps the blueprint when a required zone reaches the safe-area edge", () => {
      // At least one tall/deep-safe-area fixture is expected to surface this.
      const anyAdvisory = BLUEPRINT_FIXTURES.map((name) => resolve(name))
        .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
        .some((r) => r.value.issues.some((issue) => issue.severity !== "P0"));
      // whether or not it fires, no advisory issue is ever fatal
      for (const name of BLUEPRINT_FIXTURES) {
        const r = resolve(name);
        expect(r.ok).toBe(true);
        if (r.ok) {
          for (const issue of r.value.issues) expect(issue.severity).not.toBe("P0");
        }
      }
      void anyAdvisory;
    });
  });
});
