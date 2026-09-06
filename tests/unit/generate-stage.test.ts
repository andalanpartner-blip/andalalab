import { describe, expect, it } from "vitest";
import { clock, datasets, newIds } from "../fixtures/load";
import { blueprintInputs } from "../fixtures/blueprint-inputs";
import { resolveLayoutBlueprint } from "../../engine/blueprint/resolve";
import { STAGE_META, STAGES, deriveStageStates, isReachable, isStageId } from "../../lib/workspace";
import {
  artifactRows,
  canSubmit,
  formatEstimatedCost,
  generationErrorMessage,
  layoutContextLabel,
  nextGenerateState,
  previewRows,
  promptContextLabel,
  provenanceRows
} from "../../lib/generate-view";
import {
  getGenerationDeps,
  previewGeneration,
  runVisualGeneration,
  type GenerationServiceDeps
} from "../../services/generation.service";
import { createFakeVisualGeneration } from "../../adapters/visual-generation/fake";
import { createCostLedger } from "../../services/cost.service";

/**
 * UI/UX-03 — pure logic tests for the Generate stage (Node test strategy, no
 * jsdom). The state machine, the view models and the service preview seam.
 */

const signals = (over = {}) => ({
  briefReady: true,
  clarifying: false,
  conceptSelected: true,
  hasRecipe: true,
  hasReview: false,
  criticVerdict: null as "PASS" | "REVIEW" | "BLOCK" | null,
  ...over
});

function scaffold(name = "kopi-lawas-promotion") {
  const i = blueprintInputs(name);
  const bp = resolveLayoutBlueprint({ recipe: i.recipe, contract: i.contract, direction: i.direction, datasets });
  if (!bp.ok) throw new Error("blueprint");
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

// --- 1 / 2 — stage integration -------------------------------------

describe("generate stage integration", () => {
  it("1 — the generate stage exists and is a real (non-future) stage", () => {
    expect(STAGES).toContain("generate");
    expect(isStageId("generate")).toBe(true);
    expect(STAGE_META.generate.future).toBe(false);
    expect(STAGE_META.generate.index).toBe(7);
    // order: … recipe → layout → prompt → generate → review …
    const order = [...STAGES];
    expect(order.indexOf("generate")).toBe(order.indexOf("prompt") + 1);
    expect(order.indexOf("review")).toBe(order.indexOf("generate") + 1);
  });

  it("2 — generate is locked until a recipe exists, then reachable", () => {
    expect(deriveStageStates(signals({ hasRecipe: false, conceptSelected: false })).generate).toBe("locked");
    expect(isReachable(deriveStageStates(signals()).generate)).toBe(true);
  });
});

// --- state machine (3 / 4 / 5 / 6 / 7) ---------------------------

describe("generate state machine", () => {
  it("starts by previewing, not generating", () => {
    expect(nextGenerateState("previewing", { type: "submit" })).toBe("previewing"); // 3 — no submit before ready
  });

  it("4 — the button only becomes usable after the cost preview resolves", () => {
    expect(canSubmit("previewing")).toBe(false);
    expect(nextGenerateState("previewing", { type: "preview_ok" })).toBe("ready");
    expect(canSubmit("ready")).toBe(true);
  });

  it("5 — a duplicate submit while generating is a no-op", () => {
    expect(nextGenerateState("ready", { type: "submit" })).toBe("generating");
    expect(nextGenerateState("generating", { type: "submit" })).toBe("generating");
    expect(canSubmit("generating")).toBe(false);
  });

  it("6 — a successful artifact transitions to success", () => {
    expect(nextGenerateState("generating", { type: "generate_ok" })).toBe("success");
  });

  it("7 — a failed generation transitions to error, never success", () => {
    expect(nextGenerateState("generating", { type: "generate_error" })).toBe("error");
    // a stray generate_ok not from "generating" is ignored
    expect(nextGenerateState("error", { type: "generate_ok" })).toBe("error");
  });

  it("allows a retry from error or a regenerate from success", () => {
    expect(nextGenerateState("error", { type: "submit" })).toBe("generating");
    expect(nextGenerateState("success", { type: "submit" })).toBe("generating");
  });
});

// --- 8 — error mapping ----------------------------------------

describe("error mapping", () => {
  it("8 — rate_limited maps to the quota message", () => {
    expect(generationErrorMessage("rate_limited")).toMatch(/quota/i);
    expect(generationErrorMessage("authentication_error")).toMatch(/not authorised/i);
    expect(generationErrorMessage("not_configured")).toMatch(/not configured/i);
    expect(generationErrorMessage("content_rejected")).toMatch(/rejected/i);
    expect(generationErrorMessage("timeout")).toMatch(/timed out/i);
  });

  it("falls back for an unknown / missing code without fabricating detail", () => {
    expect(generationErrorMessage(null, "server said nope")).toBe("server said nope");
  });
});

// --- 10 / 11 / 12 — view models read, never recompute ----------

describe("view models are pure reads over the artifacts", () => {
  it("10 — blueprint context is derived from blueprint data", () => {
    const { blueprint } = scaffold();
    const label = layoutContextLabel(blueprint);
    expect(label).toContain(`${blueprint.zones.length} zone`);
    expect(label).toContain(
      blueprint.zones.find((z) => z.id === blueprint.focal.zone)!.label.toLowerCase()
    );
  });

  it("11 / 12 — prompt + preview context are derived from the request, not recomputed", async () => {
    const s = scaffold();
    const deps = fakeDeps();
    const preview = await previewGeneration(deps, { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
    expect(preview.status).toBe("OK");
    if (preview.status !== "OK") return;

    const ctx = promptContextLabel(preview.request);
    expect(ctx).toContain("English");
    expect(ctx.toLowerCase()).toContain(preview.request.config.prompt_tier.replace("-", " "));

    const rows = previewRows(preview.request, preview.estimate);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["Target size"]).toBe(`${preview.request.target.width} × ${preview.request.target.height} px`);
    expect(byLabel["Provider"]).toBe(`${preview.estimate.provider} · ${preview.estimate.model}`);
  });

  it("formats an estimated cost as a rounded ~$ figure, never an invoice claim", async () => {
    const s = scaffold();
    const preview = await previewGeneration(fakeDeps(), {
      recipe: s.recipe,
      contract: s.contract,
      blueprint: s.blueprint
    });
    if (preview.status !== "OK") return;
    expect(formatEstimatedCost(preview.estimate)).toMatch(/^~\$|no estimate/);
  });
});

// --- 3 / 9 — service seam: preview never generates -------------

describe("previewGeneration — cost confirmation without a provider call", () => {
  it("3 — returns the request + estimate and books NO cost event", async () => {
    const s = scaffold();
    const ledger = createCostLedger({ clock });
    const deps: GenerationServiceDeps = {
      datasets,
      ids: newIds(),
      clock,
      generator: createFakeVisualGeneration({ ledger, clock, ids: newIds() })
    };
    const result = await previewGeneration(deps, { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });

    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    expect(result.request.provenance.recipe_hash).toBe(s.recipe.recipe_hash);
    expect(result.request.provenance.blueprint_hash).toBe(s.blueprint.blueprint_hash);
    expect(result.estimate.cost.estimated_cost_usd).toBeGreaterThanOrEqual(0);
    // the whole point: the provider was never called, so no cost event
    expect(ledger.list()).toHaveLength(0);
  });

  it("9 — runVisualGeneration (explicit) preserves provenance + books exactly one cost event", async () => {
    const s = scaffold();
    const ledger = createCostLedger({ clock });
    const deps: GenerationServiceDeps = {
      datasets,
      ids: newIds(),
      clock,
      generator: createFakeVisualGeneration({ ledger, clock, ids: newIds(), deliverImage: true })
    };
    const result = await runVisualGeneration(deps, {
      recipe: s.recipe,
      contract: s.contract,
      blueprint: s.blueprint
    });
    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    expect(result.artifact.provenance).toEqual(result.request.provenance);
    expect(result.artifact.request_hash).toBe(result.request.request_hash);
    expect(ledger.list(s.recipe.project_id)).toHaveLength(1);
    // a rows helper renders it without recomputation
    const rows = artifactRows(result.artifact);
    expect(rows.find((r) => r.label === "Generated size")!.value).toContain(
      String(result.artifact.image.width)
    );
    const prov = provenanceRows(result.artifact);
    expect(prov.find((r) => r.label === "Recipe hash")!.value).toBe(result.artifact.provenance.recipe_hash);
  });

  it("a provider failure surfaces as ERROR with the issue code, never an artifact", async () => {
    const s = scaffold();
    const ledger = createCostLedger({ clock });
    const deps: GenerationServiceDeps = {
      datasets,
      ids: newIds(),
      clock,
      generator: createFakeVisualGeneration({ ledger, clock, ids: newIds(), failWith: "rate_limited" })
    };
    const result = await runVisualGeneration(deps, { recipe: s.recipe, contract: s.contract, blueprint: s.blueprint });
    expect(result.status).toBe("ERROR");
    if (result.status !== "ERROR") return;
    expect(result.issues?.[0]?.code).toBe("rate_limited");
    expect(generationErrorMessage(result.issues?.[0]?.code)).toMatch(/quota/i);
  });
});

// --- boundary: no provider logic in the deps builder path -----

describe("boundaries", () => {
  it("getGenerationDeps honours GENERATION_PROVIDER=fake for offline verification", () => {
    const prev = process.env["GENERATION_PROVIDER"];
    process.env["GENERATION_PROVIDER"] = "fake";
    try {
      const deps = getGenerationDeps();
      expect(typeof deps.generator.generate).toBe("function");
      expect(typeof deps.generator.estimate).toBe("function");
    } finally {
      if (prev === undefined) delete process.env["GENERATION_PROVIDER"];
      else process.env["GENERATION_PROVIDER"] = prev;
    }
  });

  it("the generate view helpers never import the engine or a provider", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../lib/generate-view.ts", import.meta.url), "utf8")
    );
    expect(src).not.toMatch(/from "\.\.\/engine|adapters\/|gemini/);
  });
});
