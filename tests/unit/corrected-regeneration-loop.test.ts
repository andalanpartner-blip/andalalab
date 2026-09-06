import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clock, datasets, newIds } from "../fixtures/load";
import { blueprintInputs } from "../fixtures/blueprint-inputs";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import {
  inspectGeneratedVisual,
  applyRecommendedCorrection,
  type VisionLoopDeps
} from "../../services/vision-loop.service";
import { runVisualGeneration, type GenerationServiceDeps } from "../../services/generation.service";
import { createFakeVisualGeneration, FAKE_PLACEHOLDER_PNG_BASE64 } from "../../adapters/visual-generation/fake";
import { createReplayVisualEvidence, SYNTHETIC_OBSERVATION_PAYLOAD } from "../../adapters/visual-evidence/replay";
import { createVisualEvidenceClient } from "../../adapters/visual-evidence/client";
import { CorrectionCycle } from "../../types/schemas/correction-cycle.schema";
import { createCostLedger } from "../../services/cost.service";
import { deepFreeze } from "../../domain/contract";
import type { RawVisionCall, VisionObservationPayload } from "../../ports/visual-evidence.port";

/**
 * P2.17 — the corrected-regeneration loop.
 *
 *   generated visual → [inspect] → [apply correction] → [regenerate]
 *
 * Every arrow is a separate explicit action. No function calls the next; there
 * is no autonomous loop. `inspect` books one evidence cost event (replay: none);
 * `apply` books none; regeneration is the unchanged generation service.
 */

const loopSrc = readFileSync(new URL("../../services/vision-loop.service.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\/\/[^\n]*/g, " ");

function scaffold(name = "kopi-lawas-promotion") {
  const i = blueprintInputs(name);
  const bp = resolveLayoutBlueprint({ recipe: i.recipe, contract: i.contract, direction: i.direction, datasets });
  if (!bp.ok) throw new Error("blueprint did not resolve");
  return { ...i, blueprint: bp.value };
}

const genDeps = (ledger = createCostLedger({ clock })): GenerationServiceDeps => ({
  datasets,
  ids: newIds(),
  clock,
  generator: createFakeVisualGeneration({ ledger, clock, ids: newIds(), deliverImage: true })
});

async function generate(s: ReturnType<typeof scaffold>, ledger?: ReturnType<typeof createCostLedger>) {
  const r = await runVisualGeneration(genDeps(ledger), { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
  if (r.status !== "OK") throw new Error("generation failed");
  return r.artifact;
}

const replayDeps = (ledger = createCostLedger({ clock }), payload?: VisionObservationPayload): VisionLoopDeps => ({
  datasets,
  ids: newIds(),
  clock,
  observer: createReplayVisualEvidence({ ledger, clock, ids: newIds(), datasetVersion: datasets.version, payload })
});

function mismatchPayload(s: ReturnType<typeof scaffold>): VisionObservationPayload {
  return {
    ...SYNTHETIC_OBSERVATION_PAYLOAD,
    crop_behavior: "cropped",
    whitespace_share: Math.max(0, s.recipe.composition.whitespace - 0.22),
    approx_visual_density: Math.min(1, s.recipe.composition.density + 0.22),
    dominant_region_index: 1,
    regions: [
      { kind: "image", rect: { x: 0, y: 0, w: 1, h: 0.3 }, area_share: 0.3, confidence: 0.7 },
      { kind: "text", rect: { x: 0.1, y: 0.55, w: 0.8, h: 0.3 }, area_share: 0.24, confidence: 0.8 }
    ]
  };
}

// --- 1 / 2 / 3 — inspect ----------------------------------------

describe("inspect: one explicit observation → critique → recommendation", () => {
  it("1 — returns a provenance-bound evidence / critique / recommendation chain", async () => {
    const s = scaffold();
    const artifact = await generate(s);
    const result = await inspectGeneratedVisual(replayDeps(undefined, mismatchPayload(s)), {
      artifact,
      recipe: s.recipe,
      contract: s.contract,
      blueprint: s.blueprint,
      imageBase64: FAKE_PLACEHOLDER_PNG_BASE64,
      mimeType: "image/png"
    });
    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    expect(result.evidence.provenance.artifact_hash).toBe(artifact.artifact_hash);
    expect(result.critique.provenance.evidence_hash).toBe(result.evidence.evidence_hash);
    expect(result.recommendation.provenance.critique_hash).toBe(result.critique.critique_hash);
    expect(result.recommendation.provenance.recipe_hash).toBe(s.recipe.recipe_hash);
  });

  it("2 / 3 — a replay inspection books no cost and runs no generation", async () => {
    const s = scaffold();
    const ledger = createCostLedger({ clock });
    const artifact = await generate(s);
    const before = ledger.list().length;
    await inspectGeneratedVisual(replayDeps(ledger, mismatchPayload(s)), {
      artifact,
      recipe: s.recipe,
      contract: s.contract,
      blueprint: s.blueprint,
      imageBase64: FAKE_PLACEHOLDER_PNG_BASE64,
      mimeType: "image/png"
    });
    expect(ledger.list().length).toBe(before);
    expect(ledger.list().some((e) => e.stage === "visual_generate")).toBe(false);
  });

  it("2 — a real (metered) vision inspection books exactly one visual_evidence cost event", async () => {
    const s = scaffold();
    const artifact = await generate(s);
    const ledger = createCostLedger({ clock });
    const okCall: RawVisionCall = async () => ({
      ok: true,
      provider: "google",
      model_id: "gemini-3.1-flash-lite",
      latency_ms: 10,
      observations: mismatchPayload(s),
      input_tokens: 900,
      output_tokens: 200,
      estimated_cost_usd: 0.0003
    });
    const deps: VisionLoopDeps = {
      datasets,
      ids: newIds(),
      clock,
      observer: createVisualEvidenceClient({
        call: okCall,
        source: { kind: "vision-model", provider: "google", model: "gemini-3.1-flash-lite" },
        ledger,
        clock,
        ids: newIds(),
        meter: true,
        datasetVersion: datasets.version
      })
    };
    const result = await inspectGeneratedVisual(deps, {
      artifact,
      recipe: s.recipe,
      contract: s.contract,
      blueprint: s.blueprint,
      imageBase64: FAKE_PLACEHOLDER_PNG_BASE64,
      mimeType: "image/png"
    });
    expect(result.status).toBe("OK");
    const evidenceEvents = ledger.list(s.recipe.project_id).filter((e) => e.stage === "visual_evidence");
    expect(evidenceEvents).toHaveLength(1);
    expect(ledger.list().some((e) => e.stage === "visual_generate")).toBe(false);
  });
});

// --- 4 / 5 / 6 — apply the correction --------------------------

describe("apply: one explicit bounded correction cycle", () => {
  async function inspectFor(s: ReturnType<typeof scaffold>) {
    const artifact = await generate(s);
    const inspected = await inspectGeneratedVisual(replayDeps(undefined, mismatchPayload(s)), {
      artifact,
      recipe: s.recipe,
      contract: s.contract,
      blueprint: s.blueprint,
      imageBase64: FAKE_PLACEHOLDER_PNG_BASE64,
      mimeType: "image/png"
    });
    if (inspected.status !== "OK") throw new Error("inspect failed");
    return { artifact, ...inspected };
  }

  it("4 — produces a corrected recipe, a fresh blueprint, a fresh prompt and a CorrectionCycle", async () => {
    const s = scaffold();
    const { artifact, evidence, critique, recommendation } = await inspectFor(s);
    const codes = recommendation.options.filter((o) => o.scope === "single_parameter").map((o) => o.code);
    expect(codes.length).toBeGreaterThan(0);

    const result = applyRecommendedCorrection(
      { datasets, ids: newIds(), clock },
      {
        recommendation,
        critique,
        evidence,
        artifact,
        selectedCodes: codes,
        parentRecipe: s.recipe,
        contract: s.contract,
        direction: s.direction,
        concept: null
      }
    );
    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    expect(result.recipe.recipe_hash).not.toBe(s.recipe.recipe_hash);
    expect(result.recipe.derived_from).toBe(s.recipe.id);
    expect(result.blueprint.derived_from.recipe_hash).toBe(result.recipe.recipe_hash);
    expect(CorrectionCycle.safeParse(result.cycle).success).toBe(true);
    expect(Object.isFrozen(result.cycle)).toBe(true);
  });

  it("5 — the CorrectionCycle records the full parent lineage and regenerated=false", async () => {
    const s = scaffold();
    const { artifact, evidence, critique, recommendation } = await inspectFor(s);
    const codes = recommendation.options.filter((o) => o.scope === "single_parameter").map((o) => o.code);
    const result = applyRecommendedCorrection(
      { datasets, ids: newIds(), clock },
      { recommendation, critique, evidence, artifact, selectedCodes: codes, parentRecipe: s.recipe, contract: s.contract, direction: s.direction, concept: null }
    );
    if (result.status !== "OK") throw new Error("expected OK");
    const c = result.cycle;
    expect(c.parent.artifact_hash).toBe(artifact.artifact_hash);
    expect(c.parent.recipe_hash).toBe(s.recipe.recipe_hash);
    expect(c.parent.evidence_hash).toBe(evidence.evidence_hash);
    expect(c.parent.critique_hash).toBe(critique.critique_hash);
    expect(c.parent.recommendation_hash).toBe(recommendation.recommendation_hash);
    expect(c.corrected?.recipe_hash).toBe(result.recipe.recipe_hash);
    expect(c.corrected?.blueprint_hash).toBe(result.blueprint.blueprint_hash);
    expect(c.regenerated).toBe(false);
    expect(c.selected_options).toEqual(codes);
  });

  it("6 — the originals are not mutated and the corrected recipe preserves movement / composition", async () => {
    const s = scaffold();
    const { artifact, evidence, critique, recommendation } = await inspectFor(s);
    const recipe = deepFreeze(structuredClone(s.recipe));
    const blueprint = deepFreeze(structuredClone(s.blueprint));
    const artifactFrozen = deepFreeze(structuredClone(artifact));
    const recipeBefore = JSON.stringify(recipe);
    const codes = recommendation.options.filter((o) => o.scope === "single_parameter").map((o) => o.code);

    const result = applyRecommendedCorrection(
      { datasets, ids: newIds(), clock },
      { recommendation, critique, evidence, artifact: artifactFrozen, selectedCodes: codes, parentRecipe: recipe, contract: s.contract, direction: s.direction, concept: null }
    );
    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    expect(JSON.stringify(recipe)).toBe(recipeBefore);
    expect(JSON.stringify(structuredClone(blueprint))).toBe(JSON.stringify(blueprint));
    expect(result.recipe.movement.id).toBe(s.recipe.movement.id);
    expect(result.recipe.composition.strategy).toBe(s.recipe.composition.strategy);
    expect(result.recipe.anchors.map((a) => a.kind).sort()).toEqual(s.recipe.anchors.map((a) => a.kind).sort());
  });
});

// --- 7 — the human gate --------------------------------------

describe("apply: nothing happens without an explicit, applicable selection", () => {
  it("7 — an empty selection is rejected", async () => {
    const s = scaffold();
    const artifact = await generate(s);
    const inspected = await inspectGeneratedVisual(replayDeps(undefined, mismatchPayload(s)), {
      artifact, recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, imageBase64: FAKE_PLACEHOLDER_PNG_BASE64, mimeType: "image/png"
    });
    if (inspected.status !== "OK") throw new Error("inspect failed");
    const result = applyRecommendedCorrection(
      { datasets, ids: newIds(), clock },
      { recommendation: inspected.recommendation, critique: inspected.critique, evidence: inspected.evidence, artifact, selectedCodes: [], parentRecipe: s.recipe, contract: s.contract, direction: s.direction, concept: null }
    );
    expect(result.status).toBe("ERROR");
  });

  it("10 — a recommendation for an earlier recipe is rejected", async () => {
    const s = scaffold();
    const artifact = await generate(s);
    const inspected = await inspectGeneratedVisual(replayDeps(undefined, mismatchPayload(s)), {
      artifact, recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, imageBase64: FAKE_PLACEHOLDER_PNG_BASE64, mimeType: "image/png"
    });
    if (inspected.status !== "OK") throw new Error("inspect failed");
    const codes = inspected.recommendation.options.filter((o) => o.scope === "single_parameter").map((o) => o.code);
    const result = applyRecommendedCorrection(
      { datasets, ids: newIds(), clock },
      { recommendation: inspected.recommendation, critique: inspected.critique, evidence: inspected.evidence, artifact, selectedCodes: codes, parentRecipe: { ...s.recipe, recipe_hash: "deadbeef" }, contract: s.contract, direction: s.direction, concept: null }
    );
    expect(result.status).toBe("ERROR");
  });
});

// --- 8 — no autonomous loop --------------------------------

describe("no autonomous loop", () => {
  it("8 — inspect never applies a correction; apply never inspects or regenerates", () => {
    // inspect() body: no correction application, no generation
    expect(loopSrc).toMatch(/export async function inspectGeneratedVisual/);
    expect(loopSrc).not.toMatch(/applyRecommendedCorrection\([^)]*\)[\s\S]{0,200}inspectGeneratedVisual/);
    // apply() body: no generation call, no re-inspection
    const applyBody = loopSrc.slice(loopSrc.indexOf("export function applyRecommendedCorrection"));
    expect(applyBody).not.toMatch(/runVisualGeneration|inspectGeneratedVisual|deps\.generator/);
    // no loop construct re-running the pipeline
    expect(loopSrc).not.toMatch(/while\s*\(|for\s*\([^)]*;[^)]*;/);
  });
});

// --- 9 / 11 — the full explicit chain ---------------------

describe("the full explicit chain, one action at a time", () => {
  it("11 — a regeneration after the correction derives from the CORRECTED recipe", async () => {
    const s = scaffold();
    const ledger = createCostLedger({ clock });
    const artifact = await generate(s, ledger);

    // action 1 — inspect
    const inspected = await inspectGeneratedVisual(replayDeps(ledger, mismatchPayload(s)), {
      artifact, recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, imageBase64: FAKE_PLACEHOLDER_PNG_BASE64, mimeType: "image/png"
    });
    if (inspected.status !== "OK") throw new Error("inspect failed");
    const codes = inspected.recommendation.options.filter((o) => o.scope === "single_parameter").map((o) => o.code);

    // action 2 — apply the human-selected correction
    const applied = applyRecommendedCorrection(
      { datasets, ids: newIds(), clock },
      { recommendation: inspected.recommendation, critique: inspected.critique, evidence: inspected.evidence, artifact, selectedCodes: codes, parentRecipe: s.recipe, contract: s.contract, direction: s.direction, concept: null }
    );
    if (applied.status !== "OK") throw new Error("apply failed");
    // applying the correction booked NO new cost event (regeneration is separate)
    const generateEventsAfterApply = ledger.list().filter((e) => e.stage === "visual_generate").length;
    expect(generateEventsAfterApply).toBe(1); // only the initial generation

    // action 3 — explicit regeneration from the CORRECTED recipe + fresh blueprint
    const regen = await runVisualGeneration(genDeps(ledger), {
      recipe: applied.recipe,
      contract: applied.contract,
      blueprint: applied.blueprint
    });
    expect(regen.status).toBe("OK");
    if (regen.status !== "OK") return;
    expect(regen.artifact.provenance.recipe_hash).toBe(applied.recipe.recipe_hash);
    expect(regen.artifact.provenance.blueprint_hash).toBe(applied.blueprint.blueprint_hash);

    // one more cycle is possible — still fully explicit
    const inspected2 = await inspectGeneratedVisual(replayDeps(ledger), {
      artifact: regen.artifact, recipe: applied.recipe, contract: applied.contract, blueprint: applied.blueprint, imageBase64: FAKE_PLACEHOLDER_PNG_BASE64, mimeType: "image/png"
    });
    expect(inspected2.status).toBe("OK");
  });
});
