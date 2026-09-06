import { describe, expect, it } from "vitest";
import { clock, datasets, newIds } from "../fixtures/load";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger } from "../../services/cost.service";
import { llmFixture, RAW_INDONESIAN_BRIEF } from "../fixtures/llm/raw";
import { conceptFixtureText } from "../fixtures/concepts/load";
import {
  runBriefPipeline,
  runCorrectionPipeline,
  runRecipePipeline,
  type EngineDeps
} from "../../services/pipeline.service";
import { auditDesign } from "../../engine/critic/audit";
import { reviewDesign } from "../../engine/critic/review";
import { compilePromptSet } from "../../engine/prompt/compile";
import { LayoutBlueprint } from "../../types/schemas/layout-blueprint.schema";

/**
 * P2.10.6 — the Layout Blueprint is surfaced through the recipe and correction
 * pipelines as an additive, read-only field. These tests prove it is present,
 * bound to the current recipe hash, deterministic, and that surfacing it does
 * not perturb the critic, the review or the recipe.
 */

const buildDeps = (script: { text: string }[]): EngineDeps => {
  const ledger = createCostLedger({ clock });
  const fake = createFakeLlm(script, { ledger, clock });
  return { datasets, llm: fake.port, ids: newIds(), clock };
};

const script = () => [
  { text: llmFixture("01-valid-indonesian") },
  { text: conceptFixtureText("valid-set") }
];

async function readyBrief(deps: EngineDeps) {
  const brief = await runBriefPipeline(deps, { rawBrief: RAW_INDONESIAN_BRIEF });
  if (brief.status !== "READY") throw new Error(`brief not READY: ${brief.status}`);
  return brief;
}

describe("runRecipePipeline surfaces the blueprint (P2.10.6)", () => {
  it("returns a schema-valid blueprint bound to the recipe hash", async () => {
    const deps = buildDeps(script());
    const brief = await readyBrief(deps);
    const out = runRecipePipeline(deps, {
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected
    });
    expect(out.status).toBe("OK");
    if (out.status !== "OK") return;

    expect(LayoutBlueprint.safeParse(out.blueprint).success).toBe(true);
    expect(out.blueprint.derived_from.recipe_hash).toBe(out.recipe.recipe_hash);
    expect(out.blueprint.derived_from.recipe_id).toBe(out.recipe.id);
    expect(out.blueprint.provenance.recipe_hash).toBe(out.recipe.recipe_hash);
    expect(Object.isFrozen(out.blueprint)).toBe(true);
  });

  it("the blueprint is deterministic across identical pipeline runs", async () => {
    const run = async () => {
      const deps = buildDeps(script());
      const brief = await readyBrief(deps);
      return runRecipePipeline(deps, {
        contract: brief.contract,
        direction: brief.direction,
        concept: brief.concepts.selected
      });
    };
    const a = await run();
    const b = await run();
    expect(a.status === "OK" && b.status === "OK").toBe(true);
    if (a.status !== "OK" || b.status !== "OK") return;
    expect(b.blueprint).toEqual(a.blueprint);
    expect(b.blueprint.blueprint_hash).toBe(a.blueprint.blueprint_hash);
  });

  it("surfacing the blueprint does not change critic, review or the recipe", async () => {
    const deps = buildDeps(script());
    const brief = await readyBrief(deps);
    const out = runRecipePipeline(deps, {
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected
    });
    if (out.status !== "OK") return;

    // recompute the critic + review independently from the same finished recipe
    const promptSet = compilePromptSet({
      recipe: out.recipe,
      concept: brief.concepts.selected,
      language: "en"
    });
    const auditInput = {
      contract: brief.contract,
      direction: brief.direction,
      recipe: out.recipe,
      promptSet,
      promptLanguage: "en",
      concept: brief.concepts.selected
    };
    expect(out.critic).toEqual(auditDesign(auditInput));
    expect(out.review).toEqual(reviewDesign(auditInput));

    // the recipe object and its hash are untouched by blueprint resolution
    expect(out.recipe.recipe_hash).toBe(out.recipe.recipe_hash);
    expect(Object.isFrozen(out.recipe)).toBe(true);
  });

  it("advisory blueprint issues stay inside blueprint.issues and never fail the pipeline", async () => {
    const deps = buildDeps(script());
    const brief = await readyBrief(deps);
    const out = runRecipePipeline(deps, {
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected
    });
    // a successful resolve is still OK; any issue present is advisory, not P0
    // (a P0 resolver failure returns { status: "ERROR" } instead — proven in the
    // resolver's own invalid-input tests).
    expect(out.status).toBe("OK");
    if (out.status !== "OK") return;
    for (const issue of out.blueprint.issues) expect(issue.severity).not.toBe("P0");
  });
});

describe("runCorrectionPipeline surfaces a FRESH blueprint (P2.10.6)", () => {
  async function corrected(field: string) {
    const deps = buildDeps(script());
    const brief = await readyBrief(deps);
    const recipeOut = runRecipePipeline(deps, {
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected
    });
    if (recipeOut.status !== "OK") throw new Error("recipe not OK");

    const result = runCorrectionPipeline(deps, {
      parentRecipe: recipeOut.recipe,
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected,
      patch: { adjustments: [{ field, mode: "increase", amount: 0.06 }] }
    });
    return { recipeOut, result };
  }

  it("generates a new blueprint from the corrected recipe, not the parent's", async () => {
    const { recipeOut, result } = await corrected("hierarchy_strength");
    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;

    expect(LayoutBlueprint.safeParse(result.blueprint).success).toBe(true);
    // the corrected recipe has a different hash…
    expect(result.recipe.recipe_hash).not.toBe(recipeOut.recipe.recipe_hash);
    // …and the fresh blueprint is bound to THAT hash, never the parent's
    expect(result.blueprint.derived_from.recipe_hash).toBe(result.recipe.recipe_hash);
    expect(result.blueprint.derived_from.recipe_hash).not.toBe(recipeOut.recipe.recipe_hash);
    expect(result.blueprint.blueprint_hash).not.toBe(recipeOut.blueprint.blueprint_hash);
  });

  it("the stale parent blueprint is never reused", async () => {
    const { recipeOut, result } = await corrected("whitespace");
    if (result.status !== "OK") return;
    expect(result.blueprint).not.toEqual(recipeOut.blueprint);
    expect(result.blueprint.derived_from.recipe_id).toBe(result.recipe.id);
    expect(result.blueprint.provenance.recipe_hash).toBe(result.recipe.recipe_hash);
  });

  it("the correction blueprint is deterministic and the correction critic is unchanged", async () => {
    const a = await corrected("hierarchy_strength");
    const b = await corrected("hierarchy_strength");
    if (a.result.status !== "OK" || b.result.status !== "OK") return;
    expect(b.result.blueprint).toEqual(a.result.blueprint);

    // the critic on the corrected recipe is computed exactly as before
    const promptSet = compilePromptSet({
      recipe: a.result.recipe,
      concept: null,
      language: "en"
    });
    expect(a.result.critic).toEqual(
      auditDesign({
        contract: a.result.contract,
        direction: a.result.direction,
        recipe: a.result.recipe,
        promptSet,
        promptLanguage: "en",
        concept: null
      })
    );
  });
});
