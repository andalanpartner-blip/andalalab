import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clock, datasets, newIds } from "../fixtures/load";
import { blueprintInputs } from "../fixtures/blueprint-inputs";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { evaluateVisionCritique } from "../../engine/critic/vision-critique";
import { recommendCorrections, toCorrectionPatch } from "../../engine/correction/recommend";
import { MAX_ABS_DELTA, RECOMMENDABLE_FIELDS } from "../../engine/correction/policy";
import { applyCorrection } from "../../engine/correction/apply";
import { CorrectionField, CorrectionPatch } from "../../types/schemas/correction.schema";
import { CorrectionRecommendation } from "../../types/schemas/correction-recommendation.schema";
import { runVisualGeneration, type GenerationServiceDeps } from "../../services/generation.service";
import { createFakeVisualGeneration, FAKE_PLACEHOLDER_PNG_BASE64 } from "../../adapters/visual-generation/fake";
import { createReplayVisualEvidence, SYNTHETIC_OBSERVATION_PAYLOAD } from "../../adapters/visual-evidence/replay";
import { createCostLedger } from "../../services/cost.service";
import { sequentialIds } from "../../ports/id.port";
import { deepFreeze } from "../../domain/contract";
import type { VisionObservationPayload } from "../../ports/visual-evidence.port";

/**
 * P2.16 — Correction Recommendation.
 *
 * Turns a `DesignCritique` into BOUNDED corrective options over parameters the
 * P6 Correction Engine already supports. It proposes; it never applies.
 */

const IMAGE = new Uint8Array(Buffer.from(FAKE_PLACEHOLDER_PNG_BASE64, "base64"));
const recommendSrc = readFileSync(new URL("../../engine/correction/recommend.ts", import.meta.url), "utf8")
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

/** A payload with a clear focal mismatch (text region dominant) + whitespace + density gaps + a crop. */
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

async function pipeline(s: ReturnType<typeof scaffold>, payload: VisionObservationPayload) {
  const gen = await runVisualGeneration(genDeps(), { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
  if (gen.status !== "OK") throw new Error("generation failed");
  const port = createReplayVisualEvidence({ ledger: createCostLedger({ clock }), clock, ids: newIds(), datasetVersion: datasets.version, payload });
  const observed = await port.observe({ artifact: gen.artifact, imageBytes: IMAGE, mimeType: "image/png" }, { projectId: "proj_x" });
  if (!observed.ok) throw new Error("evidence failed");
  const critique = evaluateVisionCritique({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence: observed.value });
  if (!critique.ok) throw new Error("critique failed");
  return { artifact: gen.artifact, evidence: observed.value, critique: critique.value };
}

// --- 1 — valid, bound artifact -------------------------------

describe("correction recommendation: valid, bound artifact", () => {
  it("1 — validates against its schema, is frozen, and binds to the critique / evidence / recipe", async () => {
    const s = scaffold();
    const { critique, evidence } = await pipeline(s, mismatchPayload(s));
    const result = recommendCorrections({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence, critique });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(CorrectionRecommendation.safeParse(result.value).success).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(result.value.provenance.critique_hash).toBe(critique.critique_hash);
    expect(result.value.provenance.evidence_hash).toBe(evidence.evidence_hash);
    expect(result.value.provenance.recipe_hash).toBe(s.recipe.recipe_hash);
  });
});

// --- 2 / 3 / 5 — exact parameter path, bounded delta, supported only ---

describe("correction recommendation: bounded and supported", () => {
  it("2 / 5 — every single_parameter option names an existing CorrectionField and a recipe path", async () => {
    const s = scaffold();
    const { critique, evidence } = await pipeline(s, mismatchPayload(s));
    const r = recommendCorrections({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence, critique });
    if (!r.ok) throw new Error("expected OK");
    const single = r.value.options.filter((o) => o.scope === "single_parameter");
    expect(single.length).toBeGreaterThan(0);
    for (const o of single) {
      expect(CorrectionField.options).toContain(o.correction_field);
      expect(RECOMMENDABLE_FIELDS).toContain(o.correction_field as (typeof RECOMMENDABLE_FIELDS)[number]);
      expect(o.parameter_path).toMatch(/^(dkv\.|color\.)?[a-z_]+$/);
    }
  });

  it("3 — every proposed delta is within the field ceiling and the field range", async () => {
    const s = scaffold();
    const { critique, evidence } = await pipeline(s, mismatchPayload(s));
    const r = recommendCorrections({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence, critique });
    if (!r.ok) throw new Error("expected OK");
    for (const o of r.value.options.filter((x) => x.scope === "single_parameter")) {
      const field = o.correction_field as (typeof RECOMMENDABLE_FIELDS)[number];
      expect(Math.abs(o.delta!)).toBeLessThanOrEqual(MAX_ABS_DELTA[field] + 1e-9);
      expect(Math.abs(o.delta!)).toBeLessThanOrEqual(o.bounds!.max_abs_delta + 1e-9);
      expect(o.proposed_value!).toBeGreaterThanOrEqual(o.bounds!.field_min - 1e-9);
      expect(o.proposed_value!).toBeLessThanOrEqual(o.bounds!.field_max + 1e-9);
    }
  });
});

// --- 4 — feeds the unchanged P6 engine -----------------------

describe("correction recommendation: P6 compatibility", () => {
  it("4 — toCorrectionPatch builds a patch the P6 engine accepts, preserving the movement / concept", async () => {
    const s = scaffold();
    const { critique, evidence } = await pipeline(s, mismatchPayload(s));
    const r = recommendCorrections({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence, critique });
    if (!r.ok) throw new Error("expected OK");
    const codes = r.value.options.filter((o) => o.scope === "single_parameter").map((o) => o.code);
    const draft = toCorrectionPatch(r.value, codes);
    expect(draft.patch).not.toBeNull();
    expect(CorrectionPatch.safeParse(draft.patch).success).toBe(true);

    const applied = applyCorrection({
      parentRecipe: s.recipe,
      contract: s.contract,
      direction: s.direction,
      patch: draft.patch!,
      datasets,
      ids: sequentialIds(),
      clock,
      concept: null
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(["adjustment", "noop"]).toContain(applied.value.report.outcome);
    if (applied.value.recipe) {
      expect(applied.value.recipe.movement.id).toBe(s.recipe.movement.id);
      expect(applied.value.recipe.composition.strategy).toBe(s.recipe.composition.strategy);
    }
  });
});

// --- 6 — preservation list -----------------------------------

describe("correction recommendation: preservation", () => {
  it("6 — the preserved invariants name concept, brand, movement, objective and core message", async () => {
    const s = scaffold();
    const { critique, evidence } = await pipeline(s, mismatchPayload(s));
    const r = recommendCorrections({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence, critique });
    if (!r.ok) throw new Error("expected OK");
    const joined = r.value.preserved.join(" ").toLowerCase();
    for (const term of ["concept", "brand", "movement", "objective", "core message"]) {
      expect(joined).toContain(term);
    }
    for (const o of r.value.options) expect(o.preserve).toEqual(r.value.preserved);
  });
});

// --- 7 — deterministic --------------------------------------

describe("correction recommendation: deterministic", () => {
  it("7 — identical inputs produce an identical recommendation_hash and option order", async () => {
    const s = scaffold();
    const { critique, evidence } = await pipeline(s, mismatchPayload(s));
    const a = recommendCorrections({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence, critique });
    const b = recommendCorrections({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence, critique });
    if (!a.ok || !b.ok) throw new Error("expected OK");
    expect(a.value.recommendation_hash).toBe(b.value.recommendation_hash);
    expect(a.value.options.map((o) => o.code)).toEqual(b.value.options.map((o) => o.code));
  });
});

// --- 9 / 10 / 11 / 12 — proposes only, no side effects -------

describe("correction recommendation: proposes only", () => {
  it("9 / 10 / 11 — the source never applies, regenerates, or calls a provider", () => {
    expect(recommendSrc).not.toMatch(/applyCorrection\(|runCorrectionPipeline|\.generate\(|runVisualGeneration/);
    expect(recommendSrc).not.toMatch(/adapters\/|\/api\/|fetch\(|CostLedger/);
  });

  it("12 — a frozen recipe is not mutated while producing a recommendation", async () => {
    const s = scaffold();
    const { critique, evidence } = await pipeline(s, mismatchPayload(s));
    const recipe = deepFreeze(structuredClone(s.recipe));
    const before = JSON.stringify(recipe);
    recommendCorrections({ recipe, contract: s.contract, blueprint: s.blueprint, evidence, critique });
    expect(JSON.stringify(recipe)).toBe(before);
  });
});

// --- 13 — the human gate ------------------------------------

describe("correction recommendation: nothing is applied without an explicit selection", () => {
  it("13 — an empty selection yields a null patch; regenerate-only options are skipped, not applied", async () => {
    const s = scaffold();
    const { critique, evidence } = await pipeline(s, mismatchPayload(s));
    const r = recommendCorrections({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence, critique });
    if (!r.ok) throw new Error("expected OK");

    expect(toCorrectionPatch(r.value, []).patch).toBeNull();

    const regen = r.value.options.find((o) => o.scope === "regenerate_only");
    if (regen) {
      const draft = toCorrectionPatch(r.value, [regen.code]);
      expect(draft.patch).toBeNull();
      expect(draft.skipped).toContain(regen.code);
    }

    const single = r.value.options.find((o) => o.scope === "single_parameter");
    if (single) {
      const draft = toCorrectionPatch(r.value, [single.code]);
      expect(draft.selected).toEqual([single.code]);
      expect(draft.patch!.adjustments).toHaveLength(1);
      expect(draft.patch!.adjustments[0]!.field).toBe(single.correction_field);
      expect(draft.patch!.adjustments[0]!.mode).toBe("set");
    }
  });

  it("8 — a clean critique produces no options and an explicit note", async () => {
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
      edge_bleed: s.blueprint.zones.some((z) => ["image", "hero", "product"].includes(z.id) && !z.within_safe_area) ? "partial" : "none"
    };
    const { critique, evidence } = await pipeline(s, aligned);
    const r = recommendCorrections({ recipe: s.recipe, contract: s.contract, blueprint: s.blueprint, evidence, critique });
    if (!r.ok) throw new Error("expected OK");
    expect(r.value.options.filter((o) => o.scope === "single_parameter")).toHaveLength(0);
    expect(r.value.note.length).toBeGreaterThan(8);
  });
});

// --- stale critique rejected -------------------------------

describe("correction recommendation: rejects a stale critique", () => {
  it("a critique made against a different recipe is rejected", async () => {
    const s = scaffold();
    const { critique, evidence } = await pipeline(s, mismatchPayload(s));
    const result = recommendCorrections({
      recipe: { ...s.recipe, recipe_hash: "deadbeef" },
      contract: s.contract,
      blueprint: s.blueprint,
      evidence,
      critique
    });
    expect(result.ok).toBe(false);
  });
});
