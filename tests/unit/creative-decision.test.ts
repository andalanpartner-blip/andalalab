import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clock, datasets, newIds, FIXED_TIME } from "../fixtures/load";
import { blueprintInputs } from "../fixtures/blueprint-inputs";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { evaluateVisionCritique } from "../../engine/critic/vision-critique";
import { recommendCorrections } from "../../engine/correction/recommend";
import { buildCreativeDecision, decisionApprovesArtifact } from "../../engine/approval/decide";
import { LOCAL_CREATIVE_ACTOR, CreativeDecision } from "../../types/schemas/creative-decision.schema";
import { deriveStageStates } from "../../lib/workspace";
import { runVisualGeneration, type GenerationServiceDeps } from "../../services/generation.service";
import { createFakeVisualGeneration, FAKE_PLACEHOLDER_PNG_BASE64 } from "../../adapters/visual-generation/fake";
import { createReplayVisualEvidence, SYNTHETIC_OBSERVATION_PAYLOAD } from "../../adapters/visual-evidence/replay";
import { recordCreativeDecision } from "../../services/creative-decision.service";
import { createCostLedger } from "../../services/cost.service";
import type { VisionObservationPayload } from "../../ports/visual-evidence.port";

/**
 * P2.18 — the human Creative Decision.
 *
 *   AI critiques → AI recommends → HUMAN DECIDES → the decision is final for
 *   this exact visual, immutable, and provenance-bound.
 */

const IMAGE = new Uint8Array(Buffer.from(FAKE_PLACEHOLDER_PNG_BASE64, "base64"));
const decideSrc = readFileSync(new URL("../../engine/approval/decide.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\/\/[^\n]*/g, " ");
const serviceSrc = readFileSync(new URL("../../services/creative-decision.service.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\/\/[^\n]*/g, " ");

function scaffold(name = "kopi-lawas-promotion") {
  const i = blueprintInputs(name);
  const bp = resolveLayoutBlueprint({ recipe: i.recipe, contract: i.contract, direction: i.direction, datasets });
  if (!bp.ok) throw new Error("blueprint did not resolve");
  return { ...i, blueprint: bp.value };
}

const genDeps = (): GenerationServiceDeps => ({
  datasets,
  ids: newIds(),
  clock,
  generator: createFakeVisualGeneration({ ledger: createCostLedger({ clock }), clock, ids: newIds(), deliverImage: true })
});

async function generated(s: ReturnType<typeof scaffold>) {
  const r = await runVisualGeneration(genDeps(), { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
  if (r.status !== "OK") throw new Error("generation failed");
  return { artifact: r.artifact, request: r.request };
}

async function reasoning(s: ReturnType<typeof scaffold>, artifact: Awaited<ReturnType<typeof generated>>["artifact"], payload?: VisionObservationPayload) {
  const port = createReplayVisualEvidence({ ledger: createCostLedger({ clock }), clock, ids: newIds(), datasetVersion: datasets.version, payload });
  const obs = await port.observe({ artifact, imageBytes: IMAGE, mimeType: "image/png" }, { projectId: "p" });
  if (!obs.ok) throw new Error("evidence failed");
  const critique = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence: obs.value });
  if (!critique.ok) throw new Error("critique failed");
  const recommendation = recommendCorrections({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence: obs.value, critique: critique.value });
  if (!recommendation.ok) throw new Error("recommendation failed");
  return { evidence: obs.value, critique: critique.value, recommendation: recommendation.value };
}

const mismatchPayload = (s: ReturnType<typeof scaffold>): VisionObservationPayload => ({
  ...SYNTHETIC_OBSERVATION_PAYLOAD,
  whitespace_share: Math.max(0, s.recipe.composition.whitespace - 0.25),
  dominant_region_index: 1,
  regions: [
    { kind: "image", rect: { x: 0, y: 0, w: 1, h: 0.3 }, area_share: 0.3, confidence: 0.7 },
    { kind: "text", rect: { x: 0.1, y: 0.55, w: 0.8, h: 0.3 }, area_share: 0.24, confidence: 0.8 }
  ]
});

const base = (s: ReturnType<typeof scaffold>, g: Awaited<ReturnType<typeof generated>>) => ({
  actor: LOCAL_CREATIVE_ACTOR,
  projectId: "proj_1",
  createdAt: FIXED_TIME,
  artifact: g.artifact,
  recipe: s.recipe,
  blueprint: s.blueprint,
  request: g.request
});

// --- 1 — schema ------------------------------------------------

describe("creative decision: schema + immutability", () => {
  it("1 / 13 — a decision validates against its schema and is frozen", async () => {
    const s = scaffold();
    const g = await generated(s);
    const d = buildCreativeDecision({ ...base(s, g), action: "approved", note: "Ship it." });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(CreativeDecision.safeParse(d.value).success).toBe(true);
    expect(Object.isFrozen(d.value)).toBe(true);
    // rebuilding the same decision yields the same hash (deterministic body)
    const again = buildCreativeDecision({ ...base(s, g), action: "approved", note: "Ship it." });
    if (!again.ok) throw new Error("expected OK");
    expect(again.value.decision_hash).toBe(d.value.decision_hash);
  });
});

// --- 2 / 3 / 4 — the three actions --------------------------

describe("creative decision: the three actions", () => {
  it("2 — an approval on a fresh visual is recorded and unlocks Final", async () => {
    const s = scaffold();
    const g = await generated(s);
    const d = buildCreativeDecision({ ...base(s, g), action: "approved", note: null });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.value.action).toBe("approved");
    expect(decisionApprovesArtifact(d.value, g.artifact)).toBe(true);
  });

  it("3 — a correction decision carries the explicitly-selected recommendation options", async () => {
    const s = scaffold();
    const g = await generated(s);
    const r = await reasoning(s, g.artifact, mismatchPayload(s));
    const codes = r.recommendation.options.filter((o) => o.scope === "single_parameter").map((o) => o.code);
    expect(codes.length).toBeGreaterThan(0);
    const d = buildCreativeDecision({
      ...base(s, g),
      action: "needs_correction",
      note: null,
      evidence: r.evidence,
      critique: r.critique,
      recommendation: r.recommendation,
      selectedCorrectionOptions: [codes[0]!]
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.value.selected_correction_options).toEqual([codes[0]]);
    expect(d.value.context.recommendation_hash).toBe(r.recommendation.recommendation_hash);
  });

  it("4 — a regenerate decision is recorded with no selected options", async () => {
    const s = scaffold();
    const g = await generated(s);
    const d = buildCreativeDecision({ ...base(s, g), action: "regenerate", note: "Try a tighter crop." });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.value.action).toBe("regenerate");
    expect(d.value.selected_correction_options).toEqual([]);
  });
});

// --- 5 / 6 / 7 / 8 — staleness never silently approved -------

describe("creative decision: freshness gate", () => {
  it("5 — a mismatched generation request (stale artifact) is rejected", async () => {
    const s = scaffold();
    const g = await generated(s);
    const staleRequest = { ...g.request, request_hash: "deadbeef" };
    const d = buildCreativeDecision({ ...base(s, g), action: "approved", note: null, request: staleRequest });
    expect(d.ok).toBe(false);
  });

  it("6 — a stale recipe hash is rejected", async () => {
    const s = scaffold();
    const g = await generated(s);
    const d = buildCreativeDecision({ ...base(s, g), action: "approved", note: null, recipe: { ...s.recipe, recipe_hash: "deadbeef" } });
    expect(d.ok).toBe(false);
  });

  it("7 — a stale blueprint hash is rejected", async () => {
    const s = scaffold();
    const g = await generated(s);
    const d = buildCreativeDecision({ ...base(s, g), action: "approved", note: null, blueprint: { ...s.blueprint, blueprint_hash: "deadbeef" } });
    expect(d.ok).toBe(false);
  });

  it("8 — a stale prompt hash is rejected", async () => {
    const s = scaffold();
    const g = await generated(s);
    const staleRequest = { ...g.request, provenance: { ...g.request.provenance, prompt_hash: "deadbeef" } };
    const d = buildCreativeDecision({ ...base(s, g), action: "approved", note: null, request: staleRequest });
    expect(d.ok).toBe(false);
  });

  it("17 — approval never silently proceeds on stale content", async () => {
    const s = scaffold();
    const g = await generated(s);
    const d = buildCreativeDecision({ ...base(s, g), action: "approved", note: null, recipe: { ...s.recipe, recipe_hash: "deadbeef" } });
    expect(d.ok).toBe(false);
    // and the service surfaces a clear, non-silent error
    const svc = recordCreativeDecision({ clock }, {
      action: "approved",
      projectId: "p",
      artifact: g.artifact,
      recipe: { ...s.recipe, recipe_hash: "deadbeef" },
      blueprint: s.blueprint,
      request: g.request
    });
    expect(svc.status).toBe("ERROR");
  });
});

// --- 9 / 10 — correction requires an explicit selection -----

describe("creative decision: correction requires explicit selection", () => {
  it("9 — needs_correction without a recommendation is rejected", async () => {
    const s = scaffold();
    const g = await generated(s);
    const d = buildCreativeDecision({ ...base(s, g), action: "needs_correction", note: null, selectedCorrectionOptions: ["x"] });
    expect(d.ok).toBe(false);
  });

  it("9 / 10 — needs_correction with a recommendation but no selection is rejected (nothing is auto-picked)", async () => {
    const s = scaffold();
    const g = await generated(s);
    const r = await reasoning(s, g.artifact, mismatchPayload(s));
    const d = buildCreativeDecision({
      ...base(s, g),
      action: "needs_correction",
      note: null,
      evidence: r.evidence,
      critique: r.critique,
      recommendation: r.recommendation,
      selectedCorrectionOptions: []
    });
    expect(d.ok).toBe(false);
  });

  it("10 — an option code not in the recommendation is rejected (no unsupported parameter)", async () => {
    const s = scaffold();
    const g = await generated(s);
    const r = await reasoning(s, g.artifact, mismatchPayload(s));
    const d = buildCreativeDecision({
      ...base(s, g),
      action: "needs_correction",
      note: null,
      evidence: r.evidence,
      critique: r.critique,
      recommendation: r.recommendation,
      selectedCorrectionOptions: ["not-a-real-option"]
    });
    expect(d.ok).toBe(false);
  });
});

// --- 11 / 12 — decisions never generate --------------------

describe("creative decision: never generates", () => {
  it("11 / 12 — the builder and the service never call a provider or the generation service", () => {
    for (const src of [decideSrc, serviceSrc]) {
      expect(src).not.toMatch(/runVisualGeneration|previewGeneration|\.generate\(|adapters\/|fetch\(|CostLedger|\bledger\b/);
    }
  });

  it("11 — a regenerate decision returns without touching generation", async () => {
    const s = scaffold();
    const g = await generated(s);
    const svc = recordCreativeDecision({ clock }, {
      action: "regenerate",
      projectId: "p",
      artifact: g.artifact,
      recipe: s.recipe,
      blueprint: s.blueprint,
      request: g.request
    });
    expect(svc.status).toBe("OK");
  });
});

// --- 14 — provenance --------------------------------------

describe("creative decision: provenance", () => {
  it("14 — the subject and context bind to the exact upstream hashes", async () => {
    const s = scaffold();
    const g = await generated(s);
    const r = await reasoning(s, g.artifact, mismatchPayload(s));
    const codes = r.recommendation.options.filter((o) => o.scope === "single_parameter").map((o) => o.code);
    const d = buildCreativeDecision({
      ...base(s, g),
      action: "needs_correction",
      note: null,
      evidence: r.evidence,
      critique: r.critique,
      recommendation: r.recommendation,
      selectedCorrectionOptions: [codes[0]!]
    });
    if (!d.ok) throw new Error("expected OK");
    const dec = d.value;
    expect(dec.subject.artifact_hash).toBe(g.artifact.artifact_hash);
    expect(dec.subject.recipe_hash).toBe(s.recipe.recipe_hash);
    expect(dec.subject.blueprint_hash).toBe(s.blueprint.blueprint_hash);
    expect(dec.subject.prompt_hash).toBe(g.artifact.provenance.prompt_hash);
    expect(dec.subject.generation_request_hash).toBe(g.artifact.request_hash);
    expect(dec.context.evidence_hash).toBe(r.evidence.evidence_hash);
    expect(dec.context.critique_hash).toBe(r.critique.critique_hash);
  });
});

// --- 15 — approved state unlocks Final --------------------

describe("creative decision: unlocks Final", () => {
  const signals = (over = {}) => ({
    briefReady: true,
    clarifying: false,
    conceptSelected: true,
    hasRecipe: true,
    hasReview: true,
    criticVerdict: null as "PASS" | "REVIEW" | "BLOCK" | null,
    ...over
  });

  it("15 — Final is locked without an approval and done with one", () => {
    expect(deriveStageStates(signals()).final).toBe("locked");
    expect(deriveStageStates(signals({ hasApproval: true })).final).toBe("done");
  });
});

// --- 16 — prior decisions are never mutated --------------

describe("creative decision: prior decisions remain unchanged", () => {
  it("16 — three sequential decisions each keep their own action and hash", async () => {
    const s = scaffold();
    const g = await generated(s);
    const r = await reasoning(s, g.artifact, mismatchPayload(s));
    const codes = r.recommendation.options.filter((o) => o.scope === "single_parameter").map((o) => o.code);

    const a = buildCreativeDecision({ ...base(s, g), action: "regenerate", note: null });
    const b = buildCreativeDecision({
      ...base(s, g),
      action: "needs_correction",
      note: null,
      evidence: r.evidence,
      critique: r.critique,
      recommendation: r.recommendation,
      selectedCorrectionOptions: [codes[0]!]
    });
    const c = buildCreativeDecision({ ...base(s, g), action: "approved", note: null });
    if (!a.ok || !b.ok || !c.ok) throw new Error("expected OK");

    expect(a.value.action).toBe("regenerate");
    expect(b.value.action).toBe("needs_correction");
    expect(c.value.action).toBe("approved");
    const hashes = new Set([a.value.decision_hash, b.value.decision_hash, c.value.decision_hash]);
    expect(hashes.size).toBe(3);
    for (const d of [a.value, b.value, c.value]) expect(Object.isFrozen(d)).toBe(true);
  });
});
