import { describe, expect, it } from "vitest";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { auditDesign } from "../../engine/critic/audit";
import { reviewDesign } from "../../engine/critic/review";
import { compilePromptSet } from "../../engine/prompt/compile";
import { LayoutBlueprint } from "../../types/schemas/layout-blueprint.schema";
import { datasets } from "../fixtures/load";
import { blueprintInputs, BLUEPRINT_FIXTURES } from "../fixtures/blueprint-inputs";

/**
 * Golden cases for the Layout Blueprint resolver (P2.10.5).
 *
 * Real pipeline (contract → direction → recipe via fixtures), no LLM. These
 * pin the deterministic hash per fixture and assert the blueprint is a faithful
 * projection of the recipe that never alters P0–P7 output.
 */

/** Pinned blueprint hashes. Regenerate ONLY with an intentional resolver bump. */
const GOLDEN_HASH: Record<(typeof BLUEPRINT_FIXTURES)[number], string> = {
  "kopi-lawas-promotion": "4239fe95",
  "northbeam-saas-launch": "5a7897a3",
  "ooh-hospitality-billboard": "17e35581",
  "print-property-brochure": "7ef0d8e6",
  "web-hero-saas-launch": "1ef043a3",
  "story-skincare-launch": "090e33e1"
};

const resolve = (name: string) => {
  const i = blueprintInputs(name);
  return resolveLayoutBlueprint({
    recipe: i.recipe,
    contract: i.contract,
    direction: i.direction,
    datasets
  });
};

describe("golden: layout blueprint per fixture", () => {
  it.each(BLUEPRINT_FIXTURES)("%s — schema-valid, deterministic, pinned hash", (name) => {
    const a = resolve(name);
    const b = resolve(name);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect(LayoutBlueprint.safeParse(a.value).success).toBe(true);
    expect(b.value).toEqual(a.value);
    expect(a.value.blueprint_hash).toBe(GOLDEN_HASH[name]);
  });

  it.each(BLUEPRINT_FIXTURES)("%s — every value traces back to the recipe or is marked derived", (name) => {
    const result = resolve(name);
    if (!result.ok) throw new Error("expected ok");
    const bp = result.value;
    const { recipe } = blueprintInputs(name);

    // structural sections carry the recipe's own numbers
    expect(bp.hierarchy.strength).toBe(recipe.hierarchy.strength);
    expect(bp.hierarchy.focal_dominance).toBe(recipe.hierarchy.focal_dominance);
    expect(bp.density.visual_density).toBe(recipe.composition.density);
    expect(bp.density.whitespace).toBe(recipe.composition.whitespace);
    expect(bp.grid.columns).toBe(recipe.grid.columns);
    expect(bp.grid.rows).toBe(recipe.grid.rows);
    expect(bp.layout_strategy.composition_strategy).toBe(recipe.composition.strategy);
    expect(bp.reading_flow.pattern).toBe(recipe.composition.flow);

    // every zone id is a recipe zone; area_share verbatim; rect derived
    for (const zone of bp.zones) {
      const level = recipe.hierarchy.levels.find((l) => l.zone === zone.id)!;
      expect(level).toBeDefined();
      expect(zone.area_share).toBe(level.area_share);
      expect(zone.rank).toBe(level.priority);
      expect(zone.basis).toBe("derived");
    }

    // relationships + rationale carry a signal string
    for (const rel of bp.relationships) expect(rel.signal.length).toBeGreaterThan(0);
    for (const entry of bp.rationale) expect(entry.signal.length).toBeGreaterThan(0);

    expect(bp.unassessed).toEqual([]);
  });
});

describe("golden: the blueprint is additive — P0–P7 + P4.x output is unchanged", () => {
  it.each(BLUEPRINT_FIXTURES)("%s — recipe hash, critic and review are byte-identical with or without a blueprint", (name) => {
    const { contract, direction, recipe } = blueprintInputs(name);
    const promptSet = compilePromptSet({ recipe, language: "en" });
    const auditInput = { contract, direction, recipe, promptSet, promptLanguage: "en", concept: null };

    const criticBefore = auditDesign(auditInput);
    const reviewBefore = reviewDesign(auditInput);

    const blueprint = resolveLayoutBlueprint({ recipe, contract, direction, datasets });
    expect(blueprint.ok).toBe(true);

    const criticAfter = auditDesign(auditInput);
    const reviewAfter = reviewDesign(auditInput);

    expect(criticAfter).toEqual(criticBefore);
    expect(reviewAfter).toEqual(reviewBefore);
    // resolving the blueprint did not mutate the frozen recipe
    expect(recipe.recipe_hash).toBe(blueprintInputs(name).recipe.recipe_hash);
  });
});
