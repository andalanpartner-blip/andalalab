import { describe, expect, it } from "vitest";
import { datasets, clock, newIds } from "../fixtures/load";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger } from "../../services/cost.service";
import { buildExtractionSchema } from "../../engine/brief/extraction";
import { evaluateReadiness } from "../../engine/brief/readiness";
import { runBriefPipeline, type EngineDeps } from "../../services/pipeline.service";
import { llmFixture, RAW_SOLO_CREATIVE_EVENT_BRIEF } from "../fixtures/llm/raw";
import { conceptFixtureText } from "../fixtures/concepts/load";

/**
 * Regression — P2.7 debugging.
 *
 * The exact Indonesian browser brief below has every blocking field present or
 * safely inferable EXCEPT `industry_id`: "event kreatif anak muda" maps to no
 * loaded industry vocabulary, so the interpreter correctly returns null.
 *
 * Before the fix, `evaluateReadiness` marked `industry_id` missing but attached
 * NO clarification question, so the brief became NEEDS_CLARIFICATION with an
 * empty question list, and `runBriefPipeline` mapped that to `status: "ERROR"`
 * — the UI's "Something needs a second look" banner — even though the brief is
 * neither invalid nor an LLM failure.
 *
 * After the fix, a missing blocking field always carries a question, so the
 * brief lands in NEEDS_CLARIFICATION with the exact field and question, and the
 * UI shows the clarification form.
 */

const schema = buildExtractionSchema(datasets);
const parse = (name: string) => schema.parse(JSON.parse(llmFixture(name)));

const buildDeps = (script: { text: string }[]): EngineDeps => {
  const ledger = createCostLedger({ clock });
  const fake = createFakeLlm(script, { ledger, clock });
  return { datasets, llm: fake.port, ids: newIds(), clock };
};

describe("regression: Solo creative-event brief (unmapped industry)", () => {
  it("evaluateReadiness identifies the exact blocking field and asks about it", () => {
    const extraction = parse("12-solo-creative-event");
    const readiness = evaluateReadiness(extraction, datasets);

    expect(readiness.status).toBe("NEEDS_CLARIFICATION");
    expect(readiness.missing_fields).toEqual(["industry_id"]);
    expect(readiness.blocking_fields).toEqual(["industry_id"]);

    // The single-source-of-truth invariant that broke: NEEDS_CLARIFICATION
    // must never carry an empty question list.
    expect(readiness.questions.length).toBeGreaterThan(0);

    const industryQuestion = readiness.questions.find((q) => q.field === "industry_id");
    expect(industryQuestion).toBeDefined();
    expect(industryQuestion!.question).toBe(
      "Materi ini untuk jenis usaha atau kegiatan seperti apa — misalnya kuliner, fashion, properti, teknologi, atau hospitality?"
    );
    // Client-facing wording — never an internal field name.
    expect(industryQuestion!.question).not.toContain("industry_id");
  });

  it("the other blocking fields all resolve — only industry is unresolved", () => {
    const extraction = parse("12-solo-creative-event");
    const readiness = evaluateReadiness(extraction, datasets);
    for (const field of [
      "objective",
      "visual_type_id",
      "platform.channel",
      "platform.aspect_ratio_id",
      "audience.description",
      "country"
    ]) {
      expect(readiness.missing_fields).not.toContain(field);
    }
  });

  it("runBriefPipeline returns NEEDS_CLARIFICATION with a question, NOT a generic ERROR", async () => {
    const deps = buildDeps([{ text: llmFixture("12-solo-creative-event") }]);
    const result = await runBriefPipeline(deps, { rawBrief: RAW_SOLO_CREATIVE_EVENT_BRIEF });

    expect(result.status).toBe("NEEDS_CLARIFICATION");
    if (result.status !== "NEEDS_CLARIFICATION") return;

    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.questions.some((q) => q.field === "industry_id")).toBe(true);
    expect(result.rawBrief).toContain("event kreatif anak muda di Solo");
  });

  it("once the client answers the industry question, the same brief reaches READY", async () => {
    const deps = buildDeps([
      { text: llmFixture("13-solo-creative-event-clarified") },
      { text: conceptFixtureText("valid-set") }
    ]);

    const result = await runBriefPipeline(deps, {
      rawBrief: RAW_SOLO_CREATIVE_EVENT_BRIEF,
      answers: { industry_id: "Ini acara komunitas kuliner dan makanan lokal." }
    });

    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    expect(result.brief.industry_id).toBe("fnb");
    expect(result.brief.platform.channel).toBe("instagram-feed");
    expect(result.concepts.concepts.length).toBeGreaterThan(0);
  });
});
