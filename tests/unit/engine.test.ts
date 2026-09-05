import { describe, expect, it } from "vitest";
import {
  blendScalar,
  dominantCountry,
  mergeBias,
  normaliseBlend,
  rankOf,
  resolveRank,
  DOCTRINE,
  candidateLayouts,
  layoutSupportsVisualType
} from "../../engine";
import { deepFreeze, findAnchor, violatedAnchors } from "../../domain/contract";
import { buildDesignContract } from "../../engine/contract/build";
import { clock, datasets, loadBrand, loadBrief, newIds } from "../fixtures/load";

describe("doctrine", () => {
  it("is a strictly ordered precedence table", () => {
    const ranks = DOCTRINE.map((layer) => layer.rank);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(ranks).size).toBe(10);
  });

  it("puts communication above every stylistic layer", () => {
    expect(rankOf("communication_objective")).toBeLessThan(rankOf("design_movement"));
    expect(rankOf("industry_requirements")).toBeLessThan(rankOf("country_visual_dna"));
    expect(rankOf("brand_identity")).toBeLessThan(rankOf("contemporary_trends"));
    expect(rankOf("dkv_fundamentals")).toBeLessThan(rankOf("decorative_treatment"));
  });

  it("resolves a conflict in favour of the stronger layer", () => {
    expect(resolveRank(rankOf("industry_requirements"), rankOf("design_movement"))).toBe(
      rankOf("industry_requirements")
    );
  });
});

describe("country blending", () => {
  it("normalises weights that do not sum to one", () => {
    expect(normaliseBlend({ indonesia: 2, japan: 2 })).toEqual({ indonesia: 0.5, japan: 0.5 });
  });

  it("returns an empty blend rather than dividing by zero", () => {
    expect(normaliseBlend({})).toEqual({});
  });

  it("weights a scalar by country influence", () => {
    const indonesia = datasets.countries.get("indonesia")!;
    const japan = datasets.countries.get("japan")!;
    const blended = blendScalar(
      [
        { country: indonesia, weight: 0.5 },
        { country: japan, weight: 0.5 }
      ],
      (country) => country.composition.whitespace_bias
    );
    const expected = (indonesia.composition.whitespace_bias + japan.composition.whitespace_bias) / 2;
    expect(blended).toBeCloseTo(expected, 4);
  });

  it("picks the dominant country and breaks ties deterministically", () => {
    const indonesia = datasets.countries.get("indonesia")!;
    const japan = datasets.countries.get("japan")!;
    expect(
      dominantCountry([
        { country: indonesia, weight: 0.3 },
        { country: japan, weight: 0.7 }
      ])?.country.id
    ).toBe("japan");
    expect(
      dominantCountry([
        { country: japan, weight: 0.5 },
        { country: indonesia, weight: 0.5 }
      ])?.country.id
    ).toBe("indonesia");
  });
});

describe("dkv bias merging", () => {
  it("ignores sources that express no opinion about a parameter", () => {
    const merged = mergeBias([
      { bias: { whitespace: 0.8 }, weight: 1 },
      { bias: { contrast: 0.4 }, weight: 1 }
    ]);
    expect(merged.whitespace).toBe(0.8);
    expect(merged.contrast).toBe(0.4);
    expect(merged.visual_density).toBeUndefined();
  });

  it("weights contributions", () => {
    const merged = mergeBias([
      { bias: { whitespace: 1 }, weight: 3 },
      { bias: { whitespace: 0 }, weight: 1 }
    ]);
    expect(merged.whitespace).toBe(0.75);
  });
});

describe("layout resolution", () => {
  it("offers every layout declared for the visual type", () => {
    const socialFeed = datasets.visualTypes.get("social-feed")!;
    const candidates = candidateLayouts(datasets, socialFeed);
    expect(candidates.map((layout) => layout.id)).toEqual([
      "headline-dominant",
      "hero-visual",
      "image-text-split",
      "typographic"
    ]);
    for (const layout of candidates) expect(layoutSupportsVisualType(layout, socialFeed)).toBe(true);
  });
});

describe("immutability helpers", () => {
  it("freezes nested structures", () => {
    const frozen = deepFreeze({ a: { b: [1, 2] } });
    expect(Object.isFrozen(frozen.a)).toBe(true);
    expect(Object.isFrozen(frozen.a.b)).toBe(true);
  });

  it("reports which locked anchors a change would violate", () => {
    const result = buildDesignContract({
      projectId: "p",
      brief: loadBrief("kopi-lawas-promotion"),
      brand: loadBrand(),
      datasets,
      clock,
      ids: newIds()
    });
    if (!result.ok) throw new Error("expected success");

    expect(findAnchor(result.value, "objective")?.status).toBe("locked");
    expect(violatedAnchors(result.value, ["objective"])).toHaveLength(1);
    expect(violatedAnchors(result.value, ["concept"])).toHaveLength(0);
  });
});
