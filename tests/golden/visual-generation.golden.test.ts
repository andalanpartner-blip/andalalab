import { describe, expect, it } from "vitest";
import { clock, datasets, newIds } from "../fixtures/load";
import { blueprintInputs, BLUEPRINT_FIXTURES } from "../fixtures/blueprint-inputs";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { compilePromptSet } from "../../engine/prompt/compile";
import { auditDesign } from "../../engine/critic/audit";
import { reviewDesign } from "../../engine/critic/review";
import { buildGenerationRequest } from "../../engine/generation/request";
import { createFakeVisualGeneration } from "../../adapters/visual-generation/fake";
import { createCostLedger } from "../../services/cost.service";
import { GeneratedArtifact, GenerationRequest } from "../../types/schemas/visual-generation.schema";

/**
 * Golden: the P2.11 generation foundation is deterministic in every part the
 * architecture controls, and it never perturbs P0–P10 output.
 */

/** Pinned request hashes. Regenerate ONLY with an intentional request-version bump. */
const GOLDEN_REQUEST_HASH: Record<(typeof BLUEPRINT_FIXTURES)[number], string> = {
  "kopi-lawas-promotion": "39170d51",
  "northbeam-saas-launch": "a070d0b9",
  "ooh-hospitality-billboard": "54cfc47a",
  "print-property-brochure": "6e08df0c",
  "web-hero-saas-launch": "929d0629",
  "story-skincare-launch": "8b8ed770"
};

function scaffold(name: string) {
  const i = blueprintInputs(name);
  const bp = resolveLayoutBlueprint({
    recipe: i.recipe,
    contract: i.contract,
    direction: i.direction,
    datasets
  });
  if (!bp.ok) throw new Error("blueprint");
  const promptSet = compilePromptSet({ recipe: i.recipe, language: "en" });
  const request = buildGenerationRequest({
    recipe: i.recipe,
    blueprint: bp.value,
    promptSet,
    aspectRatio: i.aspectRatio,
    visualTypeId: i.visualType.id,
    datasetVersion: datasets.version
  });
  if (!request.ok) throw new Error(`request: ${JSON.stringify(request.error)}`);
  return { ...i, blueprint: bp.value, promptSet, request: request.value };
}

describe("golden: deterministic generation request per fixture", () => {
  it.each(BLUEPRINT_FIXTURES)("%s — schema-valid, deterministic, pinned request_hash", (name) => {
    const a = scaffold(name);
    const b = scaffold(name);
    expect(GenerationRequest.safeParse(a.request).success).toBe(true);
    expect(b.request).toEqual(a.request);
    expect(a.request.request_hash).toBe(GOLDEN_REQUEST_HASH[name]);
    // provenance is fully bound
    expect(a.request.provenance.recipe_hash).toBe(a.recipe.recipe_hash);
    expect(a.request.provenance.blueprint_hash).toBe(a.blueprint.blueprint_hash);
    expect(a.request.provenance.dataset_version).toBe(datasets.version);
  });

  it.each(BLUEPRINT_FIXTURES)("%s — the fake adapter yields a schema-valid, bound artifact", async (name) => {
    const s = scaffold(name);
    const ledger = createCostLedger({ clock });
    const port = createFakeVisualGeneration({ ledger, clock, ids: newIds() });
    const result = await port.generate(s.request, { projectId: "proj_golden" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(GeneratedArtifact.safeParse(result.value).success).toBe(true);
    expect(result.value.provenance).toEqual(s.request.provenance);
    expect(result.value.request_hash).toBe(s.request.request_hash);
    expect(result.value.image.delivery).toBe("none"); // no image was actually generated
    expect(ledger.list("proj_golden")).toHaveLength(1);
  });
});

describe("golden: the generation foundation is additive — P0–P10 output is unchanged", () => {
  it.each(BLUEPRINT_FIXTURES)("%s — recipe hash, critic, review, prompt set are byte-identical", async (name) => {
    const i = blueprintInputs(name);
    const promptSet = compilePromptSet({ recipe: i.recipe, language: "en" });
    const auditInput = {
      contract: i.contract,
      direction: i.direction,
      recipe: i.recipe,
      promptSet,
      promptLanguage: "en",
      concept: null
    };
    const criticBefore = auditDesign(auditInput);
    const reviewBefore = reviewDesign(auditInput);

    // exercise the whole generation path
    const s = scaffold(name);
    const ledger = createCostLedger({ clock });
    await createFakeVisualGeneration({ ledger, clock, ids: newIds() }).generate(s.request, {
      projectId: "p"
    });

    expect(auditDesign(auditInput)).toEqual(criticBefore);
    expect(reviewDesign(auditInput)).toEqual(reviewBefore);
    expect(compilePromptSet({ recipe: i.recipe, language: "en" })).toEqual(promptSet);
    expect(i.recipe.recipe_hash).toBe(blueprintInputs(name).recipe.recipe_hash);
  });
});
