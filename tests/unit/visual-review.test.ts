import { describe, expect, it } from "vitest";
import { pipeline } from "../fixtures/load";
import { compilePromptSet } from "../../engine/prompt/compile";
import { auditDesign } from "../../engine/critic/audit";
import { reviewDesign } from "../../engine/critic/review";
import { loadVisualEvidence } from "../fixtures/visual-evidence/load";
import { VisualReviewReport, DOCTRINE_PRINCIPLES } from "../../types/schemas/visual-review.schema";

/**
 * Visual Review (P4.1) — the image-measuring half of the Design Critic.
 *
 * Deterministic, read-only. Extends P4.0: the pre-generation report is embedded
 * verbatim, and visual/technical quality is `unassessed` until a structured
 * `VisualEvidence` fixture is supplied. No claim without evidence.
 */

const review = (name: string, evidence?: Parameters<typeof reviewDesign>[0]["visualEvidence"]) => {
  const { contract, direction, recipe } = pipeline(name);
  return reviewDesign({
    contract,
    direction,
    recipe,
    promptSet: compilePromptSet({ recipe, language: "en" }),
    promptLanguage: "en",
    concept: null,
    visualEvidence: evidence ?? null
  });
};

describe("shape and doctrine", () => {
  it("is schema-valid and lists the seven doctrine principles in order", () => {
    const r = review("kopi-lawas-promotion");
    expect(VisualReviewReport.safeParse(r).success).toBe(true);
    expect(r.doctrine).toEqual([...DOCTRINE_PRINCIPLES]);
    expect(r.dimensions).toHaveLength(3);
    expect(r.categories).toHaveLength(12);
  });

  it("embeds the P4.0 report verbatim, never re-derived", () => {
    const { contract, direction, recipe } = pipeline("hardstone-property-trust");
    const promptSet = compilePromptSet({ recipe, language: "en" });
    const pre = auditDesign({ contract, direction, recipe, promptSet, promptLanguage: "en", concept: null });
    const r = reviewDesign({ contract, direction, recipe, promptSet, promptLanguage: "en", concept: null });
    expect(r.pre_generation).toEqual(pre);
  });

  it("is deterministic — identical inputs give an identical report", () => {
    expect(review("northbeam-saas-launch")).toEqual(review("northbeam-saas-launch"));
  });

  it("never mutates the recipe", () => {
    const { contract, direction, recipe } = pipeline("kopi-lawas-promotion");
    const before = JSON.stringify(recipe);
    reviewDesign({ contract, direction, recipe, promptSet: compilePromptSet({ recipe, language: "en" }), promptLanguage: "en", concept: null });
    expect(JSON.stringify(recipe)).toBe(before);
    expect(Object.isFrozen(recipe)).toBe(true);
  });
});

describe("no evidence — the renderable dimensions are honestly unassessed", () => {
  const r = review("kopi-lawas-promotion");

  it("marks visual_quality and technical_quality unassessed with a null score", () => {
    for (const dim of ["visual_quality", "technical_quality"] as const) {
      const d = r.dimensions.find((x) => x.dimension === dim)!;
      expect(d.status).toBe("unassessed");
      expect(d.basis).toBe("unassessed");
      expect(d.score).toBeNull();
    }
  });

  it("keeps the overall score null and the status partially-assessed", () => {
    expect(r.overall.score).toBeNull();
    expect(r.overall.status).toBe("partially-assessed");
  });

  it("emits one explicit 'not assessed' issue per renderable dimension, with no evidence", () => {
    const unassessed = r.issues.filter((i) => i.basis === "unassessed");
    expect(unassessed).toHaveLength(2);
    for (const issue of unassessed) {
      expect(issue.evidence).toEqual([]);
      expect(issue.severity).toBe("P3");
      expect(issue.what.toLowerCase()).toContain("not assessed");
    }
  });

  it("still maps every P4.0 finding into an evidence-backed compliance issue", () => {
    const block = review("brutalist-trust-conflict");
    const compliance = block.issues.filter((i) => i.dimension === "design_compliance");
    expect(compliance.length).toBeGreaterThan(0);
    for (const issue of compliance) {
      expect(issue.basis).toBe("evidence-backed");
      expect(issue.evidence.length).toBeGreaterThan(0);
      expect(issue.what.length).toBeGreaterThan(0);
      expect(issue.why.length).toBeGreaterThan(0);
      expect(issue.impact.length).toBeGreaterThan(0);
      expect(issue.fix.length).toBeGreaterThan(0);
    }
    // a P0 pre-generation finding still forces BLOCK
    expect(block.verdict).toBe("BLOCK");
    expect(block.pre_generation.verdict).toBe("BLOCK");
  });
});

describe("with a matching VisualEvidence fixture — the renderable dimensions become fixture-backed", () => {
  const { recipe } = pipeline("kopi-lawas-promotion");
  const clean = loadVisualEvidence("clean-render", { recipeHash: recipe.recipe_hash, expectedRatio: "4:5" });
  const weak = loadVisualEvidence("weak-hierarchy-render", { recipeHash: recipe.recipe_hash, expectedRatio: "4:5" });

  it("a clean render assesses all three dimensions and yields a real overall score", () => {
    const r = review("kopi-lawas-promotion", clean);
    expect(r.dimensions.every((d) => d.status === "assessed")).toBe(true);
    const vq = r.dimensions.find((d) => d.dimension === "visual_quality")!;
    expect(vq.basis).toBe("fixture-backed");
    expect(r.overall.score).not.toBeNull();
    expect(r.overall.status).toBe("assessed");
    expect(r.verdict).toBe("PASS");
    expect(r.audited.visual_evidence_ref).toBe("ve_clean_render");
  });

  it("a render concern becomes a fixture-backed issue with evidence, never a bare fact", () => {
    const r = review("kopi-lawas-promotion", weak);
    const fixtureBacked = r.issues.filter((i) => i.basis === "fixture-backed");
    expect(fixtureBacked.length).toBeGreaterThan(0);
    for (const issue of fixtureBacked) {
      expect(issue.evidence.length).toBeGreaterThan(0);
      expect(issue.evidence.join(" ")).toMatch(/observed by/);
    }
    // the banding artifact is a P1 -> REVIEW
    expect(r.verdict).toBe("REVIEW");
    expect(r.issues.some((i) => i.category === "technical_quality" && i.severity === "P1")).toBe(true);
    expect(r.issues.some((i) => i.category === "hierarchy" && i.dimension === "visual_quality")).toBe(true);
  });

  it("rejects stale evidence — a hash mismatch keeps the dimensions unassessed", () => {
    const stale = loadVisualEvidence("clean-render", { recipeHash: "deadbeef", expectedRatio: "4:5" });
    const r = review("kopi-lawas-promotion", stale);
    expect(r.audited.visual_evidence_stale).toBe(true);
    expect(r.audited.visual_evidence_ref).toBeNull();
    expect(r.dimensions.find((d) => d.dimension === "visual_quality")!.status).toBe("unassessed");
    expect(r.overall.score).toBeNull();
  });

  it("flags a wrong-ratio render as a P1 technical issue", () => {
    const wrongRatio = loadVisualEvidence("clean-render", {
      recipeHash: recipe.recipe_hash,
      expectedRatio: "4:5",
      observedRatio: "1:1"
    });
    const r = review("kopi-lawas-promotion", wrongRatio);
    const ratioIssue = r.issues.find((i) => i.category === "technical_quality" && i.what.includes("1:1"));
    expect(ratioIssue).toBeDefined();
    expect(ratioIssue!.severity).toBe("P1");
    expect(ratioIssue!.basis).toBe("fixture-backed");
    expect(r.verdict).toBe("REVIEW");
  });
});

describe("brand_fit is unassessed when no brand was supplied", () => {
  it("marks the brand_fit category unassessed for a brandless brief", () => {
    const r = review("minimal-promo-cta");
    const brand = r.categories.find((c) => c.category === "brand_fit")!;
    // minimal-promo-cta carries no brand_id
    expect(brand.status).toBe("unassessed");
  });
});
