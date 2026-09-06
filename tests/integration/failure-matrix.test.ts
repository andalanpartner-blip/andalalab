import { describe, expect, it } from "vitest";
import { clock, datasets, newIds, pipeline } from "../fixtures/load";
import { createFakeLlm } from "../fakes/fake-llm";
import { createCostLedger } from "../../services/cost.service";
import { llmFixture, MALFORMED, RAW_INDONESIAN_BRIEF } from "../fixtures/llm/raw";
import { runBriefPipeline, type EngineDeps } from "../../services/pipeline.service";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { evaluateVisionCritique } from "../../engine/critic/vision-critique";
import { recommendCorrections } from "../../engine/correction/recommend";
import { boundedProposal } from "../../engine/correction/policy";
import { runVisualGeneration, previewGeneration, type GenerationServiceDeps } from "../../services/generation.service";
import { runVisualEvidence } from "../../services/evidence.service";
import { applyRecommendedCorrection } from "../../services/vision-loop.service";
import { recordCreativeDecision } from "../../services/creative-decision.service";
import { createFakeVisualGeneration, FAKE_PLACEHOLDER_PNG_BASE64 } from "../../adapters/visual-generation/fake";
import { createReplayVisualEvidence } from "../../adapters/visual-evidence/replay";
import { createVisualEvidenceClient } from "../../adapters/visual-evidence/client";
import type { GenerationIssueCode } from "../../ports/visual-generation.port";
import type { EvidenceIssueCode, RawVisionCall } from "../../ports/visual-evidence.port";

/**
 * P2.19 — the failure matrix. Every documented failure class produces an
 * explicit, non-silent error and NEVER a plausible-looking success.
 */

type Ledger = ReturnType<typeof createCostLedger>;
const IMAGE64 = FAKE_PLACEHOLDER_PNG_BASE64;

const engineDeps = (ledger: Ledger, script: unknown[]): EngineDeps => {
  const fake = createFakeLlm(script as never, { ledger, clock });
  return { datasets, llm: fake.port, ids: newIds(), clock };
};
const genDeps = (opts: Parameters<typeof createFakeVisualGeneration>[0] extends infer T ? Partial<T> : never = {}, ledger = createCostLedger({ clock })): GenerationServiceDeps => ({
  datasets,
  ids: newIds(),
  clock,
  generator: createFakeVisualGeneration({ ledger, clock, ids: newIds(), deliverImage: true, ...opts })
});

function scaffold(name = "kopi-lawas-promotion") {
  const p = pipeline(name);
  const bp = resolveLayoutBlueprint({ recipe: p.recipe, contract: p.contract, direction: p.direction, datasets });
  if (!bp.ok) throw new Error("blueprint");
  return { ...p, blueprint: bp.value };
}

async function generated(ledger = createCostLedger({ clock })) {
  const s = scaffold();
  const r = await runVisualGeneration(genDeps({}, ledger), { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
  if (r.status !== "OK") throw new Error("gen");
  return { ...s, artifact: r.artifact, request: r.request };
}

// --- INPUT --------------------------------------------------------

describe("failure matrix — INPUT", () => {
  it("a malformed brief interpretation is an explicit ERROR, not a guessed contract", async () => {
    const result = await runBriefPipeline(engineDeps(createCostLedger({ clock }), [{ text: MALFORMED }, { text: MALFORMED }]), {
      rawBrief: RAW_INDONESIAN_BRIEF
    });
    expect(result.status).toBe("ERROR");
  });

  it("an incomplete brief asks for clarification, never proceeds", async () => {
    const result = await runBriefPipeline(engineDeps(createCostLedger({ clock }), [{ text: llmFixture("02-very-short") }]), {
      rawBrief: "Bikin poster."
    });
    expect(["NEEDS_CLARIFICATION", "ERROR"]).toContain(result.status);
  });

  it("a contradictory brief is INVALID, never designed from", async () => {
    const result = await runBriefPipeline(engineDeps(createCostLedger({ clock }), [{ text: llmFixture("10-contradictions") }]), {
      rawBrief: "A luxury minimalist poster that is also maximalist and cheap."
    });
    expect(["INVALID", "NEEDS_CLARIFICATION", "ERROR"]).toContain(result.status);
  });
});

// --- ARTIFACT ----------------------------------------------------

describe("failure matrix — ARTIFACT", () => {
  it("a missing recipe / contract is rejected", async () => {
    const r = await runVisualGeneration(genDeps(), { recipe: null, contract: null });
    expect(r.status).toBe("ERROR");
  });

  it("a recipe / contract mismatch is rejected", async () => {
    const s = scaffold();
    const other = pipeline("northbeam-saas-launch");
    const r = await runVisualGeneration(genDeps(), { recipe: s.recipe, contract: other.contract, blueprint: s.blueprint });
    expect(r.status).toBe("ERROR");
  });

  it("a stale blueprint (hash != recipe) is rejected", async () => {
    const s = scaffold();
    const staleBp = { ...s.blueprint, derived_from: { ...s.blueprint.derived_from, recipe_hash: "deadbeef" } };
    const r = await runVisualGeneration(genDeps(), { recipe: s.recipe, contract: s.contract, blueprint: staleBp });
    expect(r.status).toBe("ERROR");
  });

  it("corrupted provenance (unparseable artifact) is rejected at every downstream seam", async () => {
    const evid = await runVisualEvidence(
      { datasets, ids: newIds(), clock, observer: createReplayVisualEvidence({ ledger: createCostLedger({ clock }), clock, ids: newIds(), datasetVersion: datasets.version }) },
      { artifact: { not: "an artifact" }, recipe: scaffold().recipe, imageBase64: IMAGE64, mimeType: "image/png" }
    );
    expect(evid.status).toBe("ERROR");
  });
});

// --- GENERATION ------------------------------------------------

describe("failure matrix — GENERATION", () => {
  const CODES: GenerationIssueCode[] = [
    "not_configured",
    "authentication_error",
    "rate_limited",
    "provider_unavailable",
    "timeout",
    "content_rejected",
    "malformed_request",
    "unknown_provider_error"
  ];

  it.each(CODES)("provider failure %s → ERROR with the code, no artifact, one failed cost event", async (code) => {
    const s = scaffold();
    const ledger = createCostLedger({ clock });
    const r = await runVisualGeneration(genDeps({ failWith: code }, ledger), {
      recipe: s.recipe,
      contract: s.contract,
      blueprint: s.blueprint
    });
    expect(r.status).toBe("ERROR");
    if (r.status !== "ERROR") return;
    expect(r.issues?.[0]?.code).toBe(code);
    const events = ledger.list(s.recipe.project_id).filter((e) => e.stage === "visual_generate");
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe("failed");
  });

  it("a raw call that throws is caught and surfaced, never a partial artifact", async () => {
    const s = scaffold();
    const r = await runVisualGeneration(genDeps({ throws: "socket hang up" }), { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
    expect(r.status).toBe("ERROR");
  });

  it("two back-to-back generations do not corrupt each other's result", async () => {
    const s = scaffold();
    const ledger = createCostLedger({ clock });
    const [a, b] = await Promise.all([
      runVisualGeneration(genDeps({}, ledger), { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint }),
      runVisualGeneration(genDeps({}, ledger), { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint })
    ]);
    expect(a.status).toBe("OK");
    expect(b.status).toBe("OK");
    if (a.status === "OK" && b.status === "OK") {
      expect(a.artifact.request_hash).toBe(b.artifact.request_hash); // same design
    }
  });

  it("preview builds the request + estimate and books ZERO cost", async () => {
    const s = scaffold();
    const ledger = createCostLedger({ clock });
    const preview = await previewGeneration(genDeps({}, ledger), { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
    expect(preview.status).toBe("OK");
    expect(ledger.list()).toHaveLength(0);
  });
});

// --- EVIDENCE --------------------------------------------------

describe("failure matrix — EVIDENCE", () => {
  it("a missing image is rejected", async () => {
    const g = await generated();
    const r = await runVisualEvidence(
      { datasets, ids: newIds(), clock, observer: createReplayVisualEvidence({ ledger: createCostLedger({ clock }), clock, ids: newIds(), datasetVersion: datasets.version }) },
      { artifact: g.artifact, recipe: g.recipe, imageBase64: "", mimeType: "image/png" }
    );
    expect(r.status).toBe("ERROR");
    if (r.status !== "ERROR") return;
    expect(r.issues?.[0]?.code).toBe("image_missing");
  });

  it("a stale generated artifact (recipe hash mismatch) is rejected", async () => {
    const g = await generated();
    const r = await runVisualEvidence(
      { datasets, ids: newIds(), clock, observer: createReplayVisualEvidence({ ledger: createCostLedger({ clock }), clock, ids: newIds(), datasetVersion: datasets.version }) },
      { artifact: g.artifact, recipe: { ...g.recipe, recipe_hash: "deadbeef" }, imageBase64: IMAGE64, mimeType: "image/png" }
    );
    expect(r.status).toBe("ERROR");
    if (r.status !== "ERROR") return;
    expect(r.issues?.[0]?.code).toBe("stale_artifact");
  });

  it.each<EvidenceIssueCode>(["rate_limited", "provider_unavailable", "content_rejected", "invalid_observation"])(
    "a vision provider failure %s → ERROR and one failed cost event (metered)",
    async (code) => {
      const g = await generated();
      const ledger = createCostLedger({ clock });
      const failCall: RawVisionCall = async () => ({ ok: false, provider: "google", model_id: "m", latency_ms: 1, error: { code, message: code } });
      const port = createVisualEvidenceClient({
        call: failCall,
        source: { kind: "vision-model", provider: "google", model: "m" },
        ledger,
        clock,
        ids: newIds(),
        meter: true,
        datasetVersion: datasets.version
      });
      const r = await port.observe({ artifact: g.artifact, imageBytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }, { projectId: "p" });
      expect(r.ok).toBe(false);
      const events = ledger.list("p").filter((e) => e.stage === "visual_evidence");
      expect(events).toHaveLength(1);
      expect(events[0]!.status).toBe("failed");
    }
  );
});

// --- CRITIC ---------------------------------------------------

describe("failure matrix — CRITIC", () => {
  it("stale evidence is rejected, never patched into a critique", async () => {
    const s = scaffold();
    const g = await generated();
    const port = createReplayVisualEvidence({ ledger: createCostLedger({ clock }), clock, ids: newIds(), datasetVersion: datasets.version });
    const obs = await port.observe({ artifact: g.artifact, imageBytes: new Uint8Array(Buffer.from(IMAGE64, "base64")), mimeType: "image/png" }, { projectId: "p" });
    if (!obs.ok) throw new Error("evidence");
    const r = evaluateVisionCritique({ recipe: { ...s.recipe, recipe_hash: "deadbeef" }, contract: s.contract, blueprint: s.blueprint, evidence: obs.value });
    expect(r.ok).toBe(false);
  });

  it("an incomplete observation set yields unassessed dimensions, not a guess", async () => {
    const s = scaffold();
    const g = await generated();
    const port = createReplayVisualEvidence({
      ledger: createCostLedger({ clock }),
      clock,
      ids: newIds(),
      datasetVersion: datasets.version,
      payload: {
        region_count: null,
        regions: [],
        text_region_count: null,
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
      }
    });
    const obs = await port.observe({ artifact: g.artifact, imageBytes: new Uint8Array(Buffer.from(IMAGE64, "base64")), mimeType: "image/png" }, { projectId: "p" });
    if (!obs.ok) throw new Error("evidence");
    const r = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence: obs.value });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.unassessed_dimensions.length).toBeGreaterThan(0);
    for (const f of r.value.findings.filter((x) => x.basis === "unassessed")) {
      expect(f.confidence).toBe(0);
    }
  });
});

// --- CORRECTION ---------------------------------------------

describe("failure matrix — CORRECTION", () => {
  it("an out-of-bounds delta is clamped to the field ceiling", () => {
    const s = scaffold();
    const p = boundedProposal(s.recipe, "focal_dominance", "increase", 5);
    expect(Math.abs(p.delta)).toBeLessThanOrEqual(0.15 + 1e-9);
    expect(p.proposed).toBeLessThanOrEqual(1);
  });

  it("a stale recommendation is rejected", async () => {
    const s = scaffold();
    const g = await generated();
    const port = createReplayVisualEvidence({ ledger: createCostLedger({ clock }), clock, ids: newIds(), datasetVersion: datasets.version });
    const obs = await port.observe({ artifact: g.artifact, imageBytes: new Uint8Array(Buffer.from(IMAGE64, "base64")), mimeType: "image/png" }, { projectId: "p" });
    if (!obs.ok) throw new Error("evidence");
    const critique = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence: obs.value });
    if (!critique.ok) throw new Error("critique");
    const r = recommendCorrections({ recipe: { ...s.recipe, recipe_hash: "deadbeef" }, contract: s.contract, blueprint: s.blueprint, evidence: obs.value, critique: critique.value });
    expect(r.ok).toBe(false);
  });

  it("no selected recommendation → apply is rejected", async () => {
    const s = scaffold();
    const g = await generated();
    const port = createReplayVisualEvidence({ ledger: createCostLedger({ clock }), clock, ids: newIds(), datasetVersion: datasets.version });
    const obs = await port.observe({ artifact: g.artifact, imageBytes: new Uint8Array(Buffer.from(IMAGE64, "base64")), mimeType: "image/png" }, { projectId: "p" });
    if (!obs.ok) throw new Error("evidence");
    const critique = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence: obs.value });
    if (!critique.ok) throw new Error("critique");
    const recommendation = recommendCorrections({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence: obs.value, critique: critique.value });
    if (!recommendation.ok) throw new Error("rec");
    const applied = applyRecommendedCorrection(
      { datasets, ids: newIds(), clock },
      { recommendation: recommendation.value, critique: critique.value, evidence: obs.value, artifact: g.artifact, selectedCodes: [], parentRecipe: s.recipe, contract: s.contract, direction: s.direction, concept: null }
    );
    expect(applied.status).toBe("ERROR");
  });

  it("a recommendation for a different recipe → apply is rejected (corrected recipe hash mismatch)", async () => {
    const s = scaffold();
    const g = await generated();
    const port = createReplayVisualEvidence({ ledger: createCostLedger({ clock }), clock, ids: newIds(), datasetVersion: datasets.version });
    const obs = await port.observe({ artifact: g.artifact, imageBytes: new Uint8Array(Buffer.from(IMAGE64, "base64")), mimeType: "image/png" }, { projectId: "p" });
    if (!obs.ok) throw new Error("evidence");
    const critique = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence: obs.value });
    if (!critique.ok) throw new Error("critique");
    const recommendation = recommendCorrections({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence: obs.value, critique: critique.value });
    if (!recommendation.ok) throw new Error("rec");
    const codes = recommendation.value.options.filter((o) => o.scope === "single_parameter").map((o) => o.code);
    const applied = applyRecommendedCorrection(
      { datasets, ids: newIds(), clock },
      { recommendation: recommendation.value, critique: critique.value, evidence: obs.value, artifact: g.artifact, selectedCodes: codes, parentRecipe: { ...s.recipe, recipe_hash: "deadbeef" }, contract: s.contract, direction: s.direction, concept: null }
    );
    expect(applied.status).toBe("ERROR");
  });
});

// --- APPROVAL ---------------------------------------------

describe("failure matrix — APPROVAL", () => {
  it("stale artifact / recipe / blueprint / prompt each block an approval", async () => {
    const g = await generated();
    const cases: Record<string, Parameters<typeof recordCreativeDecision>[1]> = {
      "stale recipe": { action: "approved", projectId: "p", artifact: g.artifact, recipe: { ...g.recipe, recipe_hash: "deadbeef" }, blueprint: g.blueprint, request: g.request },
      "stale blueprint": { action: "approved", projectId: "p", artifact: g.artifact, recipe: g.recipe, blueprint: { ...g.blueprint, blueprint_hash: "deadbeef" }, request: g.request },
      "stale request": { action: "approved", projectId: "p", artifact: g.artifact, recipe: g.recipe, blueprint: g.blueprint, request: { ...g.request, request_hash: "deadbeef" } },
      "stale prompt": { action: "approved", projectId: "p", artifact: g.artifact, recipe: g.recipe, blueprint: g.blueprint, request: { ...g.request, provenance: { ...g.request.provenance, prompt_hash: "deadbeef" } } }
    };
    for (const input of Object.values(cases)) {
      expect(recordCreativeDecision({ clock }, input).status).toBe("ERROR");
    }
  });

  it("approving artifact A's hashes against recipe B is caught by the freshness gate", async () => {
    const a = await generated();
    const bScaffold = scaffold("northbeam-saas-launch");
    const bGen = await runVisualGeneration(genDeps(), { recipe: bScaffold.recipe, contract: bScaffold.contract, blueprint: bScaffold.blueprint });
    if (bGen.status !== "OK") throw new Error("gen b");
    const r = recordCreativeDecision(
      { clock },
      { action: "approved", projectId: "p", artifact: a.artifact, recipe: bScaffold.recipe, blueprint: bScaffold.blueprint, request: bGen.request }
    );
    expect(r.status).toBe("ERROR");
  });
});
