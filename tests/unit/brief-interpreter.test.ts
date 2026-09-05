import { describe, expect, it } from "vitest";
import { datasets, clock, newIds } from "../fixtures/load";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger } from "../../services/cost.service";
import { normalizeBrief } from "../../engine/brief/normalize";
import { checkCompleteness, getReadinessDiagnostics } from "../../engine/brief/completeness";
import { buildExtractionSchema } from "../../engine/brief/extraction";
import { sanitizeExtraction, sourceOverlap, normaliseReference, cleanList } from "../../engine/brief/sanitize";
import { buildBriefNormalizerPrompt, BRIEF_NORMALIZER_TEMPLATE_VERSION } from "../../engine/brief/prompts/brief-normalizer";
import { fenced, llmFixture, MALFORMED, PROSE_ONLY, RAW_INDONESIAN_BRIEF } from "../fixtures/llm/raw";

const ledger = () => createCostLedger({ clock });
const schema = buildExtractionSchema(datasets);
const parse = (name: string) => schema.parse(JSON.parse(llmFixture(name)));

const run = async (script: Parameters<typeof createFakeLlm>[0], raw = RAW_INDONESIAN_BRIEF) => {
  const book = ledger();
  const fake = createFakeLlm(script, { ledger: book, clock });
  const result = await normalizeBrief({
    rawBrief: raw,
    projectId: "proj_brief",
    datasets,
    llm: fake.port,
    ids: newIds()
  });
  return { result, book, fake };
};

describe("prompt template", () => {
  it("is versioned", () => {
    expect(BRIEF_NORMALIZER_TEMPLATE_VERSION).toMatch(/^brief-normalizer@\d+\.\d+\.\d+$/);
  });

  it("lists only enum values that exist in the loaded datasets", () => {
    const prompt = buildBriefNormalizerPrompt(RAW_INDONESIAN_BRIEF, datasets);
    for (const id of datasets.industries.keys()) expect(prompt).toContain(id);
    for (const id of datasets.countries.keys()) expect(prompt).toContain(id);
    expect(prompt).not.toContain("healthcare");
  });

  it("instructs the model not to invent values", () => {
    const prompt = buildBriefNormalizerPrompt(RAW_INDONESIAN_BRIEF, datasets);
    expect(prompt).toContain("Never invent a value");
    expect(prompt).toContain("A null is a correct answer");
    expect(prompt).toContain("confidence is how certain you are that you EXTRACTED");
  });

  it("embeds the brief verbatim", () => {
    expect(buildBriefNormalizerPrompt(RAW_INDONESIAN_BRIEF, datasets)).toContain(
      "coffee shop baru di Solo"
    );
  });
});

describe("extraction schema rejects invented ids", () => {
  it("refuses an industry that is not in the dataset", () => {
    const bad = JSON.parse(llmFixture("07-invalid-enum"));
    const parsed = schema.safeParse(bad);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("industry_id.value");
      expect(paths).toContain("objective.value");
    }
  });

  it("rejects unknown extra keys rather than passing them through", () => {
    const extra = { ...JSON.parse(llmFixture("01-valid-indonesian")), dkv_targets: { contrast: 0.9 } };
    expect(schema.safeParse(extra).success).toBe(false);
  });
});

describe("sanitisation", () => {
  it("dedupes and trims lists", () => {
    expect(cleanList([" a ", "A", "", "b"])).toEqual(["a", "b"]);
  });

  it("strips tracking parameters from references", () => {
    expect(normaliseReference("https://example.com/x?utm_source=ig&id=3#top")).toBe(
      "https://example.com/x?id=3"
    );
  });

  it("leaves non-URL references alone", () => {
    expect(normaliseReference("  foto  latte  art ")).toBe("foto latte art");
  });

  it("measures how much of a phrase came from the brief", () => {
    expect(sourceOverlap("grand opening", RAW_INDONESIAN_BRIEF)).toBe(1);
    expect(sourceOverlap("sertifikat halal penghargaan barista", RAW_INDONESIAN_BRIEF)).toBe(0);
  });

  it("flags a mandatory the client never wrote", () => {
    const { warnings } = sanitizeExtraction(parse("11-invented-mandatory"), RAW_INDONESIAN_BRIEF);
    expect(warnings.some((line) => line.includes("Possible invention in mandatories"))).toBe(true);
  });

  it("normalises country weights that do not sum to 1", () => {
    const { extraction, warnings } = sanitizeExtraction(
      parse("01-valid-indonesian"),
      RAW_INDONESIAN_BRIEF
    );
    const total = extraction.countries.reduce((sum, entry) => sum + entry.weight, 0);
    expect(total).toBeCloseTo(1, 4);
    expect(warnings.length).toBeGreaterThanOrEqual(0);
  });

  it("surfaces contradictions the interpreter reported", () => {
    const { warnings } = sanitizeExtraction(parse("10-contradictions"), RAW_INDONESIAN_BRIEF);
    expect(warnings.filter((line) => line.includes("contradiction")).length).toBe(2);
  });
});

describe("completeness is deterministic", () => {
  it("marks a complete brief ready", () => {
    const report = checkCompleteness(parse("01-valid-indonesian"));
    expect(report.ready).toBe(true);
    expect(report.blocking_fields).toHaveLength(0);
    expect(report.completeness_score).toBeGreaterThan(0.7);
  });

  it("blocks a brief with no objective", () => {
    const report = checkCompleteness(parse("05-missing-objective"));
    expect(report.ready).toBe(false);
    expect(report.blocking_fields).toContain("objective");
  });

  it("reports several blocking fields for a very short brief", () => {
    const report = checkCompleteness(parse("02-very-short"));
    expect(report.ready).toBe(false);
    expect(report.blocking_fields).toEqual(
      expect.arrayContaining(["objective", "audience.description", "country"])
    );
    expect(report.completeness_score).toBeLessThan(0.6);
  });

  it("flags low-confidence fields even when they are present", () => {
    const report = checkCompleteness(parse("03-ambiguous"));
    const flagged = report.low_confidence_fields.map((entry) => entry.field);
    expect(flagged).toContain("objective");
    expect(flagged).toContain("industry_id");
  });

  it("separates derivable fields from genuinely optional ones", () => {
    const report = checkCompleteness(parse("01-valid-indonesian"));
    expect(report.derivable_fields).toContain("audience.attention_context");
    expect(report.optional_fields).toContain("movement_id");
  });

  it("does not block a valid brief when core_message is absent", () => {
    const extraction = parse("01-valid-indonesian");
    extraction.core_message.value = null;
    extraction.core_message.confidence = 0;
    const report = checkCompleteness(extraction);
    expect(report.ready).toBe(true);
    expect(report.optional_fields).toContain("core_message");
    expect(report.blocking_fields).not.toContain("core_message");
  });

  it("exposes stable readiness diagnostics without treating optional fields as blocking", () => {
    const ready = checkCompleteness(parse("01-valid-indonesian"));
    const readyDiagnostics = getReadinessDiagnostics(ready, ["core_message"]);
    expect(readyDiagnostics.ready).toBe(true);
    expect(readyDiagnostics.missing_blocking_fields).toEqual([]);
    expect(readyDiagnostics.blocking_fields).toEqual([
      "objective",
      "industry_id",
      "visual_type_id",
      "platform.channel",
      "platform.aspect_ratio_id",
      "audience.description",
      "country"
    ]);
    expect(readyDiagnostics.derived_fields).toEqual(["core_message"]);

    const extraction = parse("01-valid-indonesian");
    extraction.objective.value = null;
    extraction.industry_id.value = null;
    const incomplete = getReadinessDiagnostics(checkCompleteness(extraction));
    expect(incomplete.missing_blocking_fields).toEqual(["industry_id", "objective"]);
    expect(incomplete.missing_blocking_fields).not.toContain("core_message");
  });
});

describe("normalizeBrief", () => {
  it("turns the Indonesian brief into a valid NormalizedBrief in one call", async () => {
    const { result, book, fake } = await run([{ text: llmFixture("01-valid-indonesian") }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(fake.callCount()).toBe(1);
    expect(book.list("proj_brief")).toHaveLength(1);
    expect(result.value.brief).not.toBeNull();
    expect(result.value.meta.template_version).toBe(BRIEF_NORMALIZER_TEMPLATE_VERSION);

    const brief = result.value.brief!;
    expect(brief.objective).toBe("launch");
    expect(brief.industry_id).toBe("fnb");
    expect(brief.visual_type_id).toBe("social-feed");
    expect(brief.platform.aspect_ratio_id).toBe("portrait");
    expect(Object.keys(brief.country)).toEqual(["indonesia", "japan"]);
    expect(Object.values(brief.country).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
    expect(brief.raw_input).toBe(RAW_INDONESIAN_BRIEF);
  });

  it("derives a contract-safe core message with zero confidence", async () => {
    const extraction = JSON.parse(llmFixture("01-valid-indonesian"));
    extraction.core_message.value = null;
    extraction.core_message.confidence = 0;
    const { result } = await run([{ text: JSON.stringify(extraction) }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.brief).not.toBeNull();
    expect(result.value.brief?.core_message).toContain("launch communication for");
    expect(result.value.brief?.confidence.core_message).toBe(0);
    expect(result.value.derived.some((entry) => entry.includes("core_message"))).toBe(true);
  });

  it("derives platform and audience defaults and says which it derived", async () => {
    const { result } = await run([{ text: llmFixture("01-valid-indonesian") }]);
    if (!result.ok) throw new Error("expected success");

    const brief = result.value.brief!;
    expect(brief.platform.viewing_context).toBe("thumb");
    expect(brief.audience.attention_context).toBe("scroll");
    expect(brief.audience.sophistication).toBe(0.5);

    const derived = result.value.derived.join(" ");
    expect(derived).toContain("platform.viewing_context");
    expect(derived).toContain("audience.attention_context");
    expect(derived).toContain("audience.sophistication");
    // A derived value is recorded with confidence 0 — it was never stated.
    expect(brief.confidence["audience.attention_context"]).toBe(0);
  });

  it("returns no brief when a blocking field is missing, but still reports why", async () => {
    const { result } = await run([{ text: llmFixture("05-missing-objective") }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.brief).toBeNull();
    expect(result.value.completeness.ready).toBe(false);
    expect(result.value.completeness.blocking_fields).toContain("objective");
  });

  it("preserves an explicit country blend and movement request", async () => {
    const { result } = await run([{ text: llmFixture("04-explicit-country-movement") }]);
    if (!result.ok) throw new Error("expected success");
    const brief = result.value.brief!;
    expect(brief.movement_id).toBe("minimalism");
    expect(brief.country.japan).toBeCloseTo(0.7, 2);
    expect(brief.country.indonesia).toBeCloseTo(0.3, 2);
  });

  it("repairs an invalid enum and succeeds on the second call", async () => {
    const { result, book, fake } = await run([
      { text: llmFixture("07-invalid-enum") },
      { text: llmFixture("01-valid-indonesian") }
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fake.callCount()).toBe(2);
    expect(result.value.meta.repaired).toBe(true);
    expect(book.list("proj_brief")).toHaveLength(2);
    expect(fake.prompts[1]).toContain("industry_id.value");
  });

  it("gives up with typed issues when repair also fails", async () => {
    const { result, fake } = await run([{ text: MALFORMED }, { text: PROSE_ONLY }]);
    expect(result.ok).toBe(false);
    expect(fake.callCount()).toBe(2);
    if (!result.ok) {
      expect(result.error.some((issue) => issue.code === "invalid_json")).toBe(true);
      expect(result.error.every((issue) => issue.attempt <= 2)).toBe(true);
    }
  });

  it("tolerates a fenced response", async () => {
    const { result, fake } = await run([{ text: fenced("01-valid-indonesian") }]);
    expect(result.ok).toBe(true);
    expect(fake.callCount()).toBe(1);
  });

  it("rejects an empty brief without calling the model at all", async () => {
    const book = ledger();
    const fake = createFakeLlm([{ text: llmFixture("01-valid-indonesian") }], { ledger: book, clock });
    const result = await normalizeBrief({
      rawBrief: "   ",
      projectId: "proj_empty",
      datasets,
      llm: fake.port,
      ids: newIds()
    });
    expect(result.ok).toBe(false);
    expect(fake.callCount()).toBe(0);
    expect(book.list("proj_empty")).toHaveLength(0);
  });

  it("carries invention warnings out to the caller", async () => {
    const { result } = await run([{ text: llmFixture("11-invented-mandatory") }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.warnings.some((line) => line.includes("Possible invention"))).toBe(true);
  });
});
