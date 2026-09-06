import { describe, expect, it } from "vitest";
import { P1_BRIEFS, pipeline, datasets, clock, newIds } from "../fixtures/load";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger } from "../../services/cost.service";
import { compilePromptSet } from "../../engine/prompt/compile";
import { auditDesign } from "../../engine/critic/audit";
import { reviewDesign } from "../../engine/critic/review";
import { VisualReviewReport } from "../../types/schemas/visual-review.schema";
import { loadVisualEvidence } from "../fixtures/visual-evidence/load";
import { runBriefPipeline, runRecipePipeline, type EngineDeps } from "../../services/pipeline.service";
import { llmFixture, RAW_INDONESIAN_BRIEF } from "../fixtures/llm/raw";
import { conceptFixtureText } from "../fixtures/concepts/load";

/**
 * Golden cases for Visual Review (P4.1). Real pipeline, no LLM except the fake.
 * It must extend — never weaken — the P4.0 critic.
 */

const reviewFor = (name: string) => {
  const { contract, direction, recipe } = pipeline(name);
  const promptSet = compilePromptSet({ recipe, language: "en" });
  return {
    pre: auditDesign({ contract, direction, recipe, promptSet, promptLanguage: "en", concept: null }),
    review: reviewDesign({ contract, direction, recipe, promptSet, promptLanguage: "en", concept: null })
  };
};

describe("golden: every P1 fixture gets a schema-valid, deterministic review", () => {
  it.each(P1_BRIEFS)("%s", (name) => {
    const a = reviewFor(name);
    const b = reviewFor(name);
    expect(VisualReviewReport.safeParse(a.review).success).toBe(true);
    expect(b.review).toEqual(a.review);

    // P4.0 is embedded verbatim and its verdict is unchanged
    expect(a.review.pre_generation).toEqual(a.pre);

    // with no evidence, the review verdict tracks the pre-generation verdict
    expect(a.review.verdict).toBe(a.pre.verdict);

    // the two renderable dimensions are unassessed; overall score is null
    const renderable = a.review.dimensions.filter((d) => d.dimension !== "design_compliance");
    expect(renderable.every((d) => d.status === "unassessed" && d.score === null)).toBe(true);
    expect(a.review.overall.score).toBeNull();

    // no fact without evidence
    for (const issue of a.review.issues) {
      if (issue.basis === "unassessed") expect(issue.evidence).toEqual([]);
      else expect(issue.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe("golden: known scenarios", () => {
  it("brutalist-trust-conflict — the P0 pre-generation conflict still forces BLOCK", () => {
    const { review } = reviewFor("brutalist-trust-conflict");
    expect(review.verdict).toBe("BLOCK");
    const p0 = review.issues.find((i) => i.severity === "P0");
    expect(p0).toBeDefined();
    expect(p0!.dimension).toBe("design_compliance");
    expect(p0!.category).toBe("composition"); // the P0 conflict is on visual_density
    expect(p0!.basis).toBe("evidence-backed");
    expect(p0!.what).toMatch(/visual_density/);
  });

  it("kopi-lawas-promotion — clean pre-generation, everything renderable unassessed", () => {
    const { review } = reviewFor("kopi-lawas-promotion");
    expect(review.verdict).toBe("PASS");
    expect(review.overall.status).toBe("partially-assessed");
    expect(review.categories.filter((c) => c.status === "unassessed").map((c) => c.category)).toEqual(
      expect.arrayContaining(["composition", "hierarchy", "typography", "color", "imagery", "technical_quality"])
    );
  });
});

describe("golden: runRecipePipeline carries the review alongside the P4.0 critic", () => {
  const buildDeps = (script: { text: string }[]): EngineDeps => {
    const ledger = createCostLedger({ clock });
    const fake = createFakeLlm(script, { ledger, clock });
    return { datasets, llm: fake.port, ids: newIds(), clock };
  };

  it("returns both critic and review, and the review embeds that same critic", async () => {
    const deps = buildDeps([
      { text: llmFixture("01-valid-indonesian") },
      { text: conceptFixtureText("valid-set") }
    ]);
    const brief = await runBriefPipeline(deps, { rawBrief: RAW_INDONESIAN_BRIEF });
    if (brief.status !== "READY") return;
    const out = runRecipePipeline(deps, {
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected
    });
    expect(out.status).toBe("OK");
    if (out.status !== "OK") return;
    expect(out.review.pre_generation).toEqual(out.critic);
    expect(out.review.overall.score).toBeNull();
  });

  it("assesses the renderable dimensions when a matching VisualEvidence fixture is passed", async () => {
    const deps = buildDeps([
      { text: llmFixture("01-valid-indonesian") },
      { text: conceptFixtureText("valid-set") }
    ]);
    const brief = await runBriefPipeline(deps, { rawBrief: RAW_INDONESIAN_BRIEF });
    if (brief.status !== "READY") return;
    const first = runRecipePipeline(deps, {
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected
    });
    if (first.status !== "OK") return;

    const evidence = loadVisualEvidence("clean-render", {
      recipeHash: first.recipe.recipe_hash,
      expectedRatio: "4:5"
    });
    const out = runRecipePipeline(deps, {
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected,
      visualEvidence: evidence
    });
    expect(out.status).toBe("OK");
    if (out.status !== "OK") return;
    expect(out.review.dimensions.every((d) => d.status === "assessed")).toBe(true);
    expect(out.review.overall.score).not.toBeNull();
  });

  it("ignores unreadable evidence without erroring", async () => {
    const deps = buildDeps([
      { text: llmFixture("01-valid-indonesian") },
      { text: conceptFixtureText("valid-set") }
    ]);
    const brief = await runBriefPipeline(deps, { rawBrief: RAW_INDONESIAN_BRIEF });
    if (brief.status !== "READY") return;
    const out = runRecipePipeline(deps, {
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected,
      visualEvidence: { garbage: true }
    });
    expect(out.status).toBe("OK");
    if (out.status !== "OK") return;
    expect(out.review.overall.score).toBeNull();
  });
});
