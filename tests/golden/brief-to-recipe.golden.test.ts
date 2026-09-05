import { describe, expect, it } from "vitest";
import { clock, datasets, newIds } from "../fixtures/load";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger } from "../../services/cost.service";
import { normalizeBrief } from "../../engine/brief/normalize";
import { buildDesignContract } from "../../engine/contract/build";
import { buildDesignDirection } from "../../engine/decision/resolve";
import { buildDesignRecipe } from "../../engine/recipe/build";
import { DesignRecipe } from "../../types/schemas/recipe.schema";
import { llmFixture, RAW_INDONESIAN_BRIEF } from "../fixtures/llm/raw";
import { DKV_PARAM_KEYS } from "../../types/schemas/dkv.schema";
import { PARAM_LIMITS } from "../../engine/dkv/rules";

/**
 * The test that matters for P2.1: a raw Indonesian sentence goes in, a
 * validated Design Recipe comes out, and exactly one model call is spent.
 */
async function fullRun(fixtureName: string, script?: { text: string }[]) {
  const ledger = createCostLedger({ clock });
  const fake = createFakeLlm(script ?? [{ text: llmFixture(fixtureName) }], { ledger, clock });
  const ids = newIds();

  const normalised = await normalizeBrief({
    rawBrief: RAW_INDONESIAN_BRIEF,
    projectId: "proj_e2e",
    datasets,
    llm: fake.port,
    ids
  });
  if (!normalised.ok) throw new Error(`normalize failed: ${JSON.stringify(normalised.error)}`);
  const brief = normalised.value.brief;
  if (!brief) throw new Error("brief was not complete enough to build");

  const contract = buildDesignContract({
    projectId: "proj_e2e",
    brief,
    brand: null,
    datasets,
    clock,
    ids
  });
  if (!contract.ok) throw new Error(`contract failed: ${JSON.stringify(contract.error)}`);

  const direction = buildDesignDirection({
    projectId: "proj_e2e",
    contract: contract.value,
    datasets,
    clock,
    ids
  });
  if (!direction.ok) throw new Error(`direction failed: ${JSON.stringify(direction.error)}`);

  const recipe = buildDesignRecipe({
    projectId: "proj_e2e",
    contract: contract.value,
    direction: direction.value,
    datasets,
    clock,
    ids
  });
  if (!recipe.ok) throw new Error(`recipe failed: ${JSON.stringify(recipe.error)}`);

  return {
    normalised: normalised.value,
    contract: contract.value,
    direction: direction.value,
    recipe: recipe.value,
    ledger,
    fake
  };
}

describe("raw Indonesian brief → Design Recipe", () => {
  it("completes the whole pipeline on one model call", async () => {
    const run = await fullRun("01-valid-indonesian");

    expect(run.fake.callCount()).toBe(1);
    expect(run.ledger.list("proj_e2e")).toHaveLength(1);
    expect(run.ledger.totalUsd("proj_e2e")).toBeLessThan(0.01);
    expect(DesignRecipe.safeParse(run.recipe).success).toBe(true);
  });

  it("produces exactly one primary objective, valid against the enum", async () => {
    const run = await fullRun("01-valid-indonesian");
    expect(run.recipe.objective).toBe("launch");
    expect(run.contract.objective).toBe("launch");
  });

  it("resolves every reference against the loaded datasets", async () => {
    const run = await fullRun("01-valid-indonesian");
    expect(datasets.industries.has(run.contract.industry.id)).toBe(true);
    expect(datasets.visualTypes.has(run.contract.visual_type.id)).toBe(true);
    expect(datasets.movements.has(run.recipe.movement.id)).toBe(true);
    for (const id of Object.keys(run.recipe.culture.blend)) {
      expect(datasets.countries.has(id)).toBe(true);
    }
  });

  it("keeps country weights summing to 1 through the whole chain", async () => {
    const run = await fullRun("01-valid-indonesian");
    const sum = Object.values(run.recipe.culture.blend).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.001);
  });

  it("keeps every DKV parameter inside its limits", async () => {
    const run = await fullRun("01-valid-indonesian");
    for (const param of DKV_PARAM_KEYS) {
      expect(run.recipe.dkv[param]).toBeGreaterThanOrEqual(PARAM_LIMITS[param].min);
      expect(run.recipe.dkv[param]).toBeLessThanOrEqual(PARAM_LIMITS[param].max);
    }
  });

  it("leaves anchors intact and locks the visual direction", async () => {
    const run = await fullRun("01-valid-indonesian");
    const byKind = Object.fromEntries(run.recipe.anchors.map((a) => [a.kind, a]));
    expect(byKind.objective?.status).toBe("locked");
    expect(byKind.core_message?.status).toBe("locked");
    expect(byKind.primary_visual_direction?.status).toBe("locked");
  });

  it("honours an explicitly requested movement all the way to the recipe", async () => {
    const run = await fullRun("04-explicit-country-movement");
    expect(run.recipe.movement.id).toBe("minimalism");
    expect(run.recipe.culture.blend.japan).toBeCloseTo(0.7, 2);
  });

  it("still spends only one model call when a movement is pinned", async () => {
    const run = await fullRun("04-explicit-country-movement");
    expect(run.ledger.list("proj_e2e")).toHaveLength(1);
  });

  it("is deterministic downstream: identical extraction gives identical recipe hash", async () => {
    const first = await fullRun("01-valid-indonesian");
    const second = await fullRun("01-valid-indonesian");
    expect(second.recipe.recipe_hash).toBe(first.recipe.recipe_hash);
    expect(second.direction.direction_hash).toBe(first.direction.direction_hash);
    expect(second.recipe.dkv).toEqual(first.recipe.dkv);
  });

  it("attaches the Indonesian stereotype guard to the recipe", async () => {
    const run = await fullRun("01-valid-indonesian");
    expect(run.recipe.culture.banned_tokens.length).toBeGreaterThan(0);
    expect(run.recipe.culture.banned_tokens.some((token) => token.includes("batik"))).toBe(true);
  });

  it("explains the design decisions without any model involvement", async () => {
    const run = await fullRun("01-valid-indonesian");
    expect(run.direction.rationale.length).toBeGreaterThan(0);
    // One model call total — every sentence in the rationale is arithmetic.
    expect(run.ledger.list("proj_e2e")).toHaveLength(1);
  });

  it("costs two calls and no more when the model needs repairing", async () => {
    const run = await fullRun("", [
      { text: llmFixture("07-invalid-enum") },
      { text: llmFixture("01-valid-indonesian") }
    ]);
    expect(run.fake.callCount()).toBe(2);
    expect(run.ledger.list("proj_e2e")).toHaveLength(2);
    expect(run.normalised.meta.repaired).toBe(true);
    expect(DesignRecipe.safeParse(run.recipe).success).toBe(true);
  });
});
