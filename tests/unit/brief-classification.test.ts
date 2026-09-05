import { describe, expect, it } from "vitest";
import { datasets, clock, newIds } from "../fixtures/load";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger } from "../../services/cost.service";
import { buildExtractionSchema, type BriefExtraction } from "../../engine/brief/extraction";
import {
  classifyBrief,
  HIGH_CONFIDENCE,
  INDUSTRY_ALIASES,
  type ClassificationDiagnostic
} from "../../engine/brief/classify";
import { progressiveBriefing } from "../../engine/brief/progressive-briefing";
import { runBriefPipeline, type EngineDeps } from "../../services/pipeline.service";
import { conceptFixtureText } from "../fixtures/concepts/load";
import {
  llmFixture,
  RAW_SOLO_EVENT_ANAK_MUDA_BRIEF,
  RAW_CAMPAIGN_FASHION_PEREMPUAN_URBAN_BRIEF,
  RAW_PROMO_COFFEE_SHOP_GENZ_BRIEF,
  RAW_POSTER_KOMUNITAS_KREATIF_BRIEF,
  RAW_POSTER_BISNIS_SAYA_BRIEF,
  RAW_COFFEE_SHOP_ALIAS_READY_BRIEF
} from "../fixtures/llm/raw";

/**
 * P2.8 — Smart Brief Classification & Expanded Industry/Audience Intelligence.
 *
 * The classifier is deterministic and additive: it fills a canonical
 * `industry_id` / `audience.description` only from curated Indonesian/English
 * aliases in the brief text, only above HIGH_CONFIDENCE, and never invents an
 * id. `evaluateReadiness` stays the single gate — see
 * docs/smart-brief-classification.md.
 */

const schema = buildExtractionSchema(datasets);
const parse = (name: string): BriefExtraction =>
  schema.parse(JSON.parse(llmFixture(name)));

const buildDeps = (script: { text: string }[]): EngineDeps => {
  const ledger = createCostLedger({ clock });
  const fake = createFakeLlm(script, { ledger, clock });
  return { datasets, llm: fake.port, ids: newIds(), clock };
};

const briefing = (fixture: string, rawBrief: string) => {
  const ledger = createCostLedger({ clock });
  const fake = createFakeLlm([{ text: llmFixture(fixture) }], { ledger, clock });
  return progressiveBriefing({
    rawBrief,
    projectId: "proj_p28",
    datasets,
    llm: fake.port,
    ids: newIds()
  });
};

const diag = (
  classifications: readonly ClassificationDiagnostic[],
  field: string
): ClassificationDiagnostic | undefined => classifications.find((c) => c.field === field);

describe("P2.8 alias tables are honest", () => {
  it("every industry alias points at a loaded canonical industry", () => {
    for (const alias of INDUSTRY_ALIASES) {
      expect(datasets.industries.has(alias.industry_id)).toBe(true);
    }
  });
});

describe("classifyBrief — industry", () => {
  it("keeps an explicit LLM industry and marks it explicit", () => {
    const extraction = parse("25-coffee-shop-alias-ready");
    extraction.industry_id = { value: "fnb", confidence: 0.97 };
    const { extraction: next, diagnostics } = classifyBrief(extraction, "apa saja", datasets);
    expect(next.industry_id.value).toBe("fnb");
    expect(diag(diagnostics, "industry_id")).toMatchObject({
      value: "fnb",
      source: "explicit"
    });
  });

  it("maps a high-confidence alias phrase to the canonical id", () => {
    const extraction = parse("22-promo-coffee-shop-genz");
    const { extraction: next, diagnostics } = classifyBrief(
      extraction,
      "Buat promo coffee shop untuk Gen Z.",
      datasets
    );
    expect(next.industry_id.value).toBe("fnb");
    const d = diag(diagnostics, "industry_id")!;
    expect(d.source).toBe("alias");
    expect(d.confidence).toBeGreaterThanOrEqual(HIGH_CONFIDENCE);
    expect(d.evidence).toBe("coffee shop");
  });

  it("leaves industry null and unresolved when nothing in the taxonomy matches", () => {
    const extraction = parse("20-solo-event-anak-muda");
    const { extraction: next, diagnostics } = classifyBrief(
      extraction,
      "Buat poster untuk event kreatif komunitas anak muda.",
      datasets
    );
    expect(next.industry_id.value).toBeNull();
    expect(diag(diagnostics, "industry_id")).toMatchObject({
      value: null,
      source: "unresolved"
    });
  });

  it("does not resolve when two different industries are named — stays unresolved", () => {
    const extraction = parse("24-poster-bisnis-saya");
    const { extraction: next, diagnostics } = classifyBrief(
      extraction,
      "Materi untuk coffee shop di dalam hotel butik kami.",
      datasets
    );
    expect(next.industry_id.value).toBeNull();
    const d = diag(diagnostics, "industry_id")!;
    expect(d.source).toBe("unresolved");
    expect(d.evidence).toContain("coffee shop");
  });

  it("a below-threshold single match is reported but does not satisfy the field", () => {
    const extraction = parse("24-poster-bisnis-saya");
    const { extraction: next, diagnostics } = classifyBrief(
      extraction,
      "Poster untuk salon kecil kami.",
      datasets
    );
    expect(next.industry_id.value).toBeNull();
    const d = diag(diagnostics, "industry_id")!;
    expect(d.source).toBe("alias");
    expect(d.confidence).toBeLessThan(HIGH_CONFIDENCE);
    expect(d.value).toBeNull();
  });
});

describe("classifyBrief — audience", () => {
  it("fills audience from a verbatim high-confidence signal", () => {
    const extraction = parse("21-campaign-fashion-perempuan-urban");
    const { extraction: next, diagnostics } = classifyBrief(
      extraction,
      RAW_CAMPAIGN_FASHION_PEREMPUAN_URBAN_BRIEF,
      datasets
    );
    expect(next.audience.description.value).toBe("perempuan urban");
    expect(diag(diagnostics, "audience.description")).toMatchObject({
      source: "alias",
      value: "perempuan urban"
    });
  });

  it("recognizes an English signal and quotes the brief casing", () => {
    const extraction = parse("22-promo-coffee-shop-genz");
    const { extraction: next } = classifyBrief(
      extraction,
      RAW_PROMO_COFFEE_SHOP_GENZ_BRIEF,
      datasets
    );
    expect(next.audience.description.value).toBe("Gen Z");
  });

  it("keeps a low-confidence audience signal unresolved (komunitas kreatif)", () => {
    const extraction = parse("23-poster-komunitas-kreatif");
    const { extraction: next, diagnostics } = classifyBrief(
      extraction,
      RAW_POSTER_KOMUNITAS_KREATIF_BRIEF,
      datasets
    );
    expect(next.audience.description.value).toBeNull();
    const d = diag(diagnostics, "audience.description")!;
    expect(d.source).toBe("alias");
    expect(d.confidence).toBeLessThan(HIGH_CONFIDENCE);
  });
});

describe("P2.8 regression — natural Indonesian briefs", () => {
  it("A — 'event kreatif anak muda di Solo' still asks only about industry", async () => {
    const result = await briefing("20-solo-event-anak-muda", RAW_SOLO_EVENT_ANAK_MUDA_BRIEF);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.readiness.status).toBe("NEEDS_CLARIFICATION");
    expect(result.value.readiness.missing_fields).toEqual(["industry_id"]);
    expect(result.value.readiness.questions.some((q) => q.field === "industry_id")).toBe(true);
    expect(diag(result.value.classifications, "industry_id")).toMatchObject({
      source: "unresolved",
      value: null
    });
  });

  it("B — 'campaign fashion untuk perempuan urban' resolves industry + audience, still needs the rest", async () => {
    const result = await briefing(
      "21-campaign-fashion-perempuan-urban",
      RAW_CAMPAIGN_FASHION_PEREMPUAN_URBAN_BRIEF
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(diag(result.value.classifications, "industry_id")).toMatchObject({
      source: "explicit",
      value: "fashion"
    });
    expect(diag(result.value.classifications, "audience.description")).toMatchObject({
      source: "alias",
      value: "perempuan urban"
    });

    expect(result.value.readiness.status).toBe("NEEDS_CLARIFICATION");
    expect(result.value.readiness.missing_fields).not.toContain("industry_id");
    expect(result.value.readiness.missing_fields).not.toContain("audience.description");
    expect(result.value.readiness.missing_fields).toContain("objective");
  });

  it("C — 'promo coffee shop untuk Gen Z' maps coffee shop -> fnb via alias", async () => {
    const result = await briefing("22-promo-coffee-shop-genz", RAW_PROMO_COFFEE_SHOP_GENZ_BRIEF);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const industry = diag(result.value.classifications, "industry_id")!;
    expect(industry.source).toBe("alias");
    expect(industry.value).toBe("fnb");
    expect(industry.evidence).toBe("coffee shop");
    expect(industry.confidence).toBeGreaterThanOrEqual(HIGH_CONFIDENCE);

    expect(result.value.readiness.status).toBe("NEEDS_CLARIFICATION");
    expect(result.value.readiness.missing_fields).not.toContain("industry_id");
    expect(result.value.readiness.missing_fields).not.toContain("audience.description");
    expect(result.value.readiness.missing_fields).toEqual(
      expect.arrayContaining(["platform.channel", "country"])
    );
  });

  it("D — 'poster komunitas kreatif' stays NEEDS_CLARIFICATION, nothing silently guessed", async () => {
    const result = await briefing("23-poster-komunitas-kreatif", RAW_POSTER_KOMUNITAS_KREATIF_BRIEF);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.readiness.status).toBe("NEEDS_CLARIFICATION");
    expect(result.value.readiness.missing_fields).toEqual(
      expect.arrayContaining(["industry_id", "audience.description", "objective"])
    );
    expect(diag(result.value.classifications, "industry_id")).toMatchObject({ source: "unresolved" });
    // The audience phrase is present but too weak to satisfy the field.
    expect(diag(result.value.classifications, "audience.description")).toMatchObject({
      source: "alias",
      value: null
    });
    expect(result.value.brief).toBeNull();
  });

  it("E — 'poster untuk bisnis saya' resolves nothing and asks", async () => {
    const result = await briefing("24-poster-bisnis-saya", RAW_POSTER_BISNIS_SAYA_BRIEF);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.readiness.status).toBe("NEEDS_CLARIFICATION");
    expect(diag(result.value.classifications, "industry_id")).toMatchObject({
      source: "unresolved",
      value: null,
      evidence: null
    });
    expect(diag(result.value.classifications, "audience.description")).toMatchObject({
      source: "unresolved",
      value: null
    });
  });

  it("F — end to end: 'coffee shop' alias carries a full brief to READY and into the design pipeline", async () => {
    const deps = buildDeps([
      { text: llmFixture("25-coffee-shop-alias-ready") },
      { text: conceptFixtureText("valid-set") }
    ]);

    const result = await runBriefPipeline(deps, { rawBrief: RAW_COFFEE_SHOP_ALIAS_READY_BRIEF });

    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    expect(result.brief.industry_id).toBe("fnb");
    expect(result.contract.industry.id).toBe("fnb");
    expect(result.concepts.concepts.length).toBeGreaterThan(0);
  });
});
