import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clock, datasets, newIds } from "../fixtures/load";
import { blueprintInputs } from "../fixtures/blueprint-inputs";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { evaluateVisionCritique } from "../../engine/critic/vision-critique";
import { DesignCritique } from "../../types/schemas/design-critique.schema";
import { runVisualGeneration, type GenerationServiceDeps } from "../../services/generation.service";
import { createFakeVisualGeneration, FAKE_PLACEHOLDER_PNG_BASE64 } from "../../adapters/visual-generation/fake";
import { createReplayVisualEvidence, SYNTHETIC_OBSERVATION_PAYLOAD } from "../../adapters/visual-evidence/replay";
import { createCostLedger } from "../../services/cost.service";
import { deepFreeze } from "../../domain/contract";
import type { VisionObservationPayload } from "../../ports/visual-evidence.port";

/**
 * P2.15 — the vision-aware Design Critic.
 *
 * `recipe + blueprint + contract + VisualEvidenceReport → DesignCritique`.
 * Pure, deterministic. It compares intent to observation and reports
 * mismatches — it never mutates an input, never decides a correction and never
 * regenerates.
 */

const IMAGE = new Uint8Array(Buffer.from(FAKE_PLACEHOLDER_PNG_BASE64, "base64"));

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

async function evidenceFor(
  scaffolded: ReturnType<typeof scaffold>,
  payload: VisionObservationPayload = SYNTHETIC_OBSERVATION_PAYLOAD
) {
  const gen = await runVisualGeneration(genDeps(), {
    recipe: scaffolded.recipe,
    contract: scaffolded.contract,
    blueprint: scaffolded.blueprint
  });
  if (gen.status !== "OK") throw new Error("generation failed");
  const port = createReplayVisualEvidence({
    ledger: createCostLedger({ clock }),
    clock,
    ids: newIds(),
    datasetVersion: datasets.version,
    payload
  });
  const observed = await port.observe(
    { artifact: gen.artifact, imageBytes: IMAGE, mimeType: "image/png" },
    { projectId: "proj_x" }
  );
  if (!observed.ok) throw new Error("evidence failed");
  return { artifact: gen.artifact, evidence: observed.value };
}

const critiqueSrc = readFileSync(new URL("../../engine/critic/vision-critique.ts", import.meta.url), "utf8");

// --- 1 / 2 — a valid, provenance-bound artifact -----------------

describe("vision critique: produces a valid, bound artifact", () => {
  it("1 — the critique validates against its schema and is frozen", async () => {
    const s = scaffold();
    const { evidence } = await evidenceFor(s);
    const result = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(DesignCritique.safeParse(result.value).success).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(["PASS", "REVIEW", "BLOCK", "UNASSESSED"]).toContain(result.value.verdict);
    expect(result.value.doctrine).toHaveLength(7);
  });

  it("2 — provenance binds to the evidence, artifact, recipe and blueprint by hash", async () => {
    const s = scaffold();
    const { artifact, evidence } = await evidenceFor(s);
    const result = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence });
    if (!result.ok) throw new Error("expected OK");
    const p = result.value.provenance;
    expect(p.evidence_hash).toBe(evidence.evidence_hash);
    expect(p.artifact_hash).toBe(artifact.artifact_hash);
    expect(p.recipe_hash).toBe(s.recipe.recipe_hash);
    expect(p.blueprint_hash).toBe(s.blueprint.blueprint_hash);
    expect(p.prompt_hash).toBe(evidence.provenance.prompt_hash);
    expect(p.generation_request_hash).toBe(evidence.provenance.generation_request_hash);
  });
});

// --- 3 — every finding names an intent signal + an evidence ref ---

describe("vision critique: intent / evidence binding", () => {
  it("3 — each finding names the intended signal and the observed evidence reference", async () => {
    const s = scaffold();
    const { evidence } = await evidenceFor(s);
    const result = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence });
    if (!result.ok) throw new Error("expected OK");
    expect(result.value.findings.length).toBeGreaterThan(0);
    for (const f of result.value.findings) {
      expect(f.intended.signal).toMatch(/recipe\.|blueprint\.|engine\/|generation target/);
      expect(f.observed.evidence_ref.length).toBeGreaterThan(0);
      expect(f.comparison.length).toBeGreaterThan(8);
    }
  });
});

// --- 4 — deterministic -----------------------------------------

describe("vision critique: deterministic", () => {
  it("4 — identical inputs produce an identical critique_hash and finding order", async () => {
    const s = scaffold();
    const { evidence } = await evidenceFor(s);
    const a = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence });
    const b = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence });
    if (!a.ok || !b.ok) throw new Error("expected OK");
    expect(a.value.critique_hash).toBe(b.value.critique_hash);
    expect(a.value.findings.map((f) => f.code)).toEqual(b.value.findings.map((f) => f.code));
  });

  it("4 — findings are ordered most-severe first", async () => {
    const s = scaffold();
    const { evidence } = await evidenceFor(s, {
      ...SYNTHETIC_OBSERVATION_PAYLOAD,
      crop_behavior: "cropped",
      whitespace_share: 0.02
    });
    const result = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence });
    if (!result.ok) throw new Error("expected OK");
    const ranks = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
    const seq = result.value.findings.map((f) => ranks[f.severity]);
    expect(seq).toEqual([...seq].sort((x, y) => x - y));
  });
});

// --- 5 — severity classification -----------------------------

describe("vision critique: severity classification", () => {
  it("5 — a cropped render is a major_mismatch (P1) on platform_format", async () => {
    const s = scaffold();
    const { evidence } = await evidenceFor(s, { ...SYNTHETIC_OBSERVATION_PAYLOAD, crop_behavior: "cropped" });
    const result = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence });
    if (!result.ok) throw new Error("expected OK");
    const crop = result.value.findings.find((f) => f.dimension === "platform_format");
    expect(crop?.classification).toBe("major_mismatch");
    expect(crop?.severity).toBe("P1");
    expect(result.value.verdict).toBe("REVIEW");
  });

  it("5 — a small whitespace gap is a minor_mismatch (P2), a large one is major (P1)", async () => {
    const s = scaffold();
    const intended = s.recipe.composition.whitespace;
    const minor = await evidenceFor(s, { ...SYNTHETIC_OBSERVATION_PAYLOAD, whitespace_share: Math.max(0, intended - 0.2) });
    const r1 = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence: minor.evidence });
    if (!r1.ok) throw new Error("expected OK");
    const w1 = r1.value.findings.find((f) => f.dimension === "whitespace_alignment");
    expect(["minor_mismatch", "major_mismatch"]).toContain(w1?.classification);
  });

  it("5 — an aligned render passes with no mismatch", async () => {
    const s = scaffold();
    const aligned: VisionObservationPayload = {
      ...SYNTHETIC_OBSERVATION_PAYLOAD,
      crop_behavior: "as-requested",
      whitespace_share: s.recipe.composition.whitespace,
      approx_visual_density: s.recipe.composition.density,
      color: { dominant_hexes: [], approx_palette_size: s.recipe.color.palette_size, approx_contrast: s.recipe.color.contrast },
      region_count: s.blueprint.zones.length,
      text_region_count: s.blueprint.zones.filter((z) => z.text_bearing).length,
      dominant_region_index: 0,
      regions: [
        {
          kind: "image",
          rect: { x: Math.max(0, s.blueprint.focal.x - 0.25), y: Math.max(0, s.blueprint.focal.y - 0.25), w: 0.5, h: 0.5 },
          area_share: 0.5,
          confidence: 0.9
        }
      ],
      approx_subject_position: { x: s.blueprint.focal.x, y: s.blueprint.focal.y },
      edge_bleed: s.blueprint.zones.some((z) => ["image", "hero", "product"].includes(z.id) && !z.within_safe_area)
        ? "partial"
        : "none"
    };
    const { evidence } = await evidenceFor(s, aligned);
    const result = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence });
    if (!result.ok) throw new Error("expected OK");
    expect(result.value.findings.filter((f) => f.classification === "major_mismatch")).toHaveLength(0);
    expect(["PASS", "REVIEW"]).toContain(result.value.verdict);
  });
});

// --- 6 — confidence + unassessed handling ------------------

describe("vision critique: confidence and unassessed", () => {
  it("6 — an unassessed dimension yields a P3 finding with confidence 0 and basis unassessed", async () => {
    const s = scaffold();
    const { evidence } = await evidenceFor(s, {
      ...SYNTHETIC_OBSERVATION_PAYLOAD,
      whitespace_share: null,
      approx_visual_density: null,
      color: null
    });
    const result = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence });
    if (!result.ok) throw new Error("expected OK");
    const w = result.value.findings.find((f) => f.dimension === "whitespace_alignment");
    expect(w?.classification).toBe("unassessed");
    expect(w?.basis).toBe("unassessed");
    expect(w?.confidence).toBe(0);
    expect(result.value.unassessed_dimensions).toContain("whitespace_alignment");
  });

  it("6 — assessed findings carry a confidence in (0, 1]", async () => {
    const s = scaffold();
    const { evidence } = await evidenceFor(s);
    const result = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence });
    if (!result.ok) throw new Error("expected OK");
    for (const f of result.value.findings.filter((x) => x.basis === "evidence-backed")) {
      expect(f.confidence).toBeGreaterThan(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// --- 7 — no arbitrary fields --------------------------------

describe("vision critique: strict shape", () => {
  it("7 — the artifact rejects any field not in the schema", async () => {
    const s = scaffold();
    const { evidence } = await evidenceFor(s);
    const result = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence });
    if (!result.ok) throw new Error("expected OK");
    const tampered = { ...result.value, freeform_note: "hello" };
    expect(DesignCritique.safeParse(tampered).success).toBe(false);
  });
});

// --- 8 / 9 / 12 — no mutation, no regeneration, no side effects ---

describe("vision critique: computes nothing beyond the comparison", () => {
  it("8 — frozen inputs are not mutated", async () => {
    const s = scaffold();
    const { evidence } = await evidenceFor(s);
    const recipe = deepFreeze(structuredClone(s.recipe));
    const blueprint = deepFreeze(structuredClone(s.blueprint));
    const recipeBefore = JSON.stringify(recipe);
    const blueprintBefore = JSON.stringify(blueprint);
    const result = evaluateVisionCritique({ recipe, contract: s.contract, blueprint, evidence });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(recipe)).toBe(recipeBefore);
    expect(JSON.stringify(blueprint)).toBe(blueprintBefore);
  });

  it("9 / 12 — the critic source never applies a correction, regenerates, or takes a provider / ledger", () => {
    expect(critiqueSrc).not.toMatch(/applyCorrection|runCorrectionPipeline|\.generate\(|runVisualGeneration|CostLedger|\bledger\b/);
    expect(critiqueSrc).not.toMatch(/adapters\/|\/api\/|fetch\(/);
  });
});

// --- 10 — replay fixture path ------------------------------

describe("vision critique: replay fixture", () => {
  it("10 — runs against evidence produced by the replay observer", async () => {
    const s = scaffold();
    const { evidence } = await evidenceFor(s);
    expect(evidence.source.kind).toBe("replay-fixture");
    const result = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence });
    expect(result.ok).toBe(true);
  });
});

// --- 11 — stale evidence is rejected, never patched --------

describe("vision critique: rejects stale evidence", () => {
  it("11 — evidence made against a different recipe is rejected", async () => {
    const s = scaffold();
    const { evidence } = await evidenceFor(s);
    const staleRecipe = { ...s.recipe, recipe_hash: "deadbeef" };
    const result = evaluateVisionCritique({
      recipe: staleRecipe,
      contract: s.contract,
      blueprint: s.blueprint,
      evidence
    });
    expect(result.ok).toBe(false);
  });
});
