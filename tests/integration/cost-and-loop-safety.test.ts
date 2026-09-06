import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clock, datasets, newIds, pipeline } from "../fixtures/load";
import { createCostLedger } from "../../services/cost.service";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { runVisualGeneration, previewGeneration, type GenerationServiceDeps } from "../../services/generation.service";
import { createFakeVisualGeneration, FAKE_PLACEHOLDER_PNG_BASE64 } from "../../adapters/visual-generation/fake";
import { createReplayVisualEvidence } from "../../adapters/visual-evidence/replay";
import { createVisualEvidenceClient } from "../../adapters/visual-evidence/client";
import { inspectGeneratedVisual, applyRecommendedCorrection, type VisionLoopDeps } from "../../services/vision-loop.service";
import { recordCreativeDecision } from "../../services/creative-decision.service";
import type { RawVisionCall } from "../../ports/visual-evidence.port";

/**
 * P2.19 — cost safety and loop safety.
 *
 *   preview / approval / regenerate-decision = zero AI cost
 *   one generation = one generation cost event (success OR failure)
 *   one real evidence call = one evidence cost event; replay = zero
 *   max ONE correction cycle per explicit user action; no hidden loops
 */

type Ledger = ReturnType<typeof createCostLedger>;
const genDeps = (ledger: Ledger): GenerationServiceDeps => ({
  datasets,
  ids: newIds(),
  clock,
  generator: createFakeVisualGeneration({ ledger, clock, ids: newIds(), deliverImage: true })
});
const replayLoopDeps = (ledger: Ledger): VisionLoopDeps => ({
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
async function generated(ledger: Ledger) {
  const s = scaffold();
  const r = await runVisualGeneration(genDeps(ledger), { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
  if (r.status !== "OK") throw new Error("gen");
  return { ...s, artifact: r.artifact, request: r.request };
}

const SERVICE_SOURCES = [
  "../../services/vision-loop.service.ts",
  "../../services/generation.service.ts",
  "../../services/evidence.service.ts",
  "../../services/creative-decision.service.ts"
].map((rel) =>
  readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
);

describe("cost safety", () => {
  it("preview books zero cost", async () => {
    const ledger = createCostLedger({ clock });
    const s = scaffold();
    const r = await previewGeneration(genDeps(ledger), { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
    expect(r.status).toBe("OK");
    expect(ledger.list()).toHaveLength(0);
  });

  it("one generation books exactly one generation cost event", async () => {
    const ledger = createCostLedger({ clock });
    const s = scaffold();
    await runVisualGeneration(genDeps(ledger), { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
    expect(ledger.list(s.recipe.project_id).filter((e) => e.stage === "visual_generate")).toHaveLength(1);
  });

  it("a failed generation still books exactly one (failed) event", async () => {
    const ledger = createCostLedger({ clock });
    const s = scaffold();
    const deps: GenerationServiceDeps = {
      datasets,
      ids: newIds(),
      clock,
      generator: createFakeVisualGeneration({ ledger, clock, ids: newIds(), failWith: "rate_limited" })
    };
    await runVisualGeneration(deps, { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
    const events = ledger.list(s.recipe.project_id).filter((e) => e.stage === "visual_generate");
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe("failed");
  });

  it("a real evidence inspection books one evidence event; replay books none", async () => {
    const ledger = createCostLedger({ clock });
    const g = await generated(ledger);
    const beforeGen = ledger.list().length;

    // replay: no new event
    const replayInspect = await inspectGeneratedVisual(replayLoopDeps(ledger), {
      artifact: g.artifact,
      recipe: g.recipe,
      contract: g.contract,
      blueprint: g.blueprint,
      imageBase64: FAKE_PLACEHOLDER_PNG_BASE64,
      mimeType: "image/png"
    });
    expect(replayInspect.status).toBe("OK");
    expect(ledger.list().length).toBe(beforeGen);

    // metered vision call: exactly one
    const meteredLedger = createCostLedger({ clock });
    const okCall: RawVisionCall = async () => ({
      ok: true,
      provider: "google",
      model_id: "m",
      latency_ms: 1,
      observations: {
        region_count: 3,
        regions: [],
        text_region_count: 1,
        text_blocks: [],
        dominant_region_index: null,
        approx_subject_position: null,
        person_present: null,
        whitespace_share: null,
        approx_visual_density: null,
        color: null,
        edge_bleed: null,
        crop_behavior: null,
        semantic_descriptors: [],
        overall_confidence: null
      },
      input_tokens: 10,
      output_tokens: 5,
      estimated_cost_usd: 0.0001
    });
    const port = createVisualEvidenceClient({
      call: okCall,
      source: { kind: "vision-model", provider: "google", model: "m" },
      ledger: meteredLedger,
      clock,
      ids: newIds(),
      meter: true,
      datasetVersion: datasets.version
    });
    await port.observe({ artifact: g.artifact, imageBytes: new Uint8Array([1]), mimeType: "image/png" }, { projectId: "p" });
    expect(meteredLedger.list("p").filter((e) => e.stage === "visual_evidence")).toHaveLength(1);
  });

  it("approval and a regenerate decision book zero AI cost", async () => {
    const ledger = createCostLedger({ clock });
    const g = await generated(ledger);
    const before = ledger.list().length;
    recordCreativeDecision({ clock }, { action: "approved", projectId: "p", artifact: g.artifact, recipe: g.recipe, blueprint: g.blueprint, request: g.request });
    recordCreativeDecision({ clock }, { action: "regenerate", projectId: "p", artifact: g.artifact, recipe: g.recipe, blueprint: g.blueprint, request: g.request });
    expect(ledger.list().length).toBe(before);
  });
});

describe("loop safety", () => {
  it("applying a correction books no cost and produces exactly ONE cycle", async () => {
    const ledger = createCostLedger({ clock });
    const g = await generated(ledger);
    const inspected = await inspectGeneratedVisual(replayLoopDeps(ledger), {
      artifact: g.artifact,
      recipe: g.recipe,
      contract: g.contract,
      blueprint: g.blueprint,
      imageBase64: FAKE_PLACEHOLDER_PNG_BASE64,
      mimeType: "image/png"
    });
    if (inspected.status !== "OK") throw new Error("inspect");
    const before = ledger.list().length;
    const codes = inspected.recommendation.options.filter((o) => o.scope === "single_parameter").map((o) => o.code).slice(0, 1);
    const applied = applyRecommendedCorrection(
      { datasets, ids: newIds(), clock },
      {
        recommendation: inspected.recommendation,
        critique: inspected.critique,
        evidence: inspected.evidence,
        artifact: g.artifact,
        selectedCodes: codes,
        parentRecipe: g.recipe,
        contract: g.contract,
        direction: g.direction,
        concept: null,
        request: g.request,
        parentBlueprint: g.blueprint
      }
    );
    expect(applied.status).toBe("OK");
    if (applied.status !== "OK") return;
    expect(ledger.list().length).toBe(before); // apply books nothing
    expect(applied.cycle.regenerated).toBe(false); // no auto-regeneration
  });

  it("no service auto-chains: inspect never applies/generates, apply never inspects/generates, decision never generates", () => {
    const [loopSrc, genSrc, evidSrc, decideSrc] = SERVICE_SOURCES;
    // vision-loop: inspect and apply are separate; neither calls the next or the generator
    const applyIdx = loopSrc!.indexOf("export function applyRecommendedCorrection");
    expect(loopSrc!.slice(applyIdx)).not.toMatch(/runVisualGeneration|inspectGeneratedVisual|deps\.generator|\.generate\(/);
    const inspectIdx = loopSrc!.indexOf("export async function inspectGeneratedVisual");
    const inspectBody = loopSrc!.slice(inspectIdx, applyIdx);
    expect(inspectBody).not.toMatch(/applyRecommendedCorrection|runVisualGeneration|\.generate\(/);
    // no loop construct re-running a pipeline
    expect(loopSrc).not.toMatch(/while\s*\(|for\s*\([^)]*;[^)]*;/);
    // decision service never generates
    expect(decideSrc).not.toMatch(/runVisualGeneration|\.generate\(|adapters\//);
    // generation service: no retry loop
    expect(genSrc).not.toMatch(/for\s*\([^)]*attempt|while\s*\(/);
    // evidence service: no retry loop
    expect(evidSrc).not.toMatch(/while\s*\(|for\s*\([^)]*attempt/);
  });

  it("the vision-generation client never retries (one raw call per generate)", () => {
    const client = readFileSync(new URL("../../adapters/visual-generation/client.ts", import.meta.url), "utf8");
    const calls = [...client.matchAll(/await call\(/g)].length;
    expect(calls).toBe(1);
  });
});
