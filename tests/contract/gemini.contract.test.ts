import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  createGeminiCall,
  createGeminiLlm,
  readGeminiText,
  DEFAULT_GEMINI_MODEL,
  GEMINI_PROVIDER,
  type FetchLike
} from "../../adapters/llm/gemini";
import { createCostLedger } from "../../services/cost.service";
import { fixedClock } from "../../ports/clock.port";
import { datasets } from "../fixtures/load";
import { buildExtractionSchema } from "../../engine/brief/extraction";

/**
 * Contract tests replay recorded Gemini responses. No network access, ever —
 * CI must not depend on a third party being up or on someone's quota.
 */

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/gemini", `${name}.json`), "utf8"));

const clock = fixedClock("2026-09-04T09:00:00.000Z");

type Recorded = { status: number; body: unknown };

const replay = (recorded: Recorded, capture?: { url?: string; init?: unknown }): FetchLike =>
  async (url, init) => {
    if (capture) {
      capture.url = url;
      capture.init = init;
    }
    return {
      ok: recorded.status >= 200 && recorded.status < 300,
      status: recorded.status,
      json: async () => recorded.body,
      text: async () => JSON.stringify(recorded.body)
    };
  };

const request = {
  prompt: "prompt",
  timeoutMs: 5000,
  maxOutputTokens: 2048,
  temperature: 0
};

describe("Gemini response reading", () => {
  it("joins multi-part candidates", () => {
    expect(readGeminiText(fixture("multipart") as never)).toBe(
      '{"objective": {"value": "launch", "confidence": 0.9}}'
    );
  });
});

describe("Gemini adapter contract", () => {
  it("reports provider, model and token metadata from a recorded success", async () => {
    const call = createGeminiCall({ apiKey: "test-key", clock, fetchImpl: replay({ status: 200, body: fixture("success") }) });
    const response = await call(request);

    expect(response.ok).toBe(true);
    expect(response.provider).toBe(GEMINI_PROVIDER);
    expect(response.model_id).toBe(DEFAULT_GEMINI_MODEL);
    expect(response.input_tokens).toBe(1683);
    expect(response.output_tokens).toBe(512);
    expect(response.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("sends the key in a header and never in the URL", async () => {
    const capture: { url?: string; init?: unknown } = {};
    const call = createGeminiCall({
      apiKey: "super-secret-key",
      clock,
      fetchImpl: replay({ status: 200, body: fixture("success") }, capture)
    });
    await call(request);

    expect(capture.url).not.toContain("super-secret-key");
    expect(capture.url).toContain(`${DEFAULT_GEMINI_MODEL}:generateContent`);
    const init = capture.init as { headers: Record<string, string>; body: string };
    expect(init.headers["x-goog-api-key"]).toBe("super-secret-key");
    expect(init.body).not.toContain("super-secret-key");
    expect(JSON.parse(init.body).generationConfig.responseMimeType).toBe("application/json");
  });

  it("passes an explicitly selected model to the generateContent endpoint", async () => {
    const capture: { url?: string } = {};
    const selectedModel = "gemini-3.1-flash-lite";
    const call = createGeminiCall({
      apiKey: "test-key",
      model: selectedModel,
      clock,
      fetchImpl: replay({ status: 200, body: fixture("success") }, capture)
    });

    await call(request);

    expect(capture.url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent`
    );
  });

  it("maps a 429 to a retryable rate_limited issue", async () => {
    const call = createGeminiCall({ apiKey: "k", clock, fetchImpl: replay({ status: 429, body: fixture("rate-limited") }) });
    const response = await call(request);
    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("rate_limited");
  });

  it("maps a 403 to not_configured", async () => {
    const call = createGeminiCall({
      apiKey: "k",
      clock,
      fetchImpl: replay({ status: 403, body: { error: { code: 403, message: "API key not valid" } } })
    });
    expect((await call(request)).error?.code).toBe("not_configured");
  });

  it("treats a truncated empty candidate as empty_response, not as success", async () => {
    const call = createGeminiCall({ apiKey: "k", clock, fetchImpl: replay({ status: 200, body: fixture("empty") }) });
    const response = await call(request);
    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("empty_response");
    expect(response.error?.message).toContain("MAX_TOKENS");
    // Tokens were still consumed and are still reported.
    expect(response.input_tokens).toBe(1683);
  });

  it("fails fast when no API key is configured, without calling out", async () => {
    let called = false;
    const call = createGeminiCall({
      apiKey: "",
      clock,
      fetchImpl: async () => {
        called = true;
        throw new Error("should not be reached");
      }
    });
    const response = await call(request);
    expect(called).toBe(false);
    expect(response.error?.code).toBe("not_configured");
  });

  it("surfaces a thrown network error as provider_error", async () => {
    const call = createGeminiCall({
      apiKey: "k",
      clock,
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      }
    });
    expect((await call(request)).error?.code).toBe("provider_error");
  });

  it("validates a recorded response against the real extraction schema", async () => {
    const ledger = createCostLedger({ clock });
    const llm = createGeminiLlm({
      apiKey: "k",
      clock,
      ledger,
      fetchImpl: replay({ status: 200, body: fixture("success") })
    });

    const result = await llm.generateStructured(buildExtractionSchema(datasets), "prompt", {
      projectId: "proj_contract",
      stage: "brief_normalize",
      templateVersion: "brief-normalizer@1.0.0"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value.industry_id.value).toBe("fnb");
      expect(result.value.meta.provider).toBe(GEMINI_PROVIDER);
      expect(result.value.meta.attempts).toBe(1);
    }
    const events = ledger.list("proj_contract");
    expect(events).toHaveLength(1);
    expect(events[0]?.model_id).toBe(DEFAULT_GEMINI_MODEL);
    expect(events[0]?.estimated_cost_usd).toBeGreaterThan(0);
  });

  it("books cost for a failed provider call too", async () => {
    const ledger = createCostLedger({ clock });
    const llm = createGeminiLlm({
      apiKey: "k",
      clock,
      ledger,
      fetchImpl: replay({ status: 429, body: fixture("rate-limited") })
    });
    const result = await llm.generateStructured(z.object({ a: z.string() }), "prompt", {
      projectId: "proj_fail",
      stage: "brief_normalize",
      templateVersion: "brief-normalizer@1.0.0"
    });
    expect(result.ok).toBe(false);
    expect(ledger.list("proj_fail")[0]?.status).toBe("failed");
  });
});
