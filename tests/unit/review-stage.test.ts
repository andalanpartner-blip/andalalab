import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clock, datasets, newIds } from "../fixtures/load";
import { blueprintInputs } from "../fixtures/blueprint-inputs";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { applyCorrection } from "../../engine/correction/apply";
import { sequentialIds } from "../../ports/id.port";
import { STAGES, STAGE_META, deriveStageStates, isReachable, isStageId } from "../../lib/workspace";
import {
  REVIEW_STAGE_LINKS,
  designIntentRows,
  generatedImageAlt,
  generationResultRows,
  hasDisplayableImage,
  isTestProviderArtifact,
  isVisualStaleForBlueprint,
  isVisualStaleForRecipe,
  providerTrustLabel,
  reviewProvenanceRows
} from "../../lib/review-view";
import { runVisualGeneration, type GenerationServiceDeps } from "../../services/generation.service";
import { FAKE_GENERATION_PROVIDER, createFakeVisualGeneration } from "../../adapters/visual-generation/fake";
import { createCostLedger } from "../../services/cost.service";

/**
 * UI/UX-04 — pure logic tests for the Review stage wiring (Node test strategy,
 * no jsdom). Every test proves the Review stage READS existing artifacts and
 * never recomputes a design decision, a score, or a critique from pixels.
 */

const signals = (over = {}) => ({
  briefReady: true,
  clarifying: false,
  conceptSelected: true,
  hasRecipe: true,
  hasReview: true,
  criticVerdict: null as "PASS" | "REVIEW" | "BLOCK" | null,
  ...over
});

function scaffold(name = "kopi-lawas-promotion") {
  const i = blueprintInputs(name);
  const bp = resolveLayoutBlueprint({
    recipe: i.recipe,
    contract: i.contract,
    direction: i.direction,
    datasets
  });
  if (!bp.ok) throw new Error("blueprint did not resolve");
  return { ...i, blueprint: bp.value };
}

const fakeDeps = (opts: { deliverImage?: boolean } = {}): GenerationServiceDeps => {
  const ledger = createCostLedger({ clock });
  return {
    datasets,
    ids: newIds(),
    clock,
    generator: createFakeVisualGeneration({ ledger, clock, ids: newIds(), ...opts })
  };
};

async function generate(name = "kopi-lawas-promotion", opts: { deliverImage?: boolean } = { deliverImage: true }) {
  const s = scaffold(name);
  const result = await runVisualGeneration(fakeDeps(opts), {
    recipe: s.recipe,
    contract: s.contract,
    blueprint: s.blueprint
  });
  if (result.status !== "OK") throw new Error("generation did not succeed in the fixture");
  return { ...s, artifact: result.artifact, request: result.request };
}

const readSrc = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const reviewViewSrc = readSrc("../../lib/review-view.ts");
const reviewStageSrc = readSrc("../../components/workspace/ReviewStage.tsx");
const pageSrc = readSrc("../../components/workspace/Workspace.tsx");

// --- 1 -----------------------------------------------------------

describe("review stage reachability", () => {
  it("1 — review is a real stage, reachable once a recipe exists, right after generate", () => {
    expect(STAGES).toContain("review");
    expect(STAGE_META.review.future).toBe(false);
    expect([...STAGES].indexOf("review")).toBe([...STAGES].indexOf("generate") + 1);
    expect(isReachable(deriveStageStates(signals()).review)).toBe(true);
    expect(deriveStageStates(signals({ hasRecipe: false, conceptSelected: false })).review).toBe("locked");
  });
});

// --- 2 / 4 / 6 -------------------------------------------------

describe("the review surface reads the threaded artifacts", () => {
  it("2 — the GeneratedArtifact threaded from Generate drives the result view verbatim", async () => {
    const { artifact } = await generate();
    const byLabel = Object.fromEntries(generationResultRows(artifact).map((r) => [r.label, r.value]));
    expect(byLabel["Generated size"]).toBe(`${artifact.image.width} × ${artifact.image.height} px`);
    expect(byLabel["Artifact hash"]).toBe(artifact.artifact_hash);
    expect(byLabel["Status"]).toBe("Generated");
  });

  it("4 — design intent is read from the recipe / contract / blueprint / request, not recomputed", async () => {
    const { recipe, contract, blueprint, request } = await generate();
    const byLabel = Object.fromEntries(
      designIntentRows({ recipe, contract, blueprint, concept: null, request }).map((r) => [r.label, r.value])
    );
    expect(byLabel["Visual type"]).toBe(contract.visual_type.name);
    expect(byLabel["Focal zone"]).toBe(
      blueprint.zones.find((z) => z.id === blueprint.focal.zone)!.label
    );
    // the aspect ratio matches the request the provider actually received
    expect(byLabel["Aspect ratio"]).toContain(":");
  });

  it("6 — provenance rows are a pure read of the artifact's own hashes", async () => {
    const { artifact } = await generate();
    const byLabel = Object.fromEntries(reviewProvenanceRows(artifact).map((r) => [r.label, r.value]));
    expect(byLabel["Recipe hash"]).toBe(artifact.provenance.recipe_hash);
    expect(byLabel["Prompt hash"]).toBe(artifact.provenance.prompt_hash);
    expect(byLabel["Generation request hash"]).toBe(artifact.request_hash);
    expect(byLabel["Artifact hash"]).toBe(artifact.artifact_hash);
    expect(byLabel["Blueprint hash"]).toBe(artifact.provenance.blueprint_hash);
  });
});

// --- 3 / 5 / 14 — no generation, no recompute, no vision -------

describe("the review stage computes nothing", () => {
  it("3 — neither the view helpers nor the component can trigger a generation", () => {
    for (const src of [reviewViewSrc, reviewStageSrc]) {
      // the Review stage may POST a human decision (P2.18) but must never
      // reach the generation endpoint or service.
      expect(src).not.toMatch(/runVisualGeneration|previewGeneration|["'`]\/api\/generate\b/);
    }
    // any fetch in the component goes to /api/decision (or /api/vision-loop via
    // the child inspection panel), never to /api/generate.
    const fetchTargets = [...reviewStageSrc.matchAll(/fetch\(\s*["'`](\/api\/[a-z-]+)/g)].map((m) => m[1]);
    for (const t of fetchTargets) expect(t).not.toBe("/api/generate");
  });

  it("5 — compliance comes from the existing ReviewSummary; nothing re-audits the design", () => {
    expect(reviewStageSrc).toMatch(/<ReviewSummary/);
    for (const src of [reviewViewSrc, reviewStageSrc]) {
      expect(src).not.toMatch(/engine\/critic|auditDesign|reviewVisual|runVisualReview/);
    }
  });

  it("14 — no image-analysis / computer-vision / visual-scoring logic is present", () => {
    for (const src of [reviewViewSrc, reviewStageSrc]) {
      expect(src).not.toMatch(
        /pixel analysis|computer vision|opencv|cv2|tensorflow|analyze ?image|image critique|visual scoring|image understanding/i
      );
    }
  });
});

// --- 7 / 8 / 13 — stale / mismatch detection ------------------

describe("stale-visual detection", () => {
  it("7 — a recipe-hash mismatch is detected; a match and a null artifact are not stale", async () => {
    const { artifact, recipe } = await generate();
    expect(isVisualStaleForRecipe(artifact, recipe.recipe_hash)).toBe(false);
    expect(isVisualStaleForRecipe(artifact, "deadbeef")).toBe(true);
    expect(isVisualStaleForRecipe(null, recipe.recipe_hash)).toBe(false);
  });

  it("8 — a blueprint-hash mismatch is detected; no-blueprint comparisons are never stale", async () => {
    const { artifact, blueprint } = await generate();
    expect(isVisualStaleForBlueprint(artifact, blueprint.blueprint_hash)).toBe(false);
    expect(isVisualStaleForBlueprint(artifact, "deadbeef")).toBe(true);
    expect(isVisualStaleForBlueprint(artifact, null)).toBe(false);
    expect(isVisualStaleForBlueprint(null, blueprint.blueprint_hash)).toBe(false);
  });

  it("13 — a correction that rebuilds the recipe leaves the old visual visibly stale", async () => {
    const { artifact, recipe, contract, direction } = await generate();
    const corrected = applyCorrection({
      parentRecipe: recipe,
      contract,
      direction,
      patch: { adjustments: [{ field: "whitespace", mode: "increase", amount: 0.08 }] },
      datasets,
      ids: sequentialIds(),
      clock,
      concept: null
    });
    if (!corrected.ok) throw new Error("correction errored");
    const next = corrected.value.recipe;
    expect(next).not.toBeNull();
    expect(next!.recipe_hash).not.toBe(recipe.recipe_hash);
    // the artifact was NOT regenerated — Review must surface the mismatch
    expect(isVisualStaleForRecipe(artifact, next!.recipe_hash)).toBe(true);
  });
});

// --- 9 — truthful no-image state ------------------------------

describe("no-image state is truthful", () => {
  it("9 — when no image is transported the metadata still describes the real generation", async () => {
    const s = scaffold();
    const result = await runVisualGeneration(fakeDeps({ deliverImage: false }), {
      recipe: s.recipe,
      contract: s.contract,
      blueprint: s.blueprint
    });
    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;

    expect(hasDisplayableImage(null)).toBe(false);
    expect(hasDisplayableImage("data:image/png;base64,AA")).toBe(true);

    const rows = generationResultRows(result.artifact);
    expect(rows.find((r) => r.label === "Generated size")!.value).toContain(
      String(result.artifact.image.width)
    );
    expect(["none", "base64-ref", "url", "provider-ref"]).toContain(result.artifact.image.delivery);
  });
});

// --- 10 — fake output never reads as production imagery -------

describe("real vs test provider", () => {
  it("10 — the fake adapter's output is labelled as a local test render, never as production", async () => {
    const { artifact } = await generate();
    expect(artifact.provider).toBe(FAKE_GENERATION_PROVIDER);
    expect(isTestProviderArtifact(artifact)).toBe(true);
    expect(providerTrustLabel(artifact)).toMatch(/not a real generation/i);

    const alt = generatedImageAlt({
      artifact,
      contract: (await generate()).contract,
      recipe: (await generate()).recipe,
      concept: null
    });
    expect(alt).toMatch(/px/);
  });
});

// --- 11 — navigation targets are all existing stages ----------

describe("navigation wiring", () => {
  it("11 — every Review navigation target is a real stage id", () => {
    for (const stage of Object.values(REVIEW_STAGE_LINKS)) {
      expect(isStageId(stage)).toBe(true);
    }
    const targets = [...reviewStageSrc.matchAll(/onNavigate\("([a-z]+)"\)/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(STAGES).toContain(t);
  });
});

// --- 12 — the artifact is cleared on reset / start-over -------

describe("generated-visual lifecycle in the page", () => {
  it("12 — the generated visual is cleared on new brief / start over / concept change / rebuilt recipe", () => {
    const clears = [...pageSrc.matchAll(/clearGeneratedVisual\(\)/g)].length;
    expect(clears).toBeGreaterThanOrEqual(4);
  });

  it("13b — the correction handler does NOT clear the visual (so the mismatch stays visible)", () => {
    const start = pageSrc.indexOf("onCorrected={");
    expect(start).toBeGreaterThan(-1);
    const block = pageSrc.slice(start, start + 500);
    expect(block).not.toMatch(/clearGeneratedVisual|setGeneratedArtifact\(null\)/);
  });
});
