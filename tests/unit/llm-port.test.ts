import { describe, expect, it } from "vitest";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger, estimateCostUsd, rateFor } from "../../services/cost.service";
import { fixedClock } from "../../ports/clock.port";
import { extractJson, buildRepairInstruction, MAX_ATTEMPTS } from "../../adapters/llm/structured-client";
import { fenced, llmFixture, MALFORMED, PROSE_ONLY } from "../fixtures/llm/raw";
import { z } from "zod";

const clock = fixedClock("2026-09-04T09:00:00.000Z");
const ledger = () => createCostLedger({ clock });

const Simple = z.object({ objective: z.string(), score: z.number().min(0).max(1) });
const options = {
  projectId: "proj_test",
  stage: "brief_normalize" as const,
  templateVersion: "brief-normalizer@1.0.0"
};

describe("JSON extraction", () => {
  it("parses a bare object", () => {
    expect(extractJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("recovers JSON from code fences and preamble", () => {
    const result = extractJson('Ini hasilnya:\n```json\n{"a":2}\n```');
    expect(result).toEqual({ ok: true, value: { a: 2 } });
  });

  it("fails cleanly on truncated JSON", () => {
    expect(extractJson(MALFORMED).ok).toBe(false);
  });

  it("fails cleanly on an empty response", () => {
    expect(extractJson("   ").ok).toBe(false);
  });
});

describe("repair instruction", () => {
  it("names the failing paths and forbids inventing values", () => {
    const parsed = Simple.safeParse({ objective: 1 });
    if (parsed.success) throw new Error("fixture should not validate");
    const instruction = buildRepairInstruction(parsed.error.issues, '{"objective":1}');
    expect(instruction).toContain("objective");
    expect(instruction).toContain("null rather than inventing");
  });
});

describe("structured client", () => {
  it("returns a validated value on the first call and books cost once", async () => {
    const book = ledger();
    const fake = createFakeLlm([{ text: '{"objective":"launch","score":0.5}' }], {
      ledger: book,
      clock
    });

    const result = await fake.port.generateStructured(Simple, "prompt", options);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value.objective).toBe("launch");
      expect(result.value.meta.attempts).toBe(1);
      expect(result.value.meta.repaired).toBe(false);
      expect(result.value.meta.status).toBe("ok");
    }
    expect(book.list("proj_test")).toHaveLength(1);
    expect(book.totalUsd("proj_test")).toBeGreaterThan(0);
  });

  it("repairs once and succeeds, booking a cost event per call", async () => {
    const book = ledger();
    const fake = createFakeLlm(
      [{ text: '{"objective":"launch","score":"not a number"}' }, { text: '{"objective":"launch","score":0.7}' }],
      { ledger: book, clock }
    );

    const result = await fake.port.generateStructured(Simple, "prompt", options);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.meta.attempts).toBe(2);
      expect(result.value.meta.repaired).toBe(true);
      expect(result.value.meta.status).toBe("repaired");
      // Tokens accumulate across both calls — you paid for both.
      expect(result.value.meta.input_tokens).toBe(2400);
    }
    expect(book.list("proj_test")).toHaveLength(2);
    expect(fake.prompts[1]).toContain("did not match the required schema");
  });

  it("never exceeds two model calls, even when repair fails", async () => {
    const book = ledger();
    const fake = createFakeLlm([{ text: PROSE_ONLY }, { text: PROSE_ONLY }, { text: PROSE_ONLY }], {
      ledger: book,
      clock
    });

    const result = await fake.port.generateStructured(Simple, "prompt", options);
    expect(result.ok).toBe(false);
    expect(fake.callCount()).toBe(MAX_ATTEMPTS);
    expect(book.list("proj_test")).toHaveLength(2);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.code === "invalid_json")).toBe(true);
    }
  });

  it("does not spend a repair call on a provider error", async () => {
    const book = ledger();
    const fake = createFakeLlm(
      [{ ok: false, error: { code: "rate_limited", message: "429" }, input_tokens: 0, output_tokens: 0 }],
      { ledger: book, clock }
    );

    const result = await fake.port.generateStructured(Simple, "prompt", options);
    expect(result.ok).toBe(false);
    expect(fake.callCount()).toBe(1);
    if (!result.ok) {
      expect(result.error[0]?.code).toBe("rate_limited");
      expect(result.error[0]?.retryable).toBe(true);
    }
    // A failed call still books an event, with status "failed".
    expect(book.list("proj_test")[0]?.status).toBe("failed");
  });

  it("catches a thrown provider exception and still books the attempt", async () => {
    const book = ledger();
    const fake = createFakeLlm([{ throws: "socket hang up" }], { ledger: book, clock });
    const result = await fake.port.generateStructured(Simple, "prompt", options);
    expect(result.ok).toBe(false);
    expect(book.list("proj_test")).toHaveLength(1);
  });

  it("accepts a fenced response without spending a repair call", async () => {
    const book = ledger();
    const fake = createFakeLlm([{ text: fenced("01-valid-indonesian") }], { ledger: book, clock });
    const result = await fake.port.generateStructured(z.record(z.unknown()), "prompt", options);
    expect(result.ok).toBe(true);
    expect(fake.callCount()).toBe(1);
  });
});

describe("cost ledger", () => {
  it("prices a known model from the published rate table", () => {
    // 1M input + 1M output on gemini-2.5-flash = 0.30 + 2.50
    expect(estimateCostUsd("gemini-2.5-flash", 1_000_000, 1_000_000)).toBeCloseTo(2.8, 6);
    expect(rateFor("gemini-2.5-flash").known).toBe(true);
  });

  it("still books an unknown model rather than recording zero", () => {
    expect(rateFor("gemini-99-ultra").known).toBe(false);
    expect(estimateCostUsd("gemini-99-ultra", 1_000_000, 0)).toBeGreaterThan(0);
  });

  it("keeps a realistic brief interpretation under a cent", () => {
    expect(estimateCostUsd("gemini-2.5-flash", 1600, 500)).toBeLessThan(0.01);
  });

  it("separates totals by project", async () => {
    const book = ledger();
    const fake = createFakeLlm([{ text: '{"objective":"launch","score":0.1}' }], {
      ledger: book,
      clock
    });
    await fake.port.generateStructured(Simple, "p", options);
    await fake.port.generateStructured(Simple, "p", { ...options, projectId: "proj_other" });
    expect(book.list("proj_test")).toHaveLength(1);
    expect(book.list("proj_other")).toHaveLength(1);
    expect(book.list()).toHaveLength(2);
  });

  it("logs accounting fields and never the prompt", async () => {
    const lines: Record<string, unknown>[] = [];
    const book = createCostLedger({ clock, logger: (_line, fields) => lines.push(fields) });
    const fake = createFakeLlm([{ text: '{"objective":"launch","score":0.1}' }], {
      ledger: book,
      clock
    });
    await fake.port.generateStructured(Simple, "SECRET PROMPT TEXT", options);

    expect(lines).toHaveLength(1);
    const serialised = JSON.stringify(lines[0]);
    expect(serialised).not.toContain("SECRET PROMPT TEXT");
    expect(lines[0]).toHaveProperty("estimated_cost_usd");
    expect(lines[0]).toHaveProperty("template_version");
  });

  it("enforces a per-project call cap when configured", async () => {
    const book = createCostLedger({ clock, maxCallsPerProject: 1 });
    const fake = createFakeLlm([{ text: '{"objective":"launch","score":0.1}' }], {
      ledger: book,
      clock
    });
    await fake.port.generateStructured(Simple, "p", options);
    await expect(fake.port.generateStructured(Simple, "p", options)).rejects.toThrow(
      /exceeded its cap/
    );
  });
});

describe("fixture sanity", () => {
  it("every structured fixture is parsable JSON", () => {
    for (const name of [
      "01-valid-indonesian",
      "02-very-short",
      "03-ambiguous",
      "04-explicit-country-movement",
      "05-missing-objective",
      "07-invalid-enum",
      "10-contradictions",
      "11-invented-mandatory"
    ]) {
      expect(() => JSON.parse(llmFixture(name))).not.toThrow();
    }
  });
});
