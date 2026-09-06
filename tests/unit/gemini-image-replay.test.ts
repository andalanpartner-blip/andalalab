import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clock, datasets, newIds } from "../fixtures/load";
import { blueprintInputs } from "../fixtures/blueprint-inputs";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { compilePromptSet } from "../../engine/prompt/compile";
import { buildGenerationRequest } from "../../engine/generation/request";
import {
  createGeminiImageGeneration,
  GEMINI_IMAGE_MODEL,
  GEMINI_IMAGE_PROVIDER,
  type FetchLike
} from "../../adapters/visual-generation/gemini-image";
import { createCostLedger } from "../../services/cost.service";
import { GeneratedArtifact } from "../../types/schemas/visual-generation.schema";

/**
 * P2.13 — offline replay of a recorded successful Gemini image response.
 *
 * The provider account has image-generation quota = 0, so a real success could
 * not be captured (P2.12 + P2.13 live calls both returned HTTP 429). This
 * fixture is a sanitised, schema-accurate recording (see
 * `tests/fixtures/gemini-image/README.md`); the moment billing is enabled it is
 * replaced with a real recording and this test does not change.
 *
 * CI never calls Gemini.
 */

const FIXTURE_PATH = new URL("../fixtures/gemini-image/success.json", import.meta.url);
const recorded = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, unknown>;

const replayFetch: FetchLike = async () => ({
  ok: true,
  status: 200,
  json: async () => recorded,
  text: async () => JSON.stringify(recorded)
});

function requestForKopi() {
  const i = blueprintInputs("kopi-lawas-promotion");
  const bp = resolveLayoutBlueprint({ recipe: i.recipe, contract: i.contract, direction: i.direction, datasets });
  if (!bp.ok) throw new Error("blueprint");
  const promptSet = compilePromptSet({ recipe: i.recipe, language: "en" });
  const req = buildGenerationRequest({
    recipe: i.recipe,
    blueprint: bp.value,
    promptSet,
    aspectRatio: i.aspectRatio,
    visualTypeId: i.visualType.id,
    datasetVersion: datasets.version
  });
  if (!req.ok) throw new Error("request");
  return { request: req.value, recipe: i.recipe };
}

describe("P2.13 recorded Gemini success — offline replay", () => {
  async function run(projectId = "proj_replay") {
    const { request, recipe } = requestForKopi();
    const ledger = createCostLedger({ clock });
    const port = createGeminiImageGeneration({
      apiKey: "test-key",
      clock,
      ids: newIds(),
      ledger,
      fetchImpl: replayFetch
    });
    const result = await port.generate(request, { projectId });
    return { result, request, recipe, ledger };
  }

  it("1 — the recorded response maps to a successful, schema-valid, frozen artifact", async () => {
    const { result } = await run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(GeneratedArtifact.safeParse(result.value).success).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(result.value.status).toBe("generated");
  });

  it("2 — model + provider are correct", async () => {
    const { result } = await run();
    if (!result.ok) return;
    expect(result.value.provider).toBe(GEMINI_IMAGE_PROVIDER);
    expect(result.value.model).toBe(GEMINI_IMAGE_MODEL);
  });

  it("3 — dimensions are read from the returned PNG bytes, not the request", async () => {
    const { result, request } = await run();
    if (!result.ok) return;
    // fixture IHDR encodes 896x1120; the request targeted 1080x1350
    expect(result.value.image.width).toBe(896);
    expect(result.value.image.height).toBe(1120);
    expect(result.value.image.width).not.toBe(request.target.width);
    expect(result.value.image.height).not.toBe(request.target.height);
  });

  it("4 — delivery mode reflects the actual returned data (base64-ref, fingerprint not bytes)", async () => {
    const { result } = await run();
    if (!result.ok) return;
    expect(result.value.image.delivery).toBe("base64-ref");
    expect(result.value.image.mime_type).toBe("image/png");
    expect(result.value.image.reference).toMatch(/^[0-9a-f]{8}:\d+$/);
    // the reference is a fnv1a:length fingerprint — the base64 payload is not in it
    const rawB64 = (
      (recorded.candidates as { content: { parts: { inlineData?: { data?: string } }[] } }[])[0]!
        .content.parts.find((p) => p.inlineData?.data)!.inlineData!.data
    );
    expect(result.value.image.reference).not.toContain(rawB64!);
  });

  it("5 — provider_request_id is propagated (documented shape)", async () => {
    const { result } = await run();
    if (!result.ok) return;
    expect(result.value.run.provider_request_id).toBe(recorded.responseId);
    expect(typeof result.value.run.provider_request_id).toBe("string");
  });

  it("6 — finish reason is propagated", async () => {
    const { result } = await run();
    if (!result.ok) return;
    expect(result.value.run.finish_reason).toBe("STOP");
  });

  it("7 — safety metadata maps correctly", async () => {
    const { result } = await run();
    if (!result.ok) return;
    expect(result.value.run.safety).toContain("HARM_CATEGORY_DANGEROUS_CONTENT");
    expect(result.value.run.safety).toContain("NEGLIGIBLE");
  });

  it("8 — cost is estimated from usageMetadata against the published rates", async () => {
    const { result } = await run();
    if (!result.ok) return;
    // input 2418/1e6 * $0.50 = 0.001209 ; image 1120/1e6 * $60 = 0.0672
    expect(result.value.cost.pricing_basis).toBe("estimated");
    expect(result.value.cost.input_cost_usd).toBeCloseTo(0.001209, 6);
    expect(result.value.cost.image_cost_usd).toBeCloseTo(0.0672, 6);
    expect(result.value.cost.estimated_cost_usd).toBeCloseTo(0.068409, 6);
    expect(result.value.cost.currency).toBe("USD");
  });

  it("9 — exactly one visual_generate cost event is recorded", async () => {
    const { ledger } = await run("proj_cost_once");
    const events = ledger.list("proj_cost_once");
    expect(events).toHaveLength(1);
    expect(events[0]!.stage).toBe("visual_generate");
    expect(events[0]!.status).toBe("ok");
    expect(events[0]!.estimated_cost_usd).toBeCloseTo(0.068409, 6);
  });

  it("10 / 11 — artifact provenance and request_hash are unchanged by the provider response", async () => {
    const { result, request } = await run();
    if (!result.ok) return;
    expect(result.value.provenance).toEqual(request.provenance);
    expect(result.value.provenance.recipe_hash).toBe(request.provenance.recipe_hash);
    expect(result.value.provenance.blueprint_hash).toBe(request.provenance.blueprint_hash);
    expect(result.value.request_hash).toBe(request.request_hash);
  });

  it("12 — the fixture contains no secret material", () => {
    const raw = readFileSync(FIXTURE_PATH, "utf8");
    expect(raw).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/); // Google API key shape
    expect(raw.toLowerCase()).not.toMatch(/x-goog-api-key|authorization|bearer |api[_-]?key/);
  });

  it("13 — the replay needs no network (globalThis.fetch is never touched)", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("network call attempted during replay");
    }) as typeof globalThis.fetch;
    try {
      const { result } = await run("proj_no_net");
      expect(result.ok).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("does not mutate the recipe", async () => {
    const { recipe } = await run();
    expect(recipe.recipe_hash).toBe(blueprintInputs("kopi-lawas-promotion").recipe.recipe_hash);
    expect(Object.isFrozen(recipe)).toBe(true);
  });
});
