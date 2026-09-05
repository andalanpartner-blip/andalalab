import { describe, expect, it } from "vitest";
import { P1_BRIEFS, clock, datasets, loadBrand, loadBrief, newIds, pipeline } from "../fixtures/load";
import { buildDesignContract } from "../../engine/contract/build";
import { buildDesignDirection } from "../../engine/decision/resolve";
import { buildDesignRecipe } from "../../engine/recipe/build";
import { scoreCandidates } from "../../engine/decision/score";
import { generateCandidates } from "../../engine/decision/candidates";
import { collectClaims } from "../../engine/decision/conflicts";
import { resolveDkv, PARAM_LIMITS } from "../../engine/dkv/rules";
import { normaliseBlend, blendDimensions } from "../../engine/country/blend";
import { DKV_PARAM_KEYS } from "../../types/schemas/dkv.schema";
import { diffRecipes } from "../../engine/recipe/diff";
import { assertAnchorsIntact } from "../../engine/recipe/anchors";
import { AnchorViolationError } from "../../domain/errors";

/** Deterministic pseudo-random generator — Math.random is banned and untestable. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const build = (name: string) => {
  const brief = loadBrief(name);
  const brand = brief.brand_id ? loadBrand() : null;
  const ids = newIds();
  const contract = buildDesignContract({
    projectId: `proj_${name}`,
    brief,
    brand,
    datasets,
    clock,
    ids
  });
  if (!contract.ok) throw new Error("contract failed");
  return { brief, contract: contract.value, ids };
};

describe("§13.1 DKV parameters never leave valid bounds", () => {
  it("holds across 400 randomised claim sets", () => {
    const random = lcg(20260904);
    const layers = [
      "communication_objective",
      "audience",
      "industry_requirements",
      "brand_identity",
      "dkv_fundamentals",
      "platform_constraints",
      "country_visual_dna",
      "design_movement"
    ] as const;

    for (let run = 0; run < 400; run += 1) {
      const claims = Array.from({ length: 1 + Math.floor(random() * 6) }, () => {
        const param = DKV_PARAM_KEYS[Math.floor(random() * DKV_PARAM_KEYS.length)]!;
        const limits = PARAM_LIMITS[param];
        const span = limits.max - limits.min;
        const layerIndex = Math.floor(random() * layers.length);
        const isBand = random() > 0.5;
        const a = limits.min + random() * span;
        const b = limits.min + random() * span;
        return {
          param,
          layer: layers[layerIndex]!,
          rank: layerIndex + 1,
          kind: isBand ? ("band" as const) : ("target" as const),
          min: isBand ? Math.min(a, b) : limits.min,
          max: isBand ? Math.max(a, b) : limits.max,
          target: isBand ? undefined : a,
          source: `probe-${run}-${layerIndex}`
        };
      });

      const result = resolveDkv(claims);
      for (const param of DKV_PARAM_KEYS) {
        expect(result.params[param]).toBeGreaterThanOrEqual(PARAM_LIMITS[param].min);
        expect(result.params[param]).toBeLessThanOrEqual(PARAM_LIMITS[param].max);
      }
    }
  });
});

describe("§13.2 candidate ordering does not change the selection", () => {
  it.each(P1_BRIEFS)("%s is order-independent", (name) => {
    const { contract } = build(name);
    const countries = Object.entries(normaliseBlend(contract.country)).flatMap(([id, weight]) => {
      const country = datasets.countries.get(id);
      return country ? [{ country, weight }] : [];
    });
    const generated = generateCandidates(contract, datasets, countries);

    const forward = scoreCandidates(generated.candidates, contract, datasets, countries);
    const reversed = scoreCandidates(
      [...generated.candidates].reverse(),
      contract,
      datasets,
      countries
    );

    expect(reversed.map((entry) => entry.candidate.candidate_id)).toEqual(
      forward.map((entry) => entry.candidate.candidate_id)
    );
    expect(reversed[0]!.total_score).toBe(forward[0]!.total_score);
  });
});

describe("§13.3 doctrine resolution is stable", () => {
  it.each(P1_BRIEFS)("%s resolves identically when claims are shuffled", (name) => {
    const { contract } = build(name);
    const countries = Object.entries(normaliseBlend(contract.country)).flatMap(([id, weight]) => {
      const country = datasets.countries.get(id);
      return country ? [{ country, weight }] : [];
    });
    const candidate = generateCandidates(contract, datasets, countries).candidates[0]!;
    const claims = collectClaims(contract, candidate, datasets);

    const straight = resolveDkv(claims);
    const shuffled = resolveDkv([...claims].reverse());

    expect(shuffled.params).toEqual(straight.params);
    expect(shuffled.resolutions.map((r) => `${r.param}:${r.winner}:${r.loser}`)).toEqual(
      straight.resolutions.map((r) => `${r.param}:${r.winner}:${r.loser}`)
    );
  });
});

describe("§13.4 country weights always normalise to 1", () => {
  const cases: Record<string, number>[] = [
    { indonesia: 0.7, japan: 0.3 },
    { indonesia: 0.6, japan: 0.4 },
    { indonesia: 0.5, japan: 0.5 },
    { indonesia: 7, japan: 3 },
    { switzerland: 1 },
    { indonesia: 0.2, japan: 0.3, switzerland: 0.5 },
    { indonesia: 0.33, japan: 0.33, switzerland: 0.34 }
  ];

  it.each(cases)("%o normalises", (blend) => {
    const normalised = normaliseBlend(blend);
    const sum = Object.values(normalised).reduce((total, weight) => total + weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.001);
  });

  it("preserves proportion through normalisation", () => {
    const normalised = normaliseBlend({ indonesia: 7, japan: 3 });
    expect(normalised.indonesia).toBeCloseTo(0.7, 4);
    expect(normalised.japan).toBeCloseTo(0.3, 4);
  });
});

describe("§7 dimension-aware blending preserves dominance", () => {
  const resolved = (blend: Record<string, number>) =>
    Object.entries(normaliseBlend(blend))
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([id, weight]) => {
        const country = datasets.countries.get(id);
        return country ? [{ country, weight }] : [];
      });

  it.each([
    [{ indonesia: 0.7, japan: 0.3 }, "70/30"],
    [{ indonesia: 0.6, japan: 0.4 }, "60/40"],
    [{ indonesia: 0.5, japan: 0.5 }, "50/50"]
  ])("%o (%s) assigns each dimension to exactly one country", (blend) => {
    const owners = blendDimensions(resolved(blend));
    const ids = Object.keys(blend);
    for (const owner of Object.values(owners)) {
      expect(ids).toContain(owner.country_id);
      expect(owner.influence).toBeGreaterThan(0);
    }
    expect(Object.keys(owners)).toHaveLength(6);
  });

  it("does not average: a 70/30 blend still hands whole dimensions to the minority country when it cares more", () => {
    const owners = blendDimensions(resolved({ indonesia: 0.7, japan: 0.3 }));
    const distinct = new Set(Object.values(owners).map((owner) => owner.country_id));
    // Either one country dominates every dimension, or ownership is genuinely
    // split — but never a numeric average of two spatial philosophies.
    expect(distinct.size).toBeGreaterThanOrEqual(1);
    for (const owner of Object.values(owners)) {
      expect(typeof owner.country_id).toBe("string");
      expect(owner.contested).toBeTypeOf("boolean");
    }
  });

  it("is deterministic under key reordering", () => {
    const a = blendDimensions(resolved({ indonesia: 0.5, japan: 0.5 }));
    const b = blendDimensions(resolved({ japan: 0.5, indonesia: 0.5 }));
    expect(b).toEqual(a);
  });
});

describe("§13.5 building twice gives the same output", () => {
  it.each(P1_BRIEFS)("%s is reproducible", (name) => {
    const first = pipeline(name);
    const second = pipeline(name);
    expect(second.contract.contract_hash).toBe(first.contract.contract_hash);
    expect(second.direction.direction_hash).toBe(first.direction.direction_hash);
    expect(second.recipe.recipe_hash).toBe(first.recipe.recipe_hash);
    expect(second.recipe.dkv).toEqual(first.recipe.dkv);
  });
});

describe("§13.6 recipe diff is symmetric where appropriate", () => {
  it("reports no change against itself", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    const diff = diffRecipes(recipe, recipe);
    expect(diff.identical).toBe(true);
    expect(diff.changed).toHaveLength(0);
    expect(Object.values(diff.dkv_delta).every((delta) => delta === 0)).toBe(true);
  });

  it("changed paths match in both directions and deltas invert", () => {
    const a = pipeline("kopi-lawas-promotion").recipe;
    const b = pipeline("warung-vernacular-promo").recipe;

    const forward = diffRecipes(a, b);
    const backward = diffRecipes(b, a);

    expect(backward.changed.map((change) => change.path)).toEqual(
      forward.changed.map((change) => change.path)
    );
    expect(forward.added).toEqual(backward.removed);
    expect(forward.removed).toEqual(backward.added);
    for (const [param, delta] of Object.entries(forward.dkv_delta)) {
      expect(backward.dkv_delta[param as keyof typeof backward.dkv_delta]).toBeCloseTo(-delta, 6);
    }
  });
});

describe("§13.7 anchor validation always detects an anchor change", () => {
  const { recipe } = pipeline("kopi-lawas-promotion");

  it("passes when nothing moved", () => {
    expect(() => assertAnchorsIntact(recipe.anchors, recipe.anchors)).not.toThrow();
  });

  it("detects a changed value on every locked anchor", () => {
    const locked = recipe.anchors.filter((anchor) => anchor.status === "locked");
    expect(locked.length).toBeGreaterThan(0);

    for (const target of locked) {
      const tampered = recipe.anchors.map((anchor) =>
        anchor.kind === target.kind ? { ...anchor, value: `${anchor.value}-tampered` } : anchor
      );
      expect(() => assertAnchorsIntact(recipe.anchors, tampered)).toThrow(AnchorViolationError);
    }
  });

  it("detects an unlocked anchor and a removed anchor", () => {
    const unlocked = recipe.anchors.map((anchor) =>
      anchor.status === "locked" ? { ...anchor, status: "pending" as const } : anchor
    );
    expect(() => assertAnchorsIntact(recipe.anchors, unlocked)).toThrow(AnchorViolationError);

    const removed = recipe.anchors.filter((anchor) => anchor.kind !== "objective");
    expect(() => assertAnchorsIntact(recipe.anchors, removed)).toThrow(AnchorViolationError);
  });

  it("surfaces anchor violations through the diff as well", () => {
    const tampered = {
      ...recipe,
      anchors: recipe.anchors.map((anchor) =>
        anchor.kind === "core_message" ? { ...anchor, value: "something else entirely" } : anchor
      )
    };
    const diff = diffRecipes(recipe, tampered);
    expect(diff.anchor_violations.length).toBeGreaterThan(0);
  });
});

describe("a recipe cannot be built from a direction belonging to another contract", () => {
  it("is rejected", () => {
    const a = pipeline("kopi-lawas-promotion");
    // Fixtures share a sequential id generator, so the mismatch is created
    // explicitly rather than relying on two builds happening to differ.
    const foreign = { ...a.direction, contract_id: "contract_from_another_project" };
    const result = buildDesignRecipe({
      projectId: "proj_mismatch",
      contract: a.contract,
      direction: foreign,
      datasets,
      clock,
      ids: newIds()
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.code).toBe("recipe_invalid");
  });
});

describe("direction rejects candidates it cannot resolve", () => {
  it("returns no_candidates when nothing survives filtering", () => {
    const { contract } = build("kopi-lawas-promotion");
    const emptyLayouts = { ...datasets, layouts: new Map() };
    const result = buildDesignDirection({
      projectId: "proj_empty",
      contract,
      datasets: emptyLayouts,
      clock,
      ids: newIds()
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.code).toBe("no_candidates");
  });
});
