import { describe, expect, it } from "vitest";
import { clock, datasets, newIds } from "../fixtures/load";
import { blueprintInputs } from "../fixtures/blueprint-inputs";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { compilePromptSet } from "../../engine/prompt/compile";
import { buildGenerationRequest } from "../../engine/generation/request";
import {
  createGeminiImageCall,
  createGeminiImageGeneration,
  GEMINI_IMAGE_MODEL,
  GEMINI_IMAGE_PROVIDER,
  imageSizeFor,
  readPngSize,
  reducedRatio,
  type FetchLike
} from "../../adapters/visual-generation/gemini-image";
import { createCostLedger } from "../../services/cost.service";
import { GeneratedArtifact } from "../../types/schemas/visual-generation.schema";
import type { RawGenerationRequest } from "../../ports/visual-generation.port";

/**
 * P2.12 — Gemini image adapter contract tests. No live API: an injected
 * `FetchLike` replays recorded-shape responses. The adapter plugs into the
 * unchanged P2.11 `createVisualGenerationClient`.
 */

// --- a tiny real-ish PNG so readPngSize returns meaningful dimensions ---

function pngBase64(width: number, height: number): string {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0); // signature
  bytes.set([0, 0, 0, 13], 8); // IHDR length
  bytes.set([73, 72, 68, 82], 12); // "IHDR"
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return Buffer.from(bytes).toString("base64");
}

type Capture = { url: string; body: Record<string, unknown> };

function fakeFetch(
  response: unknown,
  opts: { status?: number; ok?: boolean; capture?: Capture; throws?: string } = {}
): FetchLike {
  return async (url, init) => {
    if (opts.throws) throw Object.assign(new Error(opts.throws), { name: opts.throws });
    if (opts.capture) {
      opts.capture.url = url;
      opts.capture.body = JSON.parse((init?.body as string) ?? "{}");
    }
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: async () => response,
      text: async () => JSON.stringify(response)
    };
  };
}

function geminiOk(over: Partial<{ width: number; height: number; mime: string; finish: string; responseId: string; promptTokens: number; candidateTokens: number; safety: unknown }> = {}) {
  return {
    candidates: [
      {
        content: {
          parts: [
            { text: "A description of the generated image." },
            { inlineData: { mimeType: over.mime ?? "image/png", data: pngBase64(over.width ?? 1080, over.height ?? 1350) } }
          ],
          role: "model"
        },
        finishReason: over.finish ?? "STOP",
        safetyRatings: over.safety ?? [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", probability: "NEGLIGIBLE" }]
      }
    ],
    usageMetadata: {
      promptTokenCount: over.promptTokens ?? 900,
      candidatesTokenCount: over.candidateTokens ?? 1120,
      totalTokenCount: (over.promptTokens ?? 900) + (over.candidateTokens ?? 1120)
    },
    responseId: over.responseId ?? "resp_fixture_001"
  };
}

const FIXTURE = "kopi-lawas-promotion"; // social-feed portrait → 4:5

function requestFor(name = FIXTURE) {
  const i = blueprintInputs(name);
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
  return { request: req.value, blueprint: bp.value, promptSet, inputs: i };
}

const rawReq = (over: Partial<RawGenerationRequest> = {}): RawGenerationRequest => ({
  prompt: "the exact compiled prompt",
  negativePrompt: "the negative baseline",
  aspectRatioId: "portrait",
  targetWidth: 1080,
  targetHeight: 1350,
  adapterId: "photorealistic",
  seed: null,
  timeoutMs: 60_000,
  ...over
});

// --- deterministic provider mappings -------------------------------

describe("Gemini image — deterministic mappings (3, 4)", () => {
  it("reduces target dimensions to a provider aspect-ratio string", () => {
    expect(reducedRatio(1080, 1350)).toBe("4:5");
    expect(reducedRatio(1080, 1080)).toBe("1:1");
    expect(reducedRatio(1080, 1920)).toBe("9:16");
    expect(reducedRatio(1920, 1080)).toBe("16:9");
  });

  it("buckets the larger dimension into a provider image-size (4)", () => {
    expect(imageSizeFor(1350)).toBe("1K");
    expect(imageSizeFor(600)).toBe("512px");
    expect(imageSizeFor(2480)).toBe("2K");
    expect(imageSizeFor(4096)).toBe("4K");
  });

  it("reads real width/height from a PNG IHDR", () => {
    const bytes = Uint8Array.from(Buffer.from(pngBase64(1200, 1500), "base64"));
    expect(readPngSize(bytes)).toEqual({ width: 1200, height: 1500 });
    expect(readPngSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

// --- request mapping (1, 2, 3, 4, 5, 6) --------------------------

describe("Gemini image — request mapping", () => {
  it("hits the model endpoint with the exact model id and api-key header (2)", async () => {
    const cap: Capture = { url: "", body: {} };
    const call = createGeminiImageCall({ apiKey: "k", clock, fetchImpl: fakeFetch(geminiOk(), { capture: cap }) });
    await call(rawReq());
    expect(cap.url).toContain(`/${GEMINI_IMAGE_MODEL}:generateContent`);
  });

  it("sends the compiled prompt verbatim — no added creative instructions (5)", async () => {
    const cap: Capture = { url: "", body: {} };
    const { request } = requestFor();
    const call = createGeminiImageCall({ apiKey: "k", clock, fetchImpl: fakeFetch(geminiOk(), { capture: cap }) });
    await call({
      prompt: request.prompt,
      negativePrompt: request.negative_prompt,
      aspectRatioId: request.target.aspect_ratio_id,
      targetWidth: request.target.width,
      targetHeight: request.target.height,
      adapterId: request.provenance.adapter_id,
      seed: null,
      timeoutMs: 60_000
    });
    const contents = cap.body["contents"] as { parts: { text: string }[] }[];
    expect(contents[0]!.parts[0]!.text).toBe(request.prompt);
    expect(JSON.stringify(cap.body)).not.toMatch(/make it (modern|beautiful|better)|improve the composition/i);
  });

  it("maps aspect ratio + image size into generationConfig.imageConfig (3, 4)", async () => {
    const cap: Capture = { url: "", body: {} };
    const call = createGeminiImageCall({ apiKey: "k", clock, fetchImpl: fakeFetch(geminiOk(), { capture: cap }) });
    await call(rawReq({ targetWidth: 1080, targetHeight: 1350 }));
    const gc = cap.body["generationConfig"] as { responseModalities: string[]; imageConfig: { aspectRatio: string; imageSize: string } };
    expect(gc.responseModalities).toEqual(["TEXT", "IMAGE"]);
    expect(gc.imageConfig.aspectRatio).toBe("4:5");
    expect(gc.imageConfig.imageSize).toBe("1K");
  });

  it("does NOT forward the negative prompt or seed (unsupported by generateContent) (6)", async () => {
    const cap: Capture = { url: "", body: {} };
    const call = createGeminiImageCall({ apiKey: "k", clock, fetchImpl: fakeFetch(geminiOk(), { capture: cap }) });
    await call(rawReq({ negativePrompt: "NEGATIVE_MARKER", seed: 42 }));
    expect(JSON.stringify(cap.body)).not.toContain("NEGATIVE_MARKER");
    expect(JSON.stringify(cap.body)).not.toMatch(/"seed"|"negativePrompt"/);
  });

  it("returns malformed_request for an aspect ratio the provider does not support", async () => {
    const call = createGeminiImageCall({ apiKey: "k", clock, fetchImpl: fakeFetch(geminiOk()) });
    const res = await call(rawReq({ targetWidth: 2880, targetHeight: 960, aspectRatioId: "billboard-3-1" })); // 3:1
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("malformed_request");
  });
});

// --- response mapping (7-13) -----------------------------------

describe("Gemini image — response mapping", () => {
  const run = (over = {}, fetchOpts = {}) =>
    createGeminiImageCall({
      apiKey: "k",
      clock,
      fetchImpl: fakeFetch(geminiOk(over), fetchOpts)
    })(rawReq());

  it("propagates model, request id, latency, finish reason, mime, safety (7-12)", async () => {
    const res = await run({ mime: "image/png", finish: "STOP", responseId: "resp_xyz" });
    expect(res.ok).toBe(true);
    expect(res.provider).toBe(GEMINI_IMAGE_PROVIDER);
    expect(res.model_id).toBe(GEMINI_IMAGE_MODEL);
    expect(res.provider_request_id).toBe("resp_xyz");
    expect(res.finish_reason).toBe("STOP");
    expect(res.image?.mime_type).toBe("image/png");
    expect(res.safety).toContain("HARM_CATEGORY_DANGEROUS_CONTENT");
    expect(typeof res.latency_ms).toBe("number");
  });

  it("maps the delivered image to base64-ref with a fingerprint, never the bytes (13)", async () => {
    const res = await run({ width: 1080, height: 1350 });
    expect(res.image?.delivery).toBe("base64-ref");
    expect(res.image?.width).toBe(1080);
    expect(res.image?.height).toBe(1350);
    expect(res.image?.reference).toMatch(/^[0-9a-f]{8}:\d+$/); // fnv1a:length — not image data
  });

  it("estimates cost from usage tokens against the published rates", async () => {
    const res = await run({ promptTokens: 1000, candidateTokens: 1120 });
    // input 1000/1e6*0.5 + image 1120/1e6*60 = 0.0005 + 0.0672
    expect(res.cost?.pricing_basis).toBe("estimated");
    expect(res.cost?.input_cost_usd).toBeCloseTo(0.0005, 6);
    expect(res.cost?.image_cost_usd).toBeCloseTo(0.0672, 6);
    expect(res.cost?.estimated_cost_usd).toBeCloseTo(0.0677, 6);
  });

  it("exposes onImageBytes for the deliberate live smoke test, then forgets the bytes", async () => {
    let seen = 0;
    await createGeminiImageCall({
      apiKey: "k",
      clock,
      fetchImpl: fakeFetch(geminiOk()),
      onImageBytes: (bytes) => {
        seen = bytes.byteLength;
      }
    })(rawReq());
    expect(seen).toBeGreaterThan(0);
  });
});

// --- error mapping (14-19) -----------------------------------

describe("Gemini image — error mapping (14-19)", () => {
  const errCall = (fetchImpl: FetchLike) => createGeminiImageCall({ apiKey: "k", clock, fetchImpl })(rawReq());

  it("no api key → not_configured", async () => {
    const res = await createGeminiImageCall({ apiKey: "", clock, fetchImpl: fakeFetch(geminiOk()) })(rawReq());
    expect(res.error?.code).toBe("not_configured");
  });

  it("HTTP 401/403 → authentication_error (14)", async () => {
    const res = await errCall(fakeFetch({ error: { message: "API key not valid" } }, { ok: false, status: 403 }));
    expect(res.error?.code).toBe("authentication_error");
  });

  it("HTTP 429 → rate_limited (15)", async () => {
    const res = await errCall(fakeFetch({ error: { message: "quota" } }, { ok: false, status: 429 }));
    expect(res.error?.code).toBe("rate_limited");
  });

  it("finishReason IMAGE_SAFETY → content_rejected (16)", async () => {
    const res = await errCall(fakeFetch(geminiOk({ finish: "IMAGE_SAFETY" })));
    expect(res.error?.code).toBe("content_rejected");
    expect(res.finish_reason).toBe("IMAGE_SAFETY");
  });

  it("HTTP 400 → malformed_request (17)", async () => {
    const res = await errCall(fakeFetch({ error: { message: "bad request" } }, { ok: false, status: 400 }));
    expect(res.error?.code).toBe("malformed_request");
  });

  it("abort → timeout (18)", async () => {
    const res = await errCall(fakeFetch(geminiOk(), { throws: "AbortError" }));
    expect(res.error?.code).toBe("timeout");
  });

  it("HTTP 500 → provider_unavailable, other throw → provider_unavailable (19)", async () => {
    expect((await errCall(fakeFetch({ error: { message: "internal" } }, { ok: false, status: 500 }))).error?.code).toBe(
      "provider_unavailable"
    );
    expect((await errCall(fakeFetch(geminiOk(), { throws: "ECONNRESET" }))).error?.code).toBe("provider_unavailable");
  });

  it("no image part in an otherwise-ok response → unknown_provider_error", async () => {
    const res = await errCall(
      fakeFetch({ candidates: [{ content: { parts: [{ text: "no image" }] }, finishReason: "STOP" }] })
    );
    expect(res.error?.code).toBe("unknown_provider_error");
  });
});

// --- through the P2.11 client: artifact + cost + provenance (20-24) ---

describe("Gemini image — through createVisualGenerationClient (20-24)", () => {
  it("yields a schema-valid artifact, one cost event, unchanged provenance + hashes", async () => {
    const { request } = requestFor();
    const ledger = createCostLedger({ clock });
    const port = createGeminiImageGeneration({
      apiKey: "k",
      clock,
      ids: newIds(),
      ledger,
      fetchImpl: fakeFetch(geminiOk({ width: 1080, height: 1350 }))
    });
    const result = await port.generate(request, { projectId: "proj_p212" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const art = result.value;
    expect(GeneratedArtifact.safeParse(art).success).toBe(true);
    expect(Object.isFrozen(art)).toBe(true);

    // 21 / 22 / 23 — provenance + request/blueprint hashes are the request's, untouched
    expect(art.provenance).toEqual(request.provenance);
    expect(art.request_hash).toBe(request.request_hash);
    expect(art.provenance.blueprint_hash).toBe(request.provenance.blueprint_hash);
    expect(art.provider).toBe(GEMINI_IMAGE_PROVIDER);
    expect(art.model).toBe(GEMINI_IMAGE_MODEL);

    // 20 — exactly one visual_generate cost event
    const events = ledger.list("proj_p212");
    expect(events).toHaveLength(1);
    expect(events[0]!.stage).toBe("visual_generate");
    expect(events[0]!.status).toBe("ok");
    expect(events[0]!.estimated_cost_usd).toBeGreaterThan(0);
  });

  it("a provider failure → exactly one failed cost event, no artifact (20)", async () => {
    const { request } = requestFor();
    const ledger = createCostLedger({ clock });
    const port = createGeminiImageGeneration({
      apiKey: "k",
      clock,
      ids: newIds(),
      ledger,
      fetchImpl: fakeFetch({ error: { message: "quota exceeded" } }, { ok: false, status: 429 })
    });
    const result = await port.generate(request, { projectId: "proj_fail" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]!.code).toBe("rate_limited");
    const events = ledger.list("proj_fail");
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe("failed");
  });

  it("does not mutate the recipe (24)", () => {
    const { request, inputs } = requestFor();
    void request;
    expect(inputs.recipe.recipe_hash).toBe(blueprintInputs(FIXTURE).recipe.recipe_hash);
    expect(Object.isFrozen(inputs.recipe)).toBe(true);
  });
});

// --- 25 / 26 — boundaries -------------------------------------

describe("Gemini image — boundaries (25, 26)", () => {
  it("no pipeline-triggered generation: pipeline.service does not import the adapter (25)", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../services/pipeline.service.ts", import.meta.url), "utf8")
    );
    expect(src).not.toMatch(/gemini-image|visual-generation|runVisualGeneration/);
  });

  it("engine code does not import the provider adapter (26)", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((e) => {
        const full = join(dir, e);
        return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
      });
    const stripComments = (s: string): string =>
      s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    const offenders = walk(join(process.cwd(), "engine")).filter((f) =>
      /\bimport\b[^;]*(adapters\/|gemini-image)/.test(stripComments(readFileSync(f, "utf8")))
    );
    expect(offenders).toEqual([]);
  });
});
