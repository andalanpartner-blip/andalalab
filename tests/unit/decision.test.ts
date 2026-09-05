import { describe, expect, it } from "vitest";
import { datasets } from "../fixtures/load";
import { resolveDkv, authorityWeight, PARAM_LIMITS } from "../../engine/dkv/rules";
import { SCORE_WEIGHTS, closeness } from "../../engine/decision/score";
import {
  deriveColorStrategy,
  deriveCompositionStrategy,
  deriveTypographyStrategy
} from "../../engine/decision/strategies";
import { DOCTRINE, rankOf } from "../../engine/dkv/doctrine";
import type { DkvClaim } from "../../types/schemas/direction.schema";

describe("scoring weights", () => {
  it("sum to exactly 1", () => {
    const total = Object.values(SCORE_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("match the weights fixed by the P1 specification", () => {
    expect(SCORE_WEIGHTS).toEqual({
      communication_fit: 0.25,
      industry_fit: 0.15,
      audience_fit: 0.15,
      brand_fit: 0.15,
      culture_fit: 0.1,
      movement_fit: 0.1,
      platform_fit: 0.05,
      distinctiveness: 0.05
    });
  });
});

describe("doctrine", () => {
  it("is a total order of ten layers, lowest number strongest", () => {
    expect(DOCTRINE).toHaveLength(10);
    expect(DOCTRINE.map((layer) => layer.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rankOf("communication_objective")).toBe(1);
    expect(rankOf("decorative_treatment")).toBe(10);
  });

  it("gives authority weight 1.0 at rank 1 and 0.1 at rank 10", () => {
    expect(authorityWeight(1)).toBe(1);
    expect(authorityWeight(10)).toBe(0.1);
    for (let rank = 1; rank < 10; rank += 1) {
      expect(authorityWeight(rank)).toBeGreaterThan(authorityWeight(rank + 1));
    }
  });
});

describe("closeness", () => {
  it("is 1 when identical and 0 when maximally apart", () => {
    expect(closeness(0.5, 0.5)).toBe(1);
    expect(closeness(0, 1)).toBe(0);
    expect(closeness(0.7, 0.6)).toBeCloseTo(0.9, 6);
  });
});

const claim = (over: Partial<DkvClaim>): DkvClaim => ({
  param: "contrast",
  layer: "design_movement",
  rank: 8,
  kind: "target",
  min: 0,
  max: 1,
  target: 0.5,
  source: "test",
  ...over
});

describe("DKV resolution obeys doctrine rather than band hardness", () => {
  it("a higher-ranked band beats a lower-ranked target", () => {
    const result = resolveDkv([
      claim({ kind: "band", layer: "industry_requirements", rank: 3, min: 0.7, max: 1, target: undefined }),
      claim({ kind: "target", layer: "design_movement", rank: 8, target: 0.2 })
    ]);
    expect(result.params.contrast).toBe(0.7);
    const resolution = result.resolutions.find((entry) => entry.param === "contrast");
    expect(resolution?.winner).toBe("industry_requirements");
    expect(resolution?.loser).toBe("design_movement");
  });

  it("a higher-ranked target beats a lower-ranked band", () => {
    const result = resolveDkv([
      claim({ kind: "band", layer: "platform_constraints", rank: 6, min: 0.8, max: 1, target: undefined }),
      claim({ kind: "target", layer: "communication_objective", rank: 1, target: 0.3 })
    ]);
    expect(result.params.contrast).toBe(0.3);
    const resolution = result.resolutions.find((entry) => entry.param === "contrast");
    expect(resolution?.winner).toBe("communication_objective");
    expect(resolution?.loser).toBe("platform_constraints");
    expect(resolution?.action).toContain("release_band");
  });

  it("never records a resolution where the loser outranks the winner", () => {
    const result = resolveDkv([
      claim({ kind: "band", layer: "industry_requirements", rank: 3, min: 0.6, max: 0.7, target: undefined }),
      claim({ kind: "target", layer: "audience", rank: 2, target: 0.1 }),
      claim({ kind: "target", layer: "design_movement", rank: 8, target: 0.95 })
    ]);
    const ranks = Object.fromEntries(DOCTRINE.map((layer) => [layer.id, layer.rank]));
    for (const resolution of result.resolutions) {
      expect(ranks[resolution.winner]!).toBeLessThanOrEqual(ranks[resolution.loser]!);
    }
  });

  it("reports an overruled movement even when the blend lands inside the band", () => {
    // The movement asks for 0.95, the band caps at 0.6, and authority weighting
    // would have quietly averaged the demand away without a word.
    const result = resolveDkv([
      claim({ kind: "band", layer: "industry_requirements", rank: 3, min: 0, max: 0.6, target: undefined }),
      claim({ kind: "target", layer: "communication_objective", rank: 1, target: 0.2 }),
      claim({ kind: "target", layer: "design_movement", rank: 8, target: 0.95 })
    ]);
    const overruled = result.resolutions.filter((entry) => entry.loser === "design_movement");
    expect(overruled.length).toBeGreaterThan(0);
    expect(overruled[0]!.requested).toBe(0.95);
  });

  it("clamps to absolute limits without inventing a doctrine conflict", () => {
    const result = resolveDkv([claim({ kind: "target", layer: "design_movement", rank: 8, target: 0.5 })]);
    expect(result.conflicts).toHaveLength(0);
    expect(result.params.contrast).toBeLessThanOrEqual(PARAM_LIMITS.contrast.max);
  });

  it("produces a derivation for all eight parameters, always", () => {
    const result = resolveDkv([]);
    expect(result.derivations).toHaveLength(8);
    for (const derivation of result.derivations) {
      expect(derivation.explanation.length).toBeGreaterThan(8);
    }
  });
});

describe("derived strategies are deterministic functions of their inputs", () => {
  const movement = datasets.movements.get("swiss-international")!;
  const brutalism = datasets.movements.get("brutalism")!;
  const layout = datasets.layouts.get("hero-visual")!;
  const typographic = datasets.layouts.get("typographic")!;
  const industry = datasets.industries.get("technology-saas")!;
  const indonesia = datasets.countries.get("indonesia")!;
  const japan = datasets.countries.get("japan")!;

  it("returns the same strategy for the same inputs", () => {
    const a = deriveColorStrategy(movement, 0.5, industry);
    const b = deriveColorStrategy(movement, 0.5, industry);
    expect(b).toEqual(a);
  });

  it("moves toward higher-chroma strategies as saturation rises", () => {
    const low = deriveColorStrategy(movement, 0.05, industry);
    const high = deriveColorStrategy(movement, 0.95, industry);
    expect(high.chroma).toBeGreaterThan(low.chroma);
  });

  it("selects an image-led composition for an image-dominant layout", () => {
    expect(deriveCompositionStrategy(movement, layout, indonesia)).toBe("full-bleed-focal");
  });

  it("selects a display-dominant type strategy for a typographic layout", () => {
    expect(deriveTypographyStrategy(brutalism, typographic, japan)).toBe("display-dominant");
  });
});
