import { describe, expect, it } from "vitest";
import { clock, datasets, newIds } from "../fixtures/load";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger } from "../../services/cost.service";
import { normalizeBrief } from "../../engine/brief/normalize";
import { buildDesignContract } from "../../engine/contract/build";
import { buildDesignDirection } from "../../engine/decision/resolve";
import { generateConcepts } from "../../engine/concept/generate";
import { buildDesignRecipe } from "../../engine/recipe/build";
import { compilePromptSet } from "../../engine/prompt/compile";
import { llmFixture, RAW_INDONESIAN_BRIEF } from "../fixtures/llm/raw";
import { conceptFixtureText } from "../fixtures/concepts/load";

/**
 * Golden path: a real Indonesian brief, through the whole pipeline, through
 * the Prompt Compiler, in both supported languages. Nothing here is an LLM
 * call — the concept step is scripted through the fake LLM exactly as the
 * P2.2 golden test does; the compiler itself never touches the LLM port.
 */
async function buildGoldenRecipe() {
  const ledger = createCostLedger({ clock });
  const fake = createFakeLlm(
    [{ text: llmFixture("01-valid-indonesian") }, { text: conceptFixtureText("valid-set") }],
    { ledger, clock }
  );
  const ids = newIds();

  const normalised = await normalizeBrief({
    rawBrief: RAW_INDONESIAN_BRIEF,
    projectId: "proj_prompt_golden",
    datasets,
    llm: fake.port,
    ids
  });
  if (!normalised.ok) throw new Error("normalize failed");
  const brief = normalised.value.brief!;

  const contract = buildDesignContract({
    projectId: "proj_prompt_golden",
    brief,
    brand: null,
    datasets,
    clock,
    ids
  });
  if (!contract.ok) throw new Error("contract failed");

  const direction = buildDesignDirection({
    projectId: "proj_prompt_golden",
    contract: contract.value,
    datasets,
    clock,
    ids
  });
  if (!direction.ok) throw new Error("direction failed");

  const concepts = await generateConcepts({
    projectId: "proj_prompt_golden",
    contract: contract.value,
    direction: direction.value,
    datasets,
    llm: fake.port,
    ids,
    clock
  });
  if (!concepts.ok) throw new Error("concepts failed");

  const recipe = buildDesignRecipe({
    projectId: "proj_prompt_golden",
    contract: contract.value,
    direction: direction.value,
    concept: concepts.value.selected,
    datasets,
    clock,
    ids
  });
  if (!recipe.ok) throw new Error("recipe failed");

  return { recipe: recipe.value, concept: concepts.value.selected };
}

describe("golden: recipe -> PromptSet (English and Bahasa Indonesia)", () => {
  it("compiles a stable English prompt set from the golden recipe", async () => {
    const { recipe, concept } = await buildGoldenRecipe();
    const first = compilePromptSet({ recipe, concept, language: "en" });
    const second = compilePromptSet({ recipe, concept, language: "en" });

    expect(second).toEqual(first);
    expect(first.language).toBe("en");
    expect(first.masterPrompt).toContain(concept.proposal.name);
    expect(first.masterPrompt).toContain(recipe.movement.name);
    expect(first.masterPrompt.toLowerCase()).toMatch(/instagram feed/);
  });

  it("compiles a stable Indonesian prompt set from the same golden recipe", async () => {
    const { recipe, concept } = await buildGoldenRecipe();
    const first = compilePromptSet({ recipe, concept, language: "id" });
    const second = compilePromptSet({ recipe, concept, language: "id" });

    expect(second).toEqual(first);
    expect(first.language).toBe("id");
    expect(first.masterPrompt).toContain(concept.proposal.name);
    expect(first.masterPrompt).toMatch(/dengan|untuk|yang/);
  });

  it("keeps the concept, composition and culture identical between languages — only wording differs", async () => {
    const { recipe, concept } = await buildGoldenRecipe();
    const en = compilePromptSet({ recipe, concept, language: "en" });
    const id = compilePromptSet({ recipe, concept, language: "id" });

    expect(en.masterPrompt).toContain(concept.proposal.name);
    expect(id.masterPrompt).toContain(concept.proposal.name);
    expect(en.masterPrompt).toContain(recipe.movement.name);
    expect(id.masterPrompt).toContain(recipe.movement.name);
    expect(en.masterPrompt).not.toBe(id.masterPrompt);
  });
});
