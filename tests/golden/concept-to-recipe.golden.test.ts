import { describe, expect, it } from "vitest";
import { clock, datasets, newIds } from "../fixtures/load";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger } from "../../services/cost.service";
import { normalizeBrief } from "../../engine/brief/normalize";
import { buildDesignContract } from "../../engine/contract/build";
import { buildDesignDirection } from "../../engine/decision/resolve";
import { generateConcepts } from "../../engine/concept/generate";
import { buildDesignRecipe } from "../../engine/recipe/build";
import { assertAnchorsIntact } from "../../engine/recipe/anchors";
import { AnchorViolationError } from "../../domain/errors";
import { DesignRecipe } from "../../types/schemas/recipe.schema";
import { llmFixture, RAW_INDONESIAN_BRIEF } from "../fixtures/llm/raw";
import { conceptFixtureText } from "../fixtures/concepts/load";
import { MIN_CONCEPT_DISTANCE } from "../../engine/concept/config";

/**
 * The P2.2 end-to-end: raw Indonesian brief through to a recipe whose concept
 * anchor is locked. Semantic contract properties only — never the model's prose.
 */
async function fullRun(conceptScript?: { text: string }[]) {
  const ledger = createCostLedger({ clock });
  const fake = createFakeLlm(
    [
      { text: llmFixture("01-valid-indonesian") },
      ...(conceptScript ?? [{ text: conceptFixtureText("valid-set") }])
    ],
    { ledger, clock }
  );
  const ids = newIds();

  const normalised = await normalizeBrief({
    rawBrief: RAW_INDONESIAN_BRIEF,
    projectId: "proj_p22",
    datasets,
    llm: fake.port,
    ids
  });
  if (!normalised.ok) throw new Error("normalize failed");
  const brief = normalised.value.brief!;

  const contract = buildDesignContract({
    projectId: "proj_p22",
    brief,
    brand: null,
    datasets,
    clock,
    ids
  });
  if (!contract.ok) throw new Error("contract failed");

  const direction = buildDesignDirection({
    projectId: "proj_p22",
    contract: contract.value,
    datasets,
    clock,
    ids
  });
  if (!direction.ok) throw new Error("direction failed");

  const concepts = await generateConcepts({
    projectId: "proj_p22",
    contract: contract.value,
    direction: direction.value,
    datasets,
    llm: fake.port,
    ids,
    clock
  });
  if (!concepts.ok) throw new Error(`concepts failed: ${JSON.stringify(concepts.error)}`);

  const recipe = buildDesignRecipe({
    projectId: "proj_p22",
    contract: contract.value,
    direction: direction.value,
    concept: concepts.value.selected,
    datasets,
    clock,
    ids
  });
  if (!recipe.ok) throw new Error(`recipe failed: ${JSON.stringify(recipe.error)}`);

  return {
    contract: contract.value,
    direction: direction.value,
    concepts: concepts.value,
    recipe: recipe.value,
    ledger,
    fake
  };
}

describe("Indonesian brief → concepts → recipe", () => {
  it("runs the whole pipeline on two model calls", async () => {
    const run = await fullRun();
    expect(run.fake.callCount()).toBe(2);
    expect(run.ledger.list("proj_p22")).toHaveLength(2);
    expect(run.ledger.totalUsd("proj_p22")).toBeLessThan(0.01);
  });

  it("produces exactly three concepts", async () => {
    const run = await fullRun();
    expect(run.concepts.concepts).toHaveLength(3);
  });

  it("makes the concepts conceptually different, not restyled", async () => {
    const run = await fullRun();
    expect(run.concepts.diversity.passed).toBe(true);
    for (const pair of run.concepts.diversity.distances) {
      expect(pair.distance).toBeGreaterThanOrEqual(MIN_CONCEPT_DISTANCE);
    }
    const subjects = new Set(
      run.concepts.concepts.map((c) => c.diversity_vector.subject_strategy)
    );
    expect(subjects.size).toBeGreaterThan(1);
  });

  it("keeps every concept inside the direction's movement", async () => {
    const run = await fullRun();
    const selected = run.direction.candidates.find(
      (c) => c.candidate.candidate_id === run.direction.selected_candidate_id
    )!;
    // The recipe's movement comes from the direction, never from a concept.
    expect(run.recipe.movement.id).toBe(selected.candidate.movement_id);
  });

  it("selects one concept deterministically and references it from the recipe", async () => {
    const run = await fullRun();
    expect(run.recipe.concept_ref).toBe(run.concepts.selected.id);
    expect(run.concepts.selected.score.total).toBeGreaterThan(0);
    expect(DesignRecipe.safeParse(run.recipe).success).toBe(true);
  });

  it("locks the concept anchor with the concept hash", async () => {
    const run = await fullRun();
    const anchor = run.recipe.anchors.find((a) => a.kind === "concept")!;
    expect(anchor.status).toBe("locked");
    expect(anchor.value).toBe(
      `${run.concepts.selected.id}@${run.concepts.selected.concept_hash}`
    );
  });

  it("leaves no anchor pending once a concept exists", async () => {
    const run = await fullRun();
    expect(run.recipe.anchors.filter((a) => a.status === "pending")).toHaveLength(0);
  });

  it("detects an attempt to swap the concept underneath the anchor", async () => {
    const run = await fullRun();
    const swapped = run.recipe.anchors.map((a) =>
      a.kind === "concept" ? { ...a, value: `${run.concepts.concepts[1]!.id}@aaaaaaaa` } : a
    );
    expect(() => assertAnchorsIntact(run.recipe.anchors, swapped)).toThrow(AnchorViolationError);
  });

  it("detects the idea being edited in place, even under the same id", async () => {
    const run = await fullRun();
    const sameIdNewHash = run.recipe.anchors.map((a) =>
      a.kind === "concept" ? { ...a, value: `${run.concepts.selected.id}@deadbeef` } : a
    );
    expect(() => assertAnchorsIntact(run.recipe.anchors, sameIdNewHash)).toThrow(
      AnchorViolationError
    );
  });

  it("refuses a concept generated for a different direction", async () => {
    const run = await fullRun();
    const foreign = { ...run.concepts.selected, direction_id: "direction_elsewhere" };
    const result = buildDesignRecipe({
      projectId: "proj_p22",
      contract: run.contract,
      direction: run.direction,
      concept: foreign,
      datasets,
      clock,
      ids: newIds()
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.code).toBe("recipe_invalid");
  });

  it("is reproducible: same inputs, same recipe hash", async () => {
    const first = await fullRun();
    const second = await fullRun();
    expect(second.recipe.recipe_hash).toBe(first.recipe.recipe_hash);
    expect(second.concepts.selected.concept_hash).toBe(first.concepts.selected.concept_hash);
  });

  it("rejects generic concepts even inside the full pipeline", async () => {
    const run = await fullRun([
      { text: conceptFixtureText("generic-response") },
      { text: conceptFixtureText("valid-set") }
    ]);
    expect(run.concepts.rejected.length).toBeGreaterThan(0);
    expect(
      run.concepts.rejected.some((r) => r.issues.some((i) => i.code === "GENERIC_LANGUAGE"))
    ).toBe(true);
    expect(run.recipe.concept_ref).toBe(run.concepts.selected.id);
  });

  it("still carries the country stereotype guard into the recipe", async () => {
    const run = await fullRun();
    expect(run.recipe.culture.banned_tokens.length).toBeGreaterThan(0);
  });
});
