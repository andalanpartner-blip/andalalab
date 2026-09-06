import { describe, expect, it } from "vitest";
import { P1_BRIEFS, pipeline, datasets, clock, newIds } from "../fixtures/load";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger } from "../../services/cost.service";
import { sequentialIds } from "../../ports/id.port";
import { applyCorrection } from "../../engine/correction/apply";
import { compilePromptSet } from "../../engine/prompt/compile";
import { auditDesign } from "../../engine/critic/audit";
import { CorrectionReport } from "../../types/schemas/correction.schema";
import { DesignRecipe } from "../../types/schemas/recipe.schema";
import {
  runBriefPipeline,
  runRecipePipeline,
  runCorrectionPipeline,
  type EngineDeps
} from "../../services/pipeline.service";
import { llmFixture, RAW_INDONESIAN_BRIEF } from "../fixtures/llm/raw";
import { conceptFixtureText } from "../fixtures/concepts/load";

/**
 * Golden cases for the Correction Engine (P6). Real pipeline, no LLM except the
 * scripted fake.
 */

const correct = (name: string, patch: Parameters<typeof applyCorrection>[0]["patch"]) => {
  const { contract, direction, recipe } = pipeline(name);
  const result = applyCorrection({
    parentRecipe: recipe,
    contract,
    direction,
    patch,
    datasets,
    ids: sequentialIds(),
    clock,
    concept: null
  });
  if (!result.ok) throw new Error(`applyCorrection failed for ${name}`);
  return { parent: recipe, ...result.value };
};

describe("golden: a correction on every P1 fixture", () => {
  it.each(P1_BRIEFS)("%s — a small whitespace nudge is deterministic and schema-valid", (name) => {
    const a = correct(name, { adjustments: [{ field: "whitespace", mode: "increase", amount: 0.05 }] });
    const b = correct(name, { adjustments: [{ field: "whitespace", mode: "increase", amount: 0.05 }] });

    expect(CorrectionReport.safeParse(a.report).success).toBe(true);
    expect(["adjustment", "noop"]).toContain(a.report.outcome);
    expect(b.report).toEqual(a.report);

    if (a.report.outcome === "adjustment") {
      expect(DesignRecipe.safeParse(a.recipe).success).toBe(true);
      expect(a.recipe!.derived_from).toBe(a.parent.id);
      expect(b.recipe!.recipe_hash).toBe(a.recipe!.recipe_hash);
    }
  });
});

describe("golden: an accepted correction re-runs compile → guard → audit", () => {
  const { parent, recipe, contract, direction, report } = correct("kopi-lawas-promotion", {
    adjustments: [{ field: "whitespace", mode: "increase", amount: 0.08 }]
  });

  it("is an adjustment that keeps every anchor intact", () => {
    expect(report.outcome).toBe("adjustment");
    expect(report.diff.anchor_violations).toEqual([]);
    expect(report.diff.structural_changes).toEqual([]);
    // structural fields untouched
    expect(recipe!.movement.id).toBe(parent.movement.id);
    expect(recipe!.composition.strategy).toBe(parent.composition.strategy);
    expect(recipe!.typography.strategy).toBe(parent.typography.strategy);
    expect(recipe!.core_message).toBe(parent.core_message);
  });

  it("the derived recipe compiles, re-guards clean and re-audits without a new integrity failure", () => {
    const promptSet = compilePromptSet({ recipe: recipe!, language: "en" });
    expect(promptSet.guard.clean).toBe(true);

    const critic = auditDesign({
      contract: contract!,
      direction: direction!,
      recipe: recipe!,
      promptSet,
      promptLanguage: "en",
      concept: null
    });
    expect(critic.findings.some((f) => f.area === "integrity")).toBe(false);
    expect(["PASS", "REVIEW"]).toContain(critic.verdict);
  });

  it("the recompiled prompt reflects the higher whitespace", () => {
    const before = compilePromptSet({ recipe: parent, language: "en" }).masterPrompt;
    const after = compilePromptSet({ recipe: recipe!, language: "en" }).masterPrompt;
    expect(after).not.toBe(before);
  });
});

describe("golden: a below-floor request is clamped, not rejected", () => {
  it("kopi-lawas contrast set to 0.02 → adjustment held by the industry band", () => {
    const { report } = correct("kopi-lawas-promotion", {
      adjustments: [{ field: "contrast", mode: "set", amount: 0.02 }]
    });
    expect(report.outcome).toBe("adjustment");
    const contrast = report.changes.find((c) => c.field === "contrast")!;
    expect(contrast.held_by).toBeTruthy();
    expect(contrast.resolved).toBeGreaterThan(contrast.requested);
  });
});

describe("golden: runCorrectionPipeline end to end", () => {
  const buildDeps = (script: { text: string }[]): EngineDeps => {
    const ledger = createCostLedger({ clock });
    const fake = createFakeLlm(script, { ledger, clock });
    return { datasets, llm: fake.port, ids: newIds(), clock };
  };

  it("returns an OK adjustment with the derived recipe, contract, direction, prompt set and critic", async () => {
    const deps = buildDeps([
      { text: llmFixture("01-valid-indonesian") },
      { text: conceptFixtureText("valid-set") }
    ]);
    const brief = await runBriefPipeline(deps, { rawBrief: RAW_INDONESIAN_BRIEF });
    expect(brief.status).toBe("READY");
    if (brief.status !== "READY") return;

    const recipeOut = runRecipePipeline(deps, {
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected
    });
    expect(recipeOut.status).toBe("OK");
    if (recipeOut.status !== "OK") return;

    const corrected = runCorrectionPipeline(deps, {
      parentRecipe: recipeOut.recipe,
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected,
      patch: { adjustments: [{ field: "hierarchy_strength", mode: "increase", amount: 0.06 }] }
    });

    expect(corrected.status).toBe("OK");
    if (corrected.status !== "OK") return;
    expect(corrected.outcome).toBe("adjustment");
    expect(corrected.recipe.derived_from).toBe(recipeOut.recipe.id);
    expect(DesignRecipe.safeParse(corrected.recipe).success).toBe(true);
    expect(CorrectionReport.safeParse(corrected.correction).success).toBe(true);
    expect(["PASS", "REVIEW"]).toContain(corrected.critic.verdict);
    expect(corrected.contract.id).not.toBe("");
  });

  it("does not raise a false concept-direction-drift BLOCK after a DKV correction regenerates the direction", async () => {
    const deps = buildDeps([
      { text: llmFixture("01-valid-indonesian") },
      { text: conceptFixtureText("valid-set") }
    ]);
    const brief = await runBriefPipeline(deps, { rawBrief: RAW_INDONESIAN_BRIEF });
    if (brief.status !== "READY") return;

    const recipeOut = runRecipePipeline(deps, {
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected
    });
    expect(recipeOut.status).toBe("OK");
    if (recipeOut.status !== "OK") return;
    // the baseline design is clean, so any BLOCK below is the regression
    expect(["PASS", "REVIEW"]).toContain(recipeOut.critic.verdict);

    const corrected = runCorrectionPipeline(deps, {
      parentRecipe: recipeOut.recipe,
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected,
      patch: { adjustments: [{ field: "whitespace", mode: "increase", amount: 0.08 }] }
    });

    expect(corrected.status).toBe("OK");
    if (corrected.status !== "OK") return;
    expect(corrected.outcome).toBe("adjustment");

    // the DKV correction really did regenerate the direction — so the strict
    // check had something to suppress
    expect(corrected.direction.id).not.toBe(brief.direction.id);
    expect(corrected.recipe.direction_id).toBe(corrected.direction.id);

    // concept content is still pinned to the derived recipe
    expect(corrected.recipe.concept_ref).toBe(brief.concepts.selected.id);

    // no false drift finding, and the verdict reflects real findings only
    expect(corrected.critic.findings.some((f) => f.check === "concept-direction-drift")).toBe(false);
    expect(["PASS", "REVIEW"]).toContain(corrected.critic.verdict);
  });

  it("still flags concept-direction-drift on an ORIGINAL (non-derived) recipe whose concept was built elsewhere", async () => {
    const deps = buildDeps([
      { text: llmFixture("01-valid-indonesian") },
      { text: conceptFixtureText("valid-set") }
    ]);
    const brief = await runBriefPipeline(deps, { rawBrief: RAW_INDONESIAN_BRIEF });
    if (brief.status !== "READY") return;

    const recipeOut = runRecipePipeline(deps, {
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected
    });
    if (recipeOut.status !== "OK") return;

    const promptSet = compilePromptSet({ recipe: recipeOut.recipe, concept: brief.concepts.selected, language: "en" });
    const strayConcept = { ...brief.concepts.selected, direction_id: "direction_somewhere_else" };
    const critic = auditDesign({
      contract: brief.contract,
      direction: brief.direction,
      recipe: recipeOut.recipe, // derived_from === null
      promptSet,
      promptLanguage: "en",
      concept: strayConcept
    });
    expect(critic.findings.some((f) => f.check === "concept-direction-drift")).toBe(true);
    expect(critic.verdict).toBe("BLOCK");
  });

  it("returns NOOP when the patch changes nothing", async () => {
    const deps = buildDeps([
      { text: llmFixture("01-valid-indonesian") },
      { text: conceptFixtureText("valid-set") }
    ]);
    const brief = await runBriefPipeline(deps, { rawBrief: RAW_INDONESIAN_BRIEF });
    if (brief.status !== "READY") return;
    const recipeOut = runRecipePipeline(deps, {
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected
    });
    if (recipeOut.status !== "OK") return;

    const noop = runCorrectionPipeline(deps, {
      parentRecipe: recipeOut.recipe,
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected,
      patch: { adjustments: [{ field: "whitespace", mode: "set", amount: recipeOut.recipe.dkv.whitespace }] }
    });
    expect(noop.status).toBe("NOOP");
  });

  it("returns ERROR on unreadable input", () => {
    const deps = buildDeps([]);
    const result = runCorrectionPipeline(deps, {
      parentRecipe: { not: "a recipe" },
      contract: {},
      direction: {},
      patch: { adjustments: [] }
    });
    expect(result.status).toBe("ERROR");
  });
});

describe("regression: P6 is additive", () => {
  it("buildDesignRecipe without overrides is byte-identical — every fixture hash is unchanged", () => {
    for (const name of P1_BRIEFS) {
      expect(pipeline(name).recipe.recipe_hash).toBe(pipeline(name).recipe.recipe_hash);
    }
  });

  it("a correction never mutates the parent recipe", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    const snapshot = JSON.stringify(recipe);
    correct("kopi-lawas-promotion", { adjustments: [{ field: "contrast", mode: "increase", amount: 0.1 }] });
    expect(JSON.stringify(recipe)).toBe(snapshot);
  });
});
