import { describe, expect, it } from "vitest";
import { clock, datasets, newIds, pipeline } from "../fixtures/load";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger } from "../../services/cost.service";
import { llmFixture, RAW_INDONESIAN_BRIEF } from "../fixtures/llm/raw";
import { conceptFixtureText } from "../fixtures/concepts/load";
import { runBriefPipeline, runRecipePipeline, type EngineDeps } from "../../services/pipeline.service";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { runVisualGeneration, type GenerationServiceDeps } from "../../services/generation.service";
import { createFakeVisualGeneration, FAKE_PLACEHOLDER_PNG_BASE64 } from "../../adapters/visual-generation/fake";
import { createReplayVisualEvidence } from "../../adapters/visual-evidence/replay";
import { inspectGeneratedVisual, applyRecommendedCorrection, type VisionLoopDeps } from "../../services/vision-loop.service";
import { recordCreativeDecision } from "../../services/creative-decision.service";
import { decisionApprovesArtifact } from "../../engine/approval/decide";
import { PRODUCTION_SCENARIOS } from "../fixtures/production-scenarios";

/**
 * P2.19 — the ENTIRE employee loop, one explicit action at a time, end to end,
 * with fake / replay providers. No network, no real key, no live cost.
 *
 *   Brief → Strategy → Concept → Recipe → Layout → Prompt → Generate → Visual
 *   → Evidence → Critic → Recommendation → Human Decision → Correction
 *   → Fresh Recipe → Fresh Blueprint → Fresh Prompt → Explicit Regenerate
 *   → New Visual → Human Approval → Final
 */

type Ledger = ReturnType<typeof createCostLedger>;

const engineDeps = (ledger: Ledger, script: { text: string }[]): EngineDeps => {
  const fake = createFakeLlm(script, { ledger, clock });
  return { datasets, llm: fake.port, ids: newIds(), clock };
};
const genDeps = (ledger: Ledger): GenerationServiceDeps => ({
  datasets,
  ids: newIds(),
  clock,
  generator: createFakeVisualGeneration({ ledger, clock, ids: newIds(), deliverImage: true })
});
const loopDeps = (ledger: Ledger): VisionLoopDeps => ({
  datasets,
  ids: newIds(),
  clock,
  observer: createReplayVisualEvidence({ ledger, clock, ids: newIds(), datasetVersion: datasets.version })
});

function scaffold(name: string) {
  const p = pipeline(name);
  const bp = resolveLayoutBlueprint({ recipe: p.recipe, contract: p.contract, direction: p.direction, datasets });
  if (!bp.ok) throw new Error(`${name}: blueprint`);
  return { ...p, blueprint: bp.value };
}

describe("the whole creative loop, end to end", () => {
  it("brief (LLM) → recipe → generate → inspect → approve → Final", async () => {
    const ledger = createCostLedger({ clock });

    const briefResult = await runBriefPipeline(
      engineDeps(ledger, [
        { text: llmFixture("01-valid-indonesian") },
        { text: conceptFixtureText("valid-set") }
      ]),
      { rawBrief: RAW_INDONESIAN_BRIEF }
    );
    expect(briefResult.status).toBe("READY");
    if (briefResult.status !== "READY") return;

    const recipeResult = runRecipePipeline(
      { datasets, ids: newIds(), clock },
      { contract: briefResult.contract, direction: briefResult.direction, concept: briefResult.concepts.selected }
    );
    expect(recipeResult.status).toBe("OK");
    if (recipeResult.status !== "OK") return;
    const { recipe, blueprint, promptSet } = recipeResult;
    expect(blueprint.derived_from.recipe_hash).toBe(recipe.recipe_hash);
    expect(promptSet.imageOnlyPrompt.length).toBeGreaterThan(0);

    const gen = await runVisualGeneration(genDeps(ledger), { recipe, contract: briefResult.contract, blueprint });
    expect(gen.status).toBe("OK");
    if (gen.status !== "OK") return;
    expect(gen.artifact.provenance.recipe_hash).toBe(recipe.recipe_hash);
    expect(gen.artifact.provenance.blueprint_hash).toBe(blueprint.blueprint_hash);

    const inspected = await inspectGeneratedVisual(loopDeps(ledger), {
      artifact: gen.artifact,
      recipe,
      contract: briefResult.contract,
      blueprint,
      imageBase64: FAKE_PLACEHOLDER_PNG_BASE64,
      mimeType: "image/png"
    });
    expect(inspected.status).toBe("OK");
    if (inspected.status !== "OK") return;
    expect(inspected.critique.provenance.evidence_hash).toBe(inspected.evidence.evidence_hash);
    expect(inspected.recommendation.provenance.critique_hash).toBe(inspected.critique.critique_hash);

    const approval = recordCreativeDecision(
      { clock },
      {
        action: "approved",
        projectId: "proj_llm",
        artifact: gen.artifact,
        recipe,
        blueprint,
        request: gen.request,
        evidence: inspected.evidence,
        critique: inspected.critique,
        recommendation: inspected.recommendation,
        note: "Sign-off."
      }
    );
    expect(approval.status).toBe("OK");
    if (approval.status !== "OK") return;
    expect(decisionApprovesArtifact(approval.decision, gen.artifact)).toBe(true);
    expect(approval.decision.context.evidence_hash).toBe(inspected.evidence.evidence_hash);
  });

  it("recipe → generate → inspect → correct → regenerate → approve → Final", async () => {
    const ledger = createCostLedger({ clock });
    const s = scaffold("kopi-lawas-promotion");

    const gen = await runVisualGeneration(genDeps(ledger), { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
    expect(gen.status).toBe("OK");
    if (gen.status !== "OK") return;

    const inspected = await inspectGeneratedVisual(loopDeps(ledger), {
      artifact: gen.artifact,
      recipe: s.recipe,
      contract: s.contract,
      blueprint: s.blueprint,
      imageBase64: FAKE_PLACEHOLDER_PNG_BASE64,
      mimeType: "image/png"
    });
    expect(inspected.status).toBe("OK");
    if (inspected.status !== "OK") return;

    const codes = inspected.recommendation.options.filter((o) => o.scope === "single_parameter").map((o) => o.code);
    expect(codes.length).toBeGreaterThan(0);

    const applied = applyRecommendedCorrection(
      { datasets, ids: newIds(), clock },
      {
        recommendation: inspected.recommendation,
        critique: inspected.critique,
        evidence: inspected.evidence,
        artifact: gen.artifact,
        selectedCodes: codes,
        parentRecipe: s.recipe,
        contract: s.contract,
        direction: s.direction,
        concept: null,
        request: gen.request,
        parentBlueprint: s.blueprint,
        projectId: "proj_corr"
      }
    );
    expect(applied.status).toBe("OK");
    if (applied.status !== "OK") return;

    expect(applied.recipe.recipe_hash).not.toBe(s.recipe.recipe_hash);
    expect(applied.recipe.derived_from).toBe(s.recipe.id);
    expect(applied.blueprint.derived_from.recipe_hash).toBe(applied.recipe.recipe_hash);
    expect(applied.cycle.corrected?.recipe_hash).toBe(applied.recipe.recipe_hash);
    expect(applied.decision?.action).toBe("needs_correction");
    expect(applied.decision?.selected_correction_options).toEqual(codes);

    const regen = await runVisualGeneration(genDeps(ledger), {
      recipe: applied.recipe,
      contract: applied.contract,
      blueprint: applied.blueprint
    });
    expect(regen.status).toBe("OK");
    if (regen.status !== "OK") return;
    expect(regen.artifact.provenance.recipe_hash).toBe(applied.recipe.recipe_hash);
    expect(regen.artifact.artifact_hash).not.toBe(gen.artifact.artifact_hash);

    const approval = recordCreativeDecision(
      { clock },
      {
        action: "approved",
        projectId: "proj_corr",
        artifact: regen.artifact,
        recipe: applied.recipe,
        blueprint: applied.blueprint,
        request: regen.request
      }
    );
    expect(approval.status).toBe("OK");
    if (approval.status !== "OK") return;
    expect(decisionApprovesArtifact(approval.decision, regen.artifact)).toBe(true);

    // the pre-correction visual can no longer be approved against the new recipe
    const staleApproval = recordCreativeDecision(
      { clock },
      {
        action: "approved",
        projectId: "proj_corr",
        artifact: gen.artifact,
        recipe: applied.recipe,
        blueprint: applied.blueprint,
        request: gen.request
      }
    );
    expect(staleApproval.status).toBe("ERROR");
  });

  it("runs the same generate → inspect → approve loop across three visual contexts", async () => {
    for (const { name } of PRODUCTION_SCENARIOS) {
      const s = scaffold(name);
      const ledger = createCostLedger({ clock });
      const gen = await runVisualGeneration(genDeps(ledger), { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
      expect(gen.status).toBe("OK");
      if (gen.status !== "OK") continue;
      const inspected = await inspectGeneratedVisual(loopDeps(ledger), {
        artifact: gen.artifact,
        recipe: s.recipe,
        contract: s.contract,
        blueprint: s.blueprint,
        imageBase64: FAKE_PLACEHOLDER_PNG_BASE64,
        mimeType: "image/png"
      });
      expect(inspected.status).toBe("OK");
      const approval = recordCreativeDecision(
        { clock },
        {
          action: "approved",
          projectId: `proj_${name}`,
          artifact: gen.artifact,
          recipe: s.recipe,
          blueprint: s.blueprint,
          request: gen.request
        }
      );
      expect(approval.status).toBe("OK");
      expect(ledger.list().filter((e) => e.stage === "visual_generate")).toHaveLength(1);
      expect(ledger.list().filter((e) => e.stage === "visual_evidence")).toHaveLength(0);
    }
  });
});
