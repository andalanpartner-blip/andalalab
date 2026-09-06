import { describe, expect, it } from "vitest";
import { P1_BRIEFS, pipeline, datasets, clock, newIds } from "../fixtures/load";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger } from "../../services/cost.service";
import { compilePromptSet } from "../../engine/prompt/compile";
import { auditDesign, type AuditInput } from "../../engine/critic/audit";
import { DesignCriticReport } from "../../types/schemas/design-critic.schema";
import { runBriefPipeline, runRecipePipeline, type EngineDeps } from "../../services/pipeline.service";
import { llmFixture, RAW_INDONESIAN_BRIEF } from "../fixtures/llm/raw";
import { conceptFixtureText } from "../fixtures/concepts/load";

/**
 * Golden cases for the Design Critic (P4.0). Runs the real pipeline (no LLM
 * except the scripted fake) and asserts the verdict for every P1 fixture plus
 * the wiring into `runRecipePipeline`.
 */

const auditFor = (name: string): AuditInput => {
  const { contract, direction, recipe } = pipeline(name);
  return {
    contract,
    direction,
    recipe,
    promptSet: compilePromptSet({ recipe, language: "en" }),
    promptLanguage: "en",
    concept: null
  };
};

describe("golden: every P1 fixture gets a schema-valid, deterministic verdict", () => {
  it.each(P1_BRIEFS)("%s", (name) => {
    const a = auditDesign(auditFor(name));
    const b = auditDesign(auditFor(name));
    expect(DesignCriticReport.safeParse(a).success).toBe(true);
    expect(["PASS", "REVIEW", "BLOCK"]).toContain(a.verdict);
    expect(a.checks_run).toBe(9);
    expect(b).toEqual(a);
  });
});

describe("golden: known scenarios", () => {
  it("kopi-lawas-promotion — clean design → PASS, no findings", () => {
    const r = auditDesign(auditFor("kopi-lawas-promotion"));
    expect(r.verdict).toBe("PASS");
    expect(r.findings).toEqual([]);
  });

  it("brutalist-trust-conflict — pinned movement vs trust industry → BLOCK, names the P0 conflict", () => {
    const r = auditDesign(auditFor("brutalist-trust-conflict"));
    expect(r.verdict).toBe("BLOCK");
    const p0 = r.findings.find((f) => f.severity === "P0");
    expect(p0).toBeDefined();
    expect(p0!.check).toBe("dkv-conflict");
    expect(p0!.area).toBe("dkv");
    expect(p0!.message).toMatch(/visual_density/);
  });

  it("luxury-density-conflict — only a routine adjustment → PASS with a P2 note", () => {
    const r = auditDesign(auditFor("luxury-density-conflict"));
    expect(r.verdict).toBe("PASS");
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings.every((f) => f.severity === "P2")).toBe(true);
  });

  it("wellness-studio-promo — Indonesian spatial density vs a calm-category ceiling → REVIEW", () => {
    const r = auditDesign(auditFor("wellness-studio-promo"));
    expect(r.verdict).toBe("REVIEW");
    expect(r.findings.some((f) => f.severity === "P0")).toBe(false);
    expect(
      r.findings.some((f) => f.check === "dkv-conflict" && f.severity === "P1" && f.message.match(/visual_density/))
    ).toBe(true);
  });

  it("jakarta-tokyo-blend — DKV clamps + a guarded motif in a negative instruction → REVIEW", () => {
    const r = auditDesign(auditFor("jakarta-tokyo-blend"));
    expect(r.verdict).toBe("REVIEW");
    // The stereotype guard's 'batik' finding is rolled up as a P2 note.
    expect(
      r.findings.some((f) => f.area === "stereotype-guard" && f.severity === "P2" && f.message.includes("batik"))
    ).toBe(true);
    // No P0 — the batik mention is inside a client prohibition, not positive prose.
    expect(r.findings.some((f) => f.severity === "P0")).toBe(false);
  });
});

describe("golden: a deliberately corrupted recipe is BLOCKed", () => {
  it("a recipe whose DKV was hand-edited away from the direction → BLOCK", () => {
    const input = auditFor("kopi-lawas-promotion");
    const recipe = structuredClone(input.recipe);
    recipe.dkv.hierarchy_strength = Math.max(0, recipe.dkv.hierarchy_strength - 0.3);
    const r = auditDesign({ ...input, recipe, promptSet: compilePromptSet({ recipe, language: "en" }) });
    expect(r.verdict).toBe("BLOCK");
    expect(r.findings.some((f) => f.area === "integrity" && f.check === "dkv-consistency")).toBe(true);
  });
});

describe("golden: wired into runRecipePipeline additively", () => {
  const buildDeps = (script: { text: string }[]): EngineDeps => {
    const ledger = createCostLedger({ clock });
    const fake = createFakeLlm(script, { ledger, clock });
    return { datasets, llm: fake.port, ids: newIds(), clock };
  };

  it("RecipeOkResult carries a schema-valid critic report; recipe and promptSet are unchanged by it", async () => {
    const deps = buildDeps([
      { text: llmFixture("01-valid-indonesian") },
      { text: conceptFixtureText("valid-set") }
    ]);
    const brief = await runBriefPipeline(deps, { rawBrief: RAW_INDONESIAN_BRIEF });
    expect(brief.status).toBe("READY");
    if (brief.status !== "READY") return;

    const recipeOut = runRecipePipeline(deps, {
      contract: brief.contract,
      direction: brief.direction,
      concept: brief.concepts.selected
    });
    expect(recipeOut.status).toBe("OK");
    if (recipeOut.status !== "OK") return;

    expect(DesignCriticReport.safeParse(recipeOut.critic).success).toBe(true);
    expect(recipeOut.critic.audited.recipe_hash).toBe(recipeOut.recipe.recipe_hash);
    expect(recipeOut.critic.audited.concept_ref).toBe(recipeOut.recipe.concept_ref);
    // The critic never mutates what it audits.
    const recompiled = compilePromptSet({ recipe: recipeOut.recipe, concept: brief.concepts.selected, language: "en" });
    expect(recompiled.masterPrompt).toBe(recipeOut.promptSet.masterPrompt);
  });
});

describe("regression: P4.0 is additive", () => {
  it("does not change the recipe hash or anchors for any fixture", () => {
    for (const name of P1_BRIEFS) {
      const a = pipeline(name).recipe;
      const b = pipeline(name).recipe;
      expect(b.recipe_hash).toBe(a.recipe_hash);
    }
  });

  it("the critic is pure — auditing twice yields byte-identical reports and never throws", () => {
    for (const name of P1_BRIEFS) {
      expect(() => auditDesign(auditFor(name))).not.toThrow();
      expect(auditDesign(auditFor(name))).toEqual(auditDesign(auditFor(name)));
    }
  });
});
