import { describe, expect, it } from "vitest";
import { clock, datasets, newIds, pipeline } from "../fixtures/load";
import { createCostLedger } from "../../services/cost.service";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { runVisualGeneration, type GenerationServiceDeps } from "../../services/generation.service";
import { createFakeVisualGeneration, FAKE_PLACEHOLDER_PNG_BASE64 } from "../../adapters/visual-generation/fake";
import { createReplayVisualEvidence } from "../../adapters/visual-evidence/replay";
import { inspectGeneratedVisual, applyRecommendedCorrection, type VisionLoopDeps } from "../../services/vision-loop.service";
import { recordCreativeDecision } from "../../services/creative-decision.service";

/**
 * P2.19 — the full lineage is verifiable, and every prior artifact stays
 * byte-identical after a correction cycle.
 *
 *   Recipe → Blueprint → Prompt → GenerationRequest → GeneratedArtifact
 *   → Evidence → Critique → Recommendation → CorrectionCycle
 *   → Corrected Recipe → Corrected Blueprint → Corrected Prompt
 *   → New GenerationRequest → New Artifact → Human Decision
 */

type Ledger = ReturnType<typeof createCostLedger>;
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

function scaffold(name = "kopi-lawas-promotion") {
  const p = pipeline(name);
  const bp = resolveLayoutBlueprint({ recipe: p.recipe, contract: p.contract, direction: p.direction, datasets });
  if (!bp.ok) throw new Error("blueprint");
  return { ...p, blueprint: bp.value };
}

async function fullChain() {
  const ledger = createCostLedger({ clock });
  const s = scaffold();

  const gen = await runVisualGeneration(genDeps(ledger), { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
  if (gen.status !== "OK") throw new Error("gen");

  const inspected = await inspectGeneratedVisual(loopDeps(ledger), {
    artifact: gen.artifact,
    recipe: s.recipe,
    contract: s.contract,
    blueprint: s.blueprint,
    imageBase64: FAKE_PLACEHOLDER_PNG_BASE64,
    mimeType: "image/png"
  });
  if (inspected.status !== "OK") throw new Error("inspect");

  const codes = inspected.recommendation.options.filter((o) => o.scope === "single_parameter").map((o) => o.code);
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
      projectId: "proj_prov"
    }
  );
  if (applied.status !== "OK") throw new Error("apply");

  const regen = await runVisualGeneration(genDeps(ledger), {
    recipe: applied.recipe,
    contract: applied.contract,
    blueprint: applied.blueprint
  });
  if (regen.status !== "OK") throw new Error("regen");

  const decision = recordCreativeDecision(
    { clock },
    { action: "approved", projectId: "proj_prov", artifact: regen.artifact, recipe: applied.recipe, blueprint: applied.blueprint, request: regen.request }
  );
  if (decision.status !== "OK") throw new Error("decide");

  return { s, gen, inspected, applied, regen, decision, ledger };
}

describe("provenance integrity — every relationship is verifiable", () => {
  it("links Recipe → Blueprint → Request → Artifact", async () => {
    const { s, gen } = await fullChain();
    expect(s.blueprint.derived_from.recipe_hash).toBe(s.recipe.recipe_hash);
    expect(gen.request.provenance.recipe_hash).toBe(s.recipe.recipe_hash);
    expect(gen.request.provenance.blueprint_hash).toBe(s.blueprint.blueprint_hash);
    expect(gen.artifact.request_hash).toBe(gen.request.request_hash);
    expect(gen.artifact.provenance.recipe_hash).toBe(s.recipe.recipe_hash);
    expect(gen.artifact.provenance.blueprint_hash).toBe(s.blueprint.blueprint_hash);
    expect(gen.artifact.provenance.prompt_hash).toBe(gen.request.provenance.prompt_hash);
  });

  it("links Artifact → Evidence → Critique → Recommendation", async () => {
    const { gen, inspected } = await fullChain();
    expect(inspected.evidence.provenance.artifact_hash).toBe(gen.artifact.artifact_hash);
    expect(inspected.evidence.provenance.recipe_hash).toBe(gen.artifact.provenance.recipe_hash);
    expect(inspected.critique.provenance.evidence_hash).toBe(inspected.evidence.evidence_hash);
    expect(inspected.critique.provenance.artifact_hash).toBe(gen.artifact.artifact_hash);
    expect(inspected.recommendation.provenance.critique_hash).toBe(inspected.critique.critique_hash);
    expect(inspected.recommendation.provenance.evidence_hash).toBe(inspected.evidence.evidence_hash);
  });

  it("links Recommendation → CorrectionCycle → Corrected Recipe/Blueprint/Prompt", async () => {
    const { s, gen, inspected, applied } = await fullChain();
    const c = applied.cycle;
    expect(c.parent.artifact_hash).toBe(gen.artifact.artifact_hash);
    expect(c.parent.recipe_hash).toBe(s.recipe.recipe_hash);
    expect(c.parent.evidence_hash).toBe(inspected.evidence.evidence_hash);
    expect(c.parent.critique_hash).toBe(inspected.critique.critique_hash);
    expect(c.parent.recommendation_hash).toBe(inspected.recommendation.recommendation_hash);
    expect(c.corrected?.recipe_hash).toBe(applied.recipe.recipe_hash);
    expect(c.corrected?.blueprint_hash).toBe(applied.blueprint.blueprint_hash);
    expect(applied.recipe.derived_from).toBe(s.recipe.id);
    expect(applied.blueprint.derived_from.recipe_hash).toBe(applied.recipe.recipe_hash);
  });

  it("links Corrected Recipe → New Request → New Artifact → Human Decision", async () => {
    const { applied, regen, decision } = await fullChain();
    expect(regen.request.provenance.recipe_hash).toBe(applied.recipe.recipe_hash);
    expect(regen.request.provenance.blueprint_hash).toBe(applied.blueprint.blueprint_hash);
    expect(regen.artifact.request_hash).toBe(regen.request.request_hash);
    expect(decision.decision.subject.artifact_hash).toBe(regen.artifact.artifact_hash);
    expect(decision.decision.subject.recipe_hash).toBe(applied.recipe.recipe_hash);
    expect(decision.decision.subject.blueprint_hash).toBe(applied.blueprint.blueprint_hash);
    expect(decision.decision.subject.generation_request_hash).toBe(regen.request.request_hash);
  });

  it("the cycle's parent + corrected recipe hashes differ (a real derivation)", async () => {
    const { applied } = await fullChain();
    expect(applied.cycle.parent.recipe_hash).not.toBe(applied.cycle.corrected?.recipe_hash);
    expect(applied.cycle.regenerated).toBe(false);
  });
});

describe("immutability — a correction creates new artifacts, never mutates old ones", () => {
  it("the pre-correction recipe / blueprint / request / artifact / evidence / critique / recommendation are byte-identical after the cycle", async () => {
    const ledger = createCostLedger({ clock });
    const s = scaffold();

    const gen = await runVisualGeneration(genDeps(ledger), { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
    if (gen.status !== "OK") throw new Error("gen");
    const inspected = await inspectGeneratedVisual(loopDeps(ledger), {
      artifact: gen.artifact,
      recipe: s.recipe,
      contract: s.contract,
      blueprint: s.blueprint,
      imageBase64: FAKE_PLACEHOLDER_PNG_BASE64,
      mimeType: "image/png"
    });
    if (inspected.status !== "OK") throw new Error("inspect");

    const before = {
      recipe: JSON.stringify(s.recipe),
      blueprint: JSON.stringify(s.blueprint),
      request: JSON.stringify(gen.request),
      artifact: JSON.stringify(gen.artifact),
      evidence: JSON.stringify(inspected.evidence),
      critique: JSON.stringify(inspected.critique),
      recommendation: JSON.stringify(inspected.recommendation)
    };

    const codes = inspected.recommendation.options.filter((o) => o.scope === "single_parameter").map((o) => o.code);
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
        projectId: "p"
      }
    );
    if (applied.status !== "OK") throw new Error("apply");

    const regen = await runVisualGeneration(genDeps(ledger), { recipe: applied.recipe, contract: applied.contract, blueprint: applied.blueprint });
    if (regen.status !== "OK") throw new Error("regen");
    const decision = recordCreativeDecision(
      { clock },
      { action: "approved", projectId: "p", artifact: regen.artifact, recipe: applied.recipe, blueprint: applied.blueprint, request: regen.request }
    );
    if (decision.status !== "OK") throw new Error("decide");
    const decisionJson = JSON.stringify(decision.decision);

    // originals unchanged after the whole downstream chain
    expect(JSON.stringify(s.recipe)).toBe(before.recipe);
    expect(JSON.stringify(s.blueprint)).toBe(before.blueprint);
    expect(JSON.stringify(gen.request)).toBe(before.request);
    expect(JSON.stringify(gen.artifact)).toBe(before.artifact);
    expect(JSON.stringify(inspected.evidence)).toBe(before.evidence);
    expect(JSON.stringify(inspected.critique)).toBe(before.critique);
    expect(JSON.stringify(inspected.recommendation)).toBe(before.recommendation);

    // and every produced artifact is frozen
    for (const a of [s.blueprint, gen.artifact, inspected.evidence, inspected.critique, inspected.recommendation, applied.recipe, applied.blueprint, applied.cycle, regen.artifact, decision.decision]) {
      expect(Object.isFrozen(a)).toBe(true);
    }

    // a second decision does not touch the first
    const second = recordCreativeDecision(
      { clock },
      { action: "regenerate", projectId: "p", artifact: regen.artifact, recipe: applied.recipe, blueprint: applied.blueprint, request: regen.request }
    );
    expect(second.status).toBe("OK");
    expect(JSON.stringify(decision.decision)).toBe(decisionJson);
  });
});
