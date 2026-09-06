import { describe, expect, it } from "vitest";
import { VISUAL_TYPE_BRIEFS, datasets, pipeline } from "../fixtures/load";
import { compilePromptSet } from "../../engine/prompt/compile";
import { candidateLayouts } from "../../engine/layout/resolve";

/**
 * Golden coverage for the P7 non-social-feed visual types.
 *
 * Asserts INVARIANTS, not exact output: every visual type resolves brief →
 * contract → direction → recipe → prompt set, keeps its declared aspect ratio,
 * only ever places zones the type allows, always places the zones it requires,
 * selects a layout that declares support for it, and produces a stable hash.
 */
describe.each(VISUAL_TYPE_BRIEFS)("golden visual type: %s", (name) => {
  const { contract, direction, recipe } = pipeline(name);
  const visualType = datasets.visualTypes.get(contract.visual_type.id);

  it("resolves against a real, non-social-feed visual type", () => {
    expect(visualType).toBeDefined();
    expect(visualType!.id).not.toBe("social-feed");
    expect(contract.visual_type.id).toBe(visualType!.id);
  });

  it("keeps an aspect ratio the visual type actually declares", () => {
    const ratioIds = visualType!.aspect_ratios.map((ratio) => ratio.id);
    expect(ratioIds).toContain(contract.visual_type.aspect_ratio_id);
  });

  it("only places zones the visual type allows, and places every zone it requires", () => {
    const allowed = new Set<string>(visualType!.allowed_zones);
    const placed = new Set(recipe.hierarchy.levels.map((level) => level.zone));
    for (const zone of placed) expect(allowed.has(zone), `zone "${zone}"`).toBe(true);
    for (const required of visualType!.required_zones) {
      expect(placed.has(required), `required zone "${required}"`).toBe(true);
    }
  });

  it("selects a layout that declares support for this visual type", () => {
    const eligible = candidateLayouts(datasets, visualType!);
    expect(eligible.length).toBeGreaterThan(0);
    const selected = direction.candidates.find(
      (candidate) => candidate.candidate.candidate_id === direction.selected_candidate_id
    );
    expect(selected).toBeDefined();
    const layout = datasets.layouts.get(selected!.candidate.layout_id)!;
    expect(layout.suitable_visual_types).toContain(visualType!.id);
  });

  it("compiles a clean prompt set and is reproducible", () => {
    const promptSet = compilePromptSet({ recipe, language: "en" });
    expect(promptSet.guard.clean).toBe(true);
    expect(promptSet.masterPrompt.length).toBeGreaterThan(0);
    expect(pipeline(name).recipe.recipe_hash).toBe(recipe.recipe_hash);
  });
});
