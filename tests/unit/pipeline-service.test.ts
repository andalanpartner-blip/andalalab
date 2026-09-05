import { describe, expect, it } from "vitest";
import { clock, datasets, newIds } from "../fixtures/load";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger } from "../../services/cost.service";
import { llmFixture, RAW_INDONESIAN_BRIEF } from "../fixtures/llm/raw";
import { conceptFixtureText } from "../fixtures/concepts/load";
import {
  runBriefPipeline,
  runRecipePipeline,
  type EngineDeps
} from "../../services/pipeline.service";

/**
 * These tests exercise the orchestration layer the API routes call, with a
 * scripted fake LLM standing in for Gemini — no network, no real API key.
 */

const buildDeps = (script: { text: string }[]): EngineDeps => {
  const ledger = createCostLedger({ clock });
  const fake = createFakeLlm(script, { ledger, clock });
  return { datasets, llm: fake.port, ids: newIds(), clock };
};

describe("runBriefPipeline", () => {
  it("runs brief -> contract -> direction -> concepts end to end", async () => {
    const deps = buildDeps([
      { text: llmFixture("01-valid-indonesian") },
      { text: conceptFixtureText("valid-set") }
    ]);

    const result = await runBriefPipeline(deps, { rawBrief: RAW_INDONESIAN_BRIEF });

    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;

    expect(result.contract.industry.id).toBe("fnb");
    expect(result.concepts.concepts.length).toBeGreaterThan(0);
    expect(result.directionSummary.movement.length).toBeGreaterThan(0);
    expect(result.directionSummary.whitespace).toBeGreaterThanOrEqual(0);
    expect(result.directionSummary.whitespace).toBeLessThanOrEqual(1);

    // The recipe stage is a separate round trip: contract/direction/concept
    // come back from the client exactly as this response sent them.
    const recipeOutcome = runRecipePipeline(deps, {
      contract: result.contract,
      direction: result.direction,
      concept: result.concepts.selected
    });

    expect(recipeOutcome.status).toBe("OK");
    if (recipeOutcome.status !== "OK") return;
    expect(recipeOutcome.recipe.contract_id).toBe(result.contract.id);
    expect(recipeOutcome.recipe.direction_id).toBe(result.direction.id);
    expect(recipeOutcome.recipe.concept_ref).toBe(result.concepts.selected.id);
  });

  it("asks for clarification instead of failing when the brief is too thin", async () => {
    const deps = buildDeps([{ text: llmFixture("02-very-short") }]);
    const result = await runBriefPipeline(deps, { rawBrief: "Bikin poster." });

    expect(result.status).toBe("NEEDS_CLARIFICATION");
    if (result.status !== "NEEDS_CLARIFICATION") return;
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.rawBrief).toBe("Bikin poster.");
  });

  it("re-runs with appended answers and can reach READY", async () => {
    const deps = buildDeps([
      { text: llmFixture("02-very-short") },
      { text: llmFixture("01-valid-indonesian") },
      { text: conceptFixtureText("valid-set") }
    ]);

    const first = await runBriefPipeline(deps, { rawBrief: "Bikin poster." });
    expect(first.status).toBe("NEEDS_CLARIFICATION");
    if (first.status !== "NEEDS_CLARIFICATION") return;

    const second = await runBriefPipeline(deps, {
      rawBrief: first.rawBrief,
      answers: { "0": "Grand opening coffee shop di Solo untuk anak muda." }
    });
    expect(second.status).toBe("READY");
  });

  it("never exposes provider details when the model call fails", async () => {
    const deps: EngineDeps = {
      datasets,
      ids: newIds(),
      clock,
      llm: {
        generateStructured: async () => ({
          ok: false,
          error: [
            { code: "not_configured", message: "GEMINI_API_KEY is not set", attempt: 1, retryable: false }
          ]
        })
      }
    };

    const result = await runBriefPipeline(deps, { rawBrief: RAW_INDONESIAN_BRIEF });

    expect(result.status).toBe("ERROR");
    if (result.status !== "ERROR") return;
    expect(result.message).not.toMatch(/GEMINI_API_KEY|stack|provider_error/i);
  });

  it("rejects an empty brief without calling the model", async () => {
    const deps = buildDeps([]);
    const result = await runBriefPipeline(deps, { rawBrief: "   " });
    expect(result.status).toBe("ERROR");
  });

  it("asks a real question when only industry_id / visual_type_id are unresolved (no dead-end)", async () => {
    // Every blocking field that is missing now carries a clarification question,
    // so a brief missing only industry_id and visual_type_id is a normal
    // NEEDS_CLARIFICATION the clarify form can render — not a questionless
    // state the pipeline has to translate into a generic error.
    const extraction = JSON.parse(llmFixture("01-valid-indonesian")) as Record<string, unknown>;
    extraction["industry_id"] = { value: null, confidence: 0 };
    extraction["visual_type_id"] = { value: null, confidence: 0 };

    const deps = buildDeps([{ text: JSON.stringify(extraction) }]);
    const result = await runBriefPipeline(deps, { rawBrief: "Bikin poster dong." });

    expect(result.status).toBe("NEEDS_CLARIFICATION");
    if (result.status !== "NEEDS_CLARIFICATION") return;
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.questions.map((q) => q.field)).toEqual(
      expect.arrayContaining(["industry_id", "visual_type_id"])
    );
    expect(result.rawBrief).toBe("Bikin poster dong.");
  });
});

describe("runRecipePipeline", () => {
  it("rejects a tampered or incomplete payload without touching the engine", () => {
    const result = runRecipePipeline(
      { datasets, ids: newIds(), clock },
      { contract: { not: "a contract" }, direction: {}, concept: null }
    );
    expect(result.status).toBe("ERROR");
  });
});
