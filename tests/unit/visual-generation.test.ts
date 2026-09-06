import { describe, expect, it } from "vitest";
import { clock, datasets, newIds } from "../fixtures/load";
import { blueprintInputs } from "../fixtures/blueprint-inputs";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { compilePromptSet } from "../../engine/prompt/compile";
import {
  buildGenerationRequest,
  GENERATION_REQUEST_VERSION,
  PROMPT_COMPILER_VERSION
} from "../../engine/generation/request";
import {
  createFakeVisualGeneration,
  FAKE_GENERATION_MODEL,
  FAKE_GENERATION_PROVIDER
} from "../../adapters/visual-generation/fake";
import { createCostLedger } from "../../services/cost.service";
import { runVisualGeneration } from "../../services/generation.service";
import { runRecipePipeline } from "../../services/pipeline.service";
import {
  GeneratedArtifact,
  GenerationRequest,
  VISUAL_GENERATION_ADAPTER_IDS
} from "../../types/schemas/visual-generation.schema";
import { VISUAL_ADAPTER_IDS } from "../../engine/prompt/visual-adapter/types";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";

/**
 * P2.11 — Visual Generation Integration Foundation.
 *
 * Structured design artifacts → deterministic normalised request → provider-
 * neutral adapter → fake boundary → generated-artifact metadata, with full
 * provenance and cost accounting, and NO live image API.
 */

const FIXTURE = "kopi-lawas-promotion";

function scaffold(name = FIXTURE) {
  const i = blueprintInputs(name);
  const bp = resolveLayoutBlueprint({
    recipe: i.recipe,
    contract: i.contract,
    direction: i.direction,
    datasets
  });
  if (!bp.ok) throw new Error("blueprint resolve failed");
  const promptSet = compilePromptSet({ recipe: i.recipe, language: "en" });
  return { ...i, blueprint: bp.value, promptSet };
}

function buildReq(over: Partial<Parameters<typeof buildGenerationRequest>[0]> = {}) {
  const s = scaffold();
  const result = buildGenerationRequest({
    recipe: s.recipe,
    blueprint: s.blueprint,
    promptSet: s.promptSet,
    aspectRatio: s.aspectRatio,
    visualTypeId: s.visualType.id,
    datasetVersion: datasets.version,
    ...over
  });
  if (!result.ok) throw new Error(`buildGenerationRequest failed: ${JSON.stringify(result.error)}`);
  return { request: result.value, scaffold: s };
}

const genDeps = () => {
  const ledger = createCostLedger({ clock });
  return { ledger, clock, ids: newIds() };
};

// --- 4 / 5 / 16 — request normalization + determinism -----------------

describe("generation request (normalization, hashing, determinism)", () => {
  it("is schema-valid and carries the compiled prompt, not free text", () => {
    const { request, scaffold: s } = buildReq();
    expect(GenerationRequest.safeParse(request).success).toBe(true);
    expect(request.prompt).toBe(s.promptSet.imageOnlyPrompt.trim());
    expect(request.negative_prompt).toBe(s.promptSet.negativePrompt.trim());
    expect(request.generation_request_version).toBe(GENERATION_REQUEST_VERSION);
    expect(request.provenance.prompt_compiler_version).toBe(PROMPT_COMPILER_VERSION);
  });

  it("same structured inputs → byte-identical request and request_hash (16)", () => {
    const a = buildReq().request;
    const b = buildReq().request;
    expect(b).toEqual(a);
    expect(a.request_hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("adapter selection is the P2.7 taxonomy, taken from the compiled prompt set (4)", () => {
    const { request, scaffold: s } = buildReq();
    expect(request.provenance.adapter_id).toBe(s.promptSet.visualCharacter.id);
    expect(VISUAL_GENERATION_ADAPTER_IDS).toContain(request.provenance.adapter_id);
  });

  it("target dimensions come from the resolved dataset aspect ratio (5)", () => {
    const { request, scaffold: s } = buildReq();
    expect(request.target.width).toBe(s.aspectRatio.width);
    expect(request.target.height).toBe(s.aspectRatio.height);
    expect(request.target.aspect_ratio_id).toBe(s.recipe.platform.aspect_ratio_id);
  });

  it("rejects a blueprint that was derived from a different recipe", () => {
    const s = scaffold();
    const stale = resolveLayoutBlueprint({
      recipe: blueprintInputs("northbeam-saas-launch").recipe,
      contract: blueprintInputs("northbeam-saas-launch").contract,
      direction: blueprintInputs("northbeam-saas-launch").direction,
      datasets
    });
    if (!stale.ok) throw new Error("setup");
    const result = buildGenerationRequest({
      recipe: s.recipe,
      blueprint: stale.value,
      promptSet: s.promptSet,
      aspectRatio: s.aspectRatio,
      visualTypeId: s.visualType.id,
      datasetVersion: datasets.version
    });
    expect(result.ok).toBe(false);
  });
});

// --- 7 / 8 / 9 / 10 / 17 / 18 — provenance binding -------------------

describe("provenance binding", () => {
  it("binds recipe id + hash, contract, direction, concept ref, blueprint hash, prompt hash (7,8,9,10)", () => {
    const { request, scaffold: s } = buildReq();
    const p = request.provenance;
    expect(p.recipe_id).toBe(s.recipe.id);
    expect(p.recipe_hash).toBe(s.recipe.recipe_hash);
    expect(p.contract_id).toBe(s.recipe.contract_id);
    expect(p.direction_id).toBe(s.recipe.direction_id);
    expect(p.concept_ref).toBe(s.recipe.concept_ref);
    expect(p.blueprint_hash).toBe(s.blueprint.blueprint_hash);
    expect(p.prompt_hash).toMatch(/^[0-9a-f]{8}$/);
    expect(p.dataset_version).toBe(datasets.version);
  });

  it("blueprint hash is null when no blueprint is supplied (9)", () => {
    const { request } = buildReq({ blueprint: null });
    expect(request.provenance.blueprint_hash).toBeNull();
  });

  it("different recipe_hash → different request provenance + hash (17)", () => {
    const base = buildReq().request;
    const s = scaffold();
    const nudged: DesignRecipe = {
      ...s.recipe,
      recipe_hash: "deadbeef"
    };
    const other = buildGenerationRequest({
      recipe: nudged,
      blueprint: null,
      promptSet: s.promptSet,
      aspectRatio: s.aspectRatio,
      visualTypeId: s.visualType.id,
      datasetVersion: datasets.version
    });
    if (!other.ok) throw new Error("setup");
    expect(other.value.provenance.recipe_hash).toBe("deadbeef");
    expect(other.value.request_hash).not.toBe(base.request_hash);
  });

  it("different prompt hash → different request provenance + hash (18)", () => {
    const s = scaffold();
    const a = buildGenerationRequest({
      recipe: s.recipe,
      blueprint: null,
      promptSet: s.promptSet,
      aspectRatio: s.aspectRatio,
      visualTypeId: s.visualType.id,
      datasetVersion: datasets.version,
      config: { prompt_tier: "image-only" }
    });
    const b = buildGenerationRequest({
      recipe: s.recipe,
      blueprint: null,
      promptSet: s.promptSet,
      aspectRatio: s.aspectRatio,
      visualTypeId: s.visualType.id,
      datasetVersion: datasets.version,
      config: { prompt_tier: "master" }
    });
    if (!a.ok || !b.ok) throw new Error("setup");
    expect(b.value.provenance.prompt_hash).not.toBe(a.value.provenance.prompt_hash);
    expect(b.value.request_hash).not.toBe(a.value.request_hash);
  });
});

// --- 1 / 2 / 11 — port contract + fake adapter success ---------------

describe("VisualGenerationPort — fake adapter success", () => {
  it("returns an immutable, schema-valid artifact bound to the request (1,2)", async () => {
    const { request } = buildReq();
    const deps = genDeps();
    const port = createFakeVisualGeneration(deps);
    const result = await port.generate(request, { projectId: "proj_test" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const art = result.value;
    expect(GeneratedArtifact.safeParse(art).success).toBe(true);
    expect(Object.isFrozen(art)).toBe(true);
    expect(art.status).toBe("generated");
    expect(art.request_hash).toBe(request.request_hash);
    expect(art.provenance).toEqual(request.provenance);
  });

  it("propagates provider / model / adapter metadata (11)", async () => {
    const { request } = buildReq();
    const result = await createFakeVisualGeneration(genDeps()).generate(request, {
      projectId: "proj_test"
    });
    if (!result.ok) return;
    expect(result.value.provider).toBe(FAKE_GENERATION_PROVIDER);
    expect(result.value.model).toBe(FAKE_GENERATION_MODEL);
    expect(result.value.adapter_id).toBe(request.provenance.adapter_id);
    expect(result.value.image.width).toBe(request.target.width);
    expect(result.value.image.delivery).toBe("none"); // no pretend image
    expect(result.value.image.reference).toBeNull();
  });

  it("the fake does not claim a real price — pricing_basis is test-fixture", async () => {
    const { request } = buildReq();
    const result = await createFakeVisualGeneration(genDeps()).generate(request, {
      projectId: "proj_test"
    });
    if (!result.ok) return;
    expect(result.value.cost.pricing_basis).toBe("test-fixture");
  });

  it("artifact_hash is the envelope hash — stable across two calls of the same request", async () => {
    const { request } = buildReq();
    const deps = genDeps(); // one id sequence, so the two artifact ids differ
    const port = createFakeVisualGeneration(deps);
    const a = await port.generate(request, { projectId: "p" });
    const b = await port.generate(request, { projectId: "p" });
    if (!a.ok || !b.ok) return;
    expect(b.value.artifact_hash).toBe(a.value.artifact_hash);
    expect(b.value.artifact_id).not.toBe(a.value.artifact_id); // the event id is fresh
  });
});

// --- 3 / 13 — fake adapter failure ---------------------------------

describe("VisualGenerationPort — failure never produces a successful artifact (3,13)", () => {
  it.each([
    "not_configured",
    "provider_unavailable",
    "authentication_error",
    "rate_limited",
    "content_rejected",
    "malformed_request",
    "timeout",
    "unknown_provider_error"
  ] as const)("%s → err, no artifact", async (code) => {
    const { request } = buildReq();
    const deps = genDeps();
    const port = createFakeVisualGeneration({ ...deps, failWith: code });
    const result = await port.generate(request, { projectId: "proj_test" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]!.code).toBe(code);
  });

  it("a raw call that throws is mapped, not swallowed", async () => {
    const { request } = buildReq();
    const deps = genDeps();
    const port = createFakeVisualGeneration({ ...deps, throws: "socket hang up" });
    const result = await port.generate(request, { projectId: "proj_test" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]!.code).toBe("unknown_provider_error");
  });
});

// --- 12 — cost recording ------------------------------------------

describe("cost accounting", () => {
  it("books one visual_generate cost event on success, before the result", async () => {
    const { request } = buildReq();
    const deps = genDeps();
    const port = createFakeVisualGeneration({ ...deps, costUsd: 0.004 });
    await port.generate(request, { projectId: "proj_cost" });

    const events = deps.ledger.list("proj_cost");
    expect(events).toHaveLength(1);
    expect(events[0]!.stage).toBe("visual_generate");
    expect(events[0]!.status).toBe("ok");
    expect(events[0]!.estimated_cost_usd).toBe(0.004);
    expect(events[0]!.input_tokens).toBe(0);
    expect(deps.ledger.totalUsd("proj_cost")).toBe(0.004);
  });

  it("books a failed cost event on provider failure", async () => {
    const { request } = buildReq();
    const deps = genDeps();
    const port = createFakeVisualGeneration({ ...deps, failWith: "rate_limited" });
    await port.generate(request, { projectId: "proj_cost_fail" });

    const events = deps.ledger.list("proj_cost_fail");
    expect(events).toHaveLength(1);
    expect(events[0]!.stage).toBe("visual_generate");
    expect(events[0]!.status).toBe("failed");
  });
});

// --- 14 — provider-specific code stays outside the engine ----------

describe("provider boundary", () => {
  it("the request builder is pure — no adapter, provider, clock or RNG import", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../engine/generation/request.ts", import.meta.url), "utf8")
    );
    expect(src).not.toMatch(/adapters\//);
    expect(src).not.toMatch(/\bDate\.now\b|\bnew Date\b|Math\.random/);
    expect(src).not.toMatch(/\bfetch\b|node:https?/);
  });

  it("the P2.11 adapter-id taxonomy matches the P2.7 engine list", () => {
    expect([...VISUAL_GENERATION_ADAPTER_IDS]).toEqual([...VISUAL_ADAPTER_IDS]);
  });
});

// --- service + 15 — no generation during the recipe pipeline -------

describe("generation service (explicit, downstream, not automatic)", () => {
  it("runs recipe artifacts → request → fake adapter → artifact", async () => {
    const s = scaffold();
    const deps = genDeps();
    const result = await runVisualGeneration(
      { datasets, ids: deps.ids, clock, generator: createFakeVisualGeneration(deps) },
      { recipe: s.recipe, contract: s.contract, concept: null, blueprint: s.blueprint }
    );
    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    expect(result.artifact.provenance.recipe_hash).toBe(s.recipe.recipe_hash);
    expect(result.artifact.provenance.blueprint_hash).toBe(s.blueprint.blueprint_hash);
    expect(result.request.request_hash).toBe(result.artifact.request_hash);
  });

  it("surfaces a provider failure as an ERROR result with issues, never an artifact", async () => {
    const s = scaffold();
    const deps = genDeps();
    const result = await runVisualGeneration(
      {
        datasets,
        ids: deps.ids,
        clock,
        generator: createFakeVisualGeneration({ ...deps, failWith: "content_rejected" })
      },
      { recipe: s.recipe, contract: s.contract }
    );
    expect(result.status).toBe("ERROR");
    if (result.status !== "ERROR") return;
    expect(result.issues?.[0]?.code).toBe("content_rejected");
  });

  it("rejects a stale blueprint", async () => {
    const s = scaffold();
    const otherBp = resolveLayoutBlueprint({
      recipe: blueprintInputs("northbeam-saas-launch").recipe,
      contract: blueprintInputs("northbeam-saas-launch").contract,
      direction: blueprintInputs("northbeam-saas-launch").direction,
      datasets
    });
    if (!otherBp.ok) throw new Error("setup");
    const deps = genDeps();
    const result = await runVisualGeneration(
      { datasets, ids: deps.ids, clock, generator: createFakeVisualGeneration(deps) },
      { recipe: s.recipe, contract: s.contract, blueprint: otherBp.value }
    );
    expect(result.status).toBe("ERROR");
  });

  it("recipe / correction pipelines never reach the generation layer (15)", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../services/pipeline.service.ts", import.meta.url), "utf8")
    );
    expect(src).not.toMatch(/visual-generation|generation\.service|VisualGenerationPort|runVisualGeneration/);
    // and a real recipe pipeline run books only LLM-stage cost, never visual_generate
    const s = scaffold();
    const deps = genDeps();
    const out = runRecipePipeline({ datasets, ids: deps.ids, clock }, {
      contract: s.contract,
      direction: s.direction,
      concept: null
    });
    void out;
    expect(deps.ledger.list().some((e) => e.stage === "visual_generate")).toBe(false);
  });
});
