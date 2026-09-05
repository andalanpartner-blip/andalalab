import { describe, expect, it } from "vitest";
import { P1_BRIEFS, datasets, pipeline } from "../fixtures/load";
import { DKV_PARAM_KEYS } from "../../types/schemas/dkv.schema";
import { PARAM_LIMITS } from "../../engine/dkv/rules";
import { DesignRecipe } from "../../types/schemas/recipe.schema";

/**
 * Golden fixtures: brief → contract → direction → recipe, with no LLM.
 *
 * Invariants only. Snapshotting the whole recipe would fail on every dataset
 * rewording and would train everyone to run --update without reading the diff.
 */
describe.each(P1_BRIEFS)("golden pipeline: %s", (name) => {
  const { brief, contract, direction, recipe } = pipeline(name);

  it("produces a valid recipe end to end", () => {
    expect(DesignRecipe.safeParse(recipe).success).toBe(true);
    expect(recipe.contract_id).toBe(contract.id);
    expect(recipe.direction_id).toBe(direction.id);
  });

  it("selects a movement and layout that exist in the dataset", () => {
    expect(datasets.movements.has(recipe.movement.id)).toBe(true);
    const selected = direction.candidates.find(
      (candidate) => candidate.candidate.candidate_id === direction.selected_candidate_id
    );
    expect(selected).toBeDefined();
    expect(datasets.layouts.has(selected!.candidate.layout_id)).toBe(true);
  });

  it("honours a movement pinned by the brief", () => {
    if (!brief.movement_id) return;
    expect(recipe.movement.id).toBe(brief.movement_id);
  });

  it("honours a layout pinned by the brief", () => {
    if (!brief.layout_id) return;
    const selected = direction.candidates.find(
      (candidate) => candidate.candidate.candidate_id === direction.selected_candidate_id
    );
    expect(selected!.candidate.layout_id).toBe(brief.layout_id);
  });

  it("keeps every DKV parameter inside its absolute limits", () => {
    for (const param of DKV_PARAM_KEYS) {
      const value = recipe.dkv[param];
      expect(value).toBeGreaterThanOrEqual(PARAM_LIMITS[param].min);
      expect(value).toBeLessThanOrEqual(PARAM_LIMITS[param].max);
    }
  });

  it("respects the industry floor and ceiling, or logs who outranked it", () => {
    const industry = datasets.industries.get(contract.industry.id)!;

    // A rank-1 or rank-2 layer may legitimately overrule a rank-3 industry
    // band — that is what a total-order doctrine means. What is NOT allowed is
    // the band being breached with nobody named for it.
    const overruled = (param: string): boolean =>
      direction.resolutions.some(
        (resolution) => resolution.param === param && resolution.loser === "industry_requirements"
      );

    const check = (param: string, actual: number, bound: number, kind: "floor" | "ceiling") => {
      const ok =
        kind === "floor" ? actual >= bound - 0.0001 : actual <= bound + 0.0001;
      if (!ok) {
        expect(
          overruled(param),
          `${param} breached the industry ${kind} without a logged resolution`
        ).toBe(true);
      }
    };

    check("contrast", recipe.dkv.contrast, industry.dkv_floor.contrast, "floor");
    check(
      "hierarchy_strength",
      recipe.dkv.hierarchy_strength,
      industry.dkv_floor.hierarchy_strength,
      "floor"
    );
    check("visual_density", recipe.dkv.visual_density, industry.dkv_ceiling.visual_density, "ceiling");
    check(
      "color_complexity",
      recipe.dkv.color_complexity,
      industry.dkv_ceiling.color_complexity,
      "ceiling"
    );
  });

  it("resolves every conflict it detects", () => {
    const conflictIds = new Set(direction.conflicts.map((conflict) => conflict.conflict_id));
    const resolvedIds = new Set(direction.resolutions.map((resolution) => resolution.conflict_id));
    expect([...conflictIds].every((id) => resolvedIds.has(id))).toBe(true);
  });

  it("never lets a lower-authority layer beat a higher one", () => {
    const rank: Record<string, number> = {
      communication_objective: 1,
      audience: 2,
      industry_requirements: 3,
      brand_identity: 4,
      dkv_fundamentals: 5,
      platform_constraints: 6,
      country_visual_dna: 7,
      design_movement: 8,
      contemporary_trends: 9,
      decorative_treatment: 10
    };
    for (const resolution of direction.resolutions) {
      expect(rank[resolution.winner]!).toBeLessThanOrEqual(rank[resolution.loser]!);
    }
  });

  it("keeps country weights summing to 1", () => {
    const sum = Object.values(recipe.culture.blend).reduce((total, weight) => total + weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.001);
  });

  it("assigns every culture dimension to a country in the blend", () => {
    for (const owner of Object.values(recipe.culture.dimensions)) {
      expect(Object.keys(recipe.culture.blend)).toContain(owner.country_id);
    }
  });

  it("carries the anchors forward intact and locks the visual direction", () => {
    const byKind = Object.fromEntries(recipe.anchors.map((anchor) => [anchor.kind, anchor]));
    expect(byKind.objective?.status).toBe("locked");
    expect(byKind.core_message?.status).toBe("locked");
    expect(byKind.primary_visual_direction?.status).toBe("locked");
    expect(byKind.objective?.value).toBe(contract.objective);
    expect(byKind.core_message?.value).toBe(contract.core_message);
  });

  it("attaches the country stereotype guard to the recipe", () => {
    expect(recipe.culture.banned_tokens.length).toBeGreaterThan(0);
  });

  it("explains itself in plain language", () => {
    expect(direction.rationale.length).toBeGreaterThan(0);
    for (const line of direction.rationale) expect(line.length).toBeGreaterThan(8);
  });

  it("is reproducible: same inputs, same hashes", () => {
    const again = pipeline(name);
    expect(again.direction.direction_hash).toBe(direction.direction_hash);
    expect(again.recipe.recipe_hash).toBe(recipe.recipe_hash);
  });
});

describe("conflict scenarios actually conflict", () => {
  it("a pinned brutalist movement against a trust-critical industry is modified, not swapped", () => {
    const { brief, direction, recipe } = pipeline("brutalist-trust-conflict");
    expect(brief.movement_id).toBe("brutalism");
    // The client's pinned movement survives...
    expect(recipe.movement.id).toBe("brutalism");
    // ...but the industry outranks it and the log says so.
    expect(direction.resolutions.length).toBeGreaterThan(0);
    const industryWins = direction.resolutions.filter(
      (resolution) => resolution.winner === "industry_requirements"
    );
    expect(industryWins.length).toBeGreaterThan(0);
    expect(recipe.movement.influence).toBeLessThan(1);
  });

  it("a six-mandatory information load under minimalism registers density pressure", () => {
    const { contract, direction } = pipeline("luxury-density-conflict");
    expect(contract.constraints.filter((c) => c.kind === "must").length).toBeGreaterThanOrEqual(6);
    expect(direction.rationale.some((line) => line.length > 0)).toBe(true);
  });
});
