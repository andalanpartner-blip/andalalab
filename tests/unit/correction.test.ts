import { describe, expect, it } from "vitest";
import { pipeline, datasets, clock } from "../fixtures/load";
import { sequentialIds } from "../../ports/id.port";
import { applyCorrection } from "../../engine/correction/apply";
import { classifyRecipeDiff } from "../../engine/correction/classify";
import { diffRecipes } from "../../engine/recipe/diff";
import { auditDesign } from "../../engine/critic/audit";
import { compilePromptSet } from "../../engine/prompt/compile";
import { CorrectionReport } from "../../types/schemas/correction.schema";
import type { CorrectionPatch } from "../../types/schemas/correction.schema";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";

/**
 * The Correction Engine (P6). Deterministic, pure, no LLM, no image, no network.
 * Every test builds a real fixture design and applies a bounded patch.
 */

const base = pipeline("kopi-lawas-promotion");

const apply = (patch: CorrectionPatch, parent: DesignRecipe = base.recipe, contract = base.contract, direction = base.direction) =>
  applyCorrection({
    parentRecipe: parent,
    contract,
    direction,
    patch,
    datasets,
    ids: sequentialIds(),
    clock,
    concept: null
  });

const unwrap = (result: ReturnType<typeof apply>) => {
  if (!result.ok) throw new Error(`applyCorrection errored: ${JSON.stringify(result.error)}`);
  return result.value;
};

describe("applyCorrection: a DKV adjustment", () => {
  it("produces a new derived recipe — the parent is never mutated", () => {
    const before = JSON.stringify(base.recipe);
    const { report, recipe } = unwrap(apply({ adjustments: [{ field: "whitespace", mode: "increase", amount: 0.08 }] }));

    expect(report.outcome).toBe("adjustment");
    expect(CorrectionReport.safeParse(report).success).toBe(true);
    expect(recipe).not.toBeNull();
    expect(recipe!.derived_from).toBe(base.recipe.id);
    expect(recipe!.recipe_hash).not.toBe(base.recipe.recipe_hash);
    expect(recipe!.dkv.whitespace).toBeGreaterThan(base.recipe.dkv.whitespace);

    // parent untouched, still frozen
    expect(JSON.stringify(base.recipe)).toBe(before);
    expect(Object.isFrozen(base.recipe)).toBe(true);
  });

  it("flows through resolveDkv — the derived recipe stays DKV-consistent (passes the P4.0 audit)", () => {
    const { recipe, contract, direction } = unwrap(apply({ adjustments: [{ field: "contrast", mode: "increase", amount: 0.06 }] }));
    expect(recipe && contract && direction).toBeTruthy();

    const byParam = new Map(direction!.derivations.map((d) => [d.param, d]));
    for (const [param, value] of Object.entries(recipe!.dkv)) {
      expect(value).toBe(byParam.get(param as never)!.final);
    }

    const promptSet = compilePromptSet({ recipe: recipe!, language: "en" });
    const critic = auditDesign({ contract: contract!, direction: direction!, recipe: recipe!, promptSet, promptLanguage: "en", concept: null });
    expect(critic.findings.some((f) => f.area === "integrity")).toBe(false);
  });

  it("respects an industry band — a below-floor request is clamped and named", () => {
    const { report } = unwrap(apply({ adjustments: [{ field: "contrast", mode: "set", amount: 0.02 }] }));
    const change = report.changes.find((c) => c.field === "contrast")!;
    expect(change.requested).toBe(0.02);
    expect(change.resolved).toBeGreaterThan(0.4); // held near the industry floor
    expect(change.held_by).toBeTruthy();
  });

  it("increase and decrease move in the expected direction; amounts clamp to the parameter range", () => {
    const up = unwrap(apply({ adjustments: [{ field: "focal_dominance", mode: "increase", amount: 2 }] }));
    expect(up.recipe!.dkv.focal_dominance).toBeLessThanOrEqual(1);
    expect(up.recipe!.dkv.focal_dominance).toBeGreaterThanOrEqual(base.recipe.dkv.focal_dominance);

    const down = unwrap(apply({ adjustments: [{ field: "visual_density", mode: "decrease", amount: 0.2 }] }));
    expect(down.recipe!.dkv.visual_density).toBeLessThan(base.recipe.dkv.visual_density);
    expect(down.recipe!.dkv.visual_density).toBeGreaterThanOrEqual(0);
  });
});

describe("applyCorrection: a bias adjustment", () => {
  it("changes the recipe bias and propagates into photographic character", () => {
    const { recipe } = unwrap(apply({ adjustments: [{ field: "color_saturation", mode: "decrease", amount: 0.15 }] }));
    expect(recipe!.color.saturation).toBeCloseTo(base.recipe.color.saturation - 0.15, 4);
    expect(recipe!.color.source).toContain("correction");
    // photographic finish reads the corrected saturation
    expect(JSON.stringify(recipe!.photographic_character)).not.toBe(JSON.stringify(base.recipe.photographic_character));
  });

  it("does NOT rebuild the contract or direction when only biases change", () => {
    const { recipe } = unwrap(apply({ adjustments: [{ field: "graphic_ornament", mode: "decrease", amount: 0.1 }] }));
    expect(recipe!.contract_id).toBe(base.recipe.contract_id);
    expect(recipe!.direction_id).toBe(base.recipe.direction_id);
  });
});

describe("applyCorrection: no-op", () => {
  it("setting a value that is already in place returns noop with no recipe", () => {
    const { report, recipe } = unwrap(apply({ adjustments: [{ field: "whitespace", mode: "set", amount: base.recipe.dkv.whitespace }] }));
    expect(report.outcome).toBe("noop");
    expect(recipe).toBeNull();
    expect(report.lineage).toEqual([]);
    expect(report.diff.changed_paths).toEqual([]);
  });

  it("setting a bias that is already in place returns noop", () => {
    const { report } = unwrap(apply({ adjustments: [{ field: "color_saturation", mode: "set", amount: base.recipe.color.saturation }] }));
    expect(report.outcome).toBe("noop");
  });
});

describe("classifyRecipeDiff: the redesign guard", () => {
  const guard = (mutate: (r: DesignRecipe) => void) => {
    const tampered = structuredClone(base.recipe) as DesignRecipe;
    mutate(tampered);
    return classifyRecipeDiff(diffRecipes(base.recipe, tampered), base.recipe, tampered);
  };

  it("a movement change is a redesign", () => {
    const c = guard((r) => {
      r.movement = { ...r.movement, id: "brutalism", name: "Brutalism" };
    });
    expect(c.outcome).toBe("redesign");
    expect(c.structural_changes).toContain("movement.id");
  });

  it("a composition strategy change is a redesign", () => {
    const c = guard((r) => {
      r.composition = { ...r.composition, strategy: "centred-frontal" };
    });
    expect(c.outcome).toBe("redesign");
    expect(c.structural_changes).toContain("composition.strategy");
  });

  it("a moved locked anchor is a redesign", () => {
    const c = guard((r) => {
      r.anchors = r.anchors.map((a) => (a.kind === "objective" ? { ...a, value: "changed" } : a));
    });
    expect(c.outcome).toBe("redesign");
    expect(c.structural_changes.some((s) => s.startsWith("anchor:"))).toBe(true);
  });

  it("a pure DKV / bias change is an adjustment", () => {
    const c = guard((r) => {
      r.dkv = { ...r.dkv, whitespace: r.dkv.whitespace + 0.05 };
      r.color = { ...r.color, saturation: 0.3 };
    });
    expect(c.outcome).toBe("adjustment");
  });

  it("a change to only lineage paths is a noop", () => {
    const c = guard((r) => {
      r.derived_from = "recipe_parent";
      r.contract_id = "contract_other";
    });
    expect(c.outcome).toBe("noop");
  });
});

describe("applyCorrection: lineage across a chain", () => {
  it("corrects A → B → C, each derived_from its parent", () => {
    const stepB = unwrap(apply({ adjustments: [{ field: "whitespace", mode: "increase", amount: 0.06 }] }));
    expect(stepB.report.outcome).toBe("adjustment");
    const B = stepB.recipe!;
    expect(B.derived_from).toBe(base.recipe.id);

    const stepC = unwrap(
      applyCorrection({
        parentRecipe: B,
        contract: stepB.contract!,
        direction: stepB.direction!,
        patch: { adjustments: [{ field: "contrast", mode: "increase", amount: 0.05 }] },
        datasets,
        ids: sequentialIds(),
        clock,
        concept: null
      })
    );
    const C = stepC.recipe!;
    expect(C.derived_from).toBe(B.id);
    expect(stepC.report.lineage).toEqual([base.recipe.id, B.id, C.id]);
  });
});

describe("applyCorrection: determinism & input guards", () => {
  it("identical input (fresh identical id stream) → identical report and recipe hash", () => {
    const a = unwrap(apply({ adjustments: [{ field: "hierarchy_strength", mode: "increase", amount: 0.07 }] }));
    const b = unwrap(apply({ adjustments: [{ field: "hierarchy_strength", mode: "increase", amount: 0.07 }] }));
    expect(b.report).toEqual(a.report);
    expect(b.recipe!.recipe_hash).toBe(a.recipe!.recipe_hash);
  });

  it("rejects a recipe that does not belong to the given contract / direction", () => {
    const stray = structuredClone(base.recipe) as DesignRecipe;
    stray.contract_id = "contract_not_this_one";
    const result = apply({ adjustments: [{ field: "whitespace", mode: "increase", amount: 0.05 }] }, stray);
    expect(result.ok).toBe(false);
  });
});
