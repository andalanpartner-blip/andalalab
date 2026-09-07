import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { datasets, pipeline, newIds, clock } from "../fixtures/load";
import {
  VISUAL_DIRECTIONS,
  directionById,
  adapterForRecipe,
  visualDirectionOverview
} from "../../engine/direction/directions";
import { retargetDirection } from "../../engine/direction/retarget";
import { runDirectionRetargetPipeline } from "../../services/pipeline.service";
import { resolveLayoutBlueprint, VISUAL_ADAPTER_IDS } from "../../engine";

/**
 * Visual Direction Studio — nine user-facing creative directions over the
 * EXISTING recipe / adapter / photographic-character system. Choosing one
 * re-derives recipe → blueprint → prompt with fresh hashes; it never generates.
 */

const ROOT = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), "utf8");
const ADAPTER_SET = new Set<string>(VISUAL_ADAPTER_IDS);

const base = () => pipeline("home-first-property"); // "Rumah pertama yang terasa seperti tempat pulang."

describe("visual directions — catalogue", () => {
  it("1 — exactly nine user-facing directions", () => {
    expect(VISUAL_DIRECTIONS).toHaveLength(9);
    expect(VISUAL_DIRECTIONS.map((d) => d.index)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09"
    ]);
    expect(new Set(VISUAL_DIRECTIONS.map((d) => d.id)).size).toBe(9);
    expect(Object.isFrozen(VISUAL_DIRECTIONS)).toBe(true);
  });

  it("2 — every direction maps only to real internal capabilities", () => {
    for (const direction of VISUAL_DIRECTIONS) {
      // expected adapters are all real adapter ids
      for (const id of direction.expectedAdapters) expect(ADAPTER_SET.has(id)).toBe(true);
      // overrides are legal Ratio values (the same channel P6 corrections use)
      for (const value of Object.values(direction.overrides)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(["photographic", "graphic", "illustration", "typographic"]).toContain(direction.representation);
    }
  });

  it("3 — the directions add no dataset records", () => {
    // no new countries / industries / movements / visual types / layouts
    expect(datasets.countries.size).toBe(4);
    expect(datasets.industries.size).toBe(9);
    expect(datasets.movements.size).toBe(6);
    expect(datasets.visualTypes.size).toBe(6);
    expect(datasets.layouts.size).toBe(10);
    // the module references no dataset id at all — it's pure recipe-bias config
    expect(read("engine/direction/directions.ts")).not.toMatch(/datasets\.(countries|industries|movements|visualTypes|layouts)\.get/);
  });

  it("4/5 — the AI recommends one direction and it is derived from the resolved recipe", () => {
    const { recipe } = base();
    const overview = visualDirectionOverview(datasets, recipe, null);
    expect(directionById(overview.recommendedDirectionId)).not.toBeNull();
    expect(overview.recommendedDirectionName).toBe(directionById(overview.recommendedDirectionId)!.name);
    // the "why" names the adapter the existing resolver produced — not invented
    expect(overview.why).toContain(overview.currentAdapterId.replace("-", " "));
    // deterministic
    expect(visualDirectionOverview(datasets, recipe, null).recommendedDirectionId).toBe(overview.recommendedDirectionId);
  });

  it("27 — the vector direction never claims an editable SVG", () => {
    const vector = directionById("vector-illustration")!;
    const text = `${vector.name} ${vector.description} ${vector.internalMapping}`.toLowerCase();
    expect(text).not.toMatch(/editable svg|editable vector|true vector|\.svg\b/);
    expect(text).toMatch(/aesthetic|illustrat/);
    // it is explicit that the output stays a raster image
    expect(vector.description.toLowerCase()).toMatch(/raster|aesthetic/);
  });
});

describe("visual directions — retarget derivation", () => {
  it("10/11/15/16 — Use this direction derives a NEW recipe; parent stays immutable", () => {
    const { contract, direction, recipe } = base();
    const parentBlueprint = resolveLayoutBlueprint({ recipe, contract, direction, datasets });
    expect(parentBlueprint.ok).toBe(true);
    const parentRecipeHash = recipe.recipe_hash;

    const out = retargetDirection({
      contract,
      direction,
      concept: null,
      parentRecipe: recipe,
      directionId: "graphic-poster",
      datasets,
      ids: newIds(),
      clock
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    expect(out.value.recipe.recipe_hash).not.toBe(parentRecipeHash);
    expect(out.value.recipe.derived_from).toBe(recipe.id);
    // parent untouched
    expect(recipe.recipe_hash).toBe(parentRecipeHash);
    expect(Object.isFrozen(recipe)).toBe(true);
    if (parentBlueprint.ok) expect(Object.isFrozen(parentBlueprint.value)).toBe(true);
  });

  it("24/25/26 — representation is valid, subject strategy + human presence are untouched", () => {
    const { contract, direction, recipe } = base();
    for (const target of ["editorial-photography", "graphic-poster", "typography-first"]) {
      const out = retargetDirection({
        contract,
        direction,
        concept: null,
        parentRecipe: recipe,
        directionId: target,
        datasets,
        ids: newIds(),
        clock
      });
      expect(out.ok).toBe(true);
      if (!out.ok) continue;
      const adapter = adapterForRecipe(out.value.recipe, null);
      expect(ADAPTER_SET.has(adapter)).toBe(true);
      // the direction never forces a human subject or rewrites the concept ref
      expect(out.value.recipe.concept_ref).toBe(recipe.concept_ref);
      expect(out.value.recipe.imagery.subject_treatment).toBe(recipe.imagery.subject_treatment);
    }
  });

  it("12/13/14/23 — the pipeline re-derives blueprint + prompt; hashes move; a visual reads stale", () => {
    const { contract, direction, recipe } = base();
    const parentBlueprint = resolveLayoutBlueprint({ recipe, contract, direction, datasets });
    expect(parentBlueprint.ok).toBe(true);

    const result = runDirectionRetargetPipeline(
      { datasets, ids: newIds(), clock },
      { contract, direction, parentRecipe: recipe, directionId: "graphic-poster" }
    );
    expect(result.status).toBe("OK");
    if (result.status !== "OK" || !parentBlueprint.ok) return;

    expect(result.recipe.recipe_hash).not.toBe(recipe.recipe_hash);
    expect(result.blueprint.blueprint_hash).not.toBe(parentBlueprint.value.blueprint_hash);
    expect(result.blueprint.derived_from.recipe_hash).toBe(result.recipe.recipe_hash);
    expect(result.promptSet).toBeTruthy();
    // recommendation now follows the applied direction
    expect(result.visualDirections.recommendedDirectionId).toBe("graphic-poster");
  });

  it("30 — provenance stays valid: derived_from chain + linked ids", () => {
    const { contract, direction, recipe } = base();
    const result = runDirectionRetargetPipeline(
      { datasets, ids: newIds(), clock },
      { contract, direction, parentRecipe: recipe, directionId: "quiet-luxury" }
    );
    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    expect(result.recipe.derived_from).toBe(recipe.id);
    expect(result.recipe.contract_id).toBe(contract.id);
    expect(result.recipe.direction_id).toBe(direction.id);
    expect(result.blueprint.provenance.recipe_hash).toBe(result.recipe.recipe_hash);
  });
});

describe("visual directions — property acceptance test", () => {
  // "Rumah pertama yang terasa seperti tempat pulang." — A / B / C explicit choices.
  const applied = (directionId: string) => {
    const { contract, direction, recipe } = base();
    const result = runDirectionRetargetPipeline(
      { datasets, ids: newIds(), clock },
      { contract, direction, parentRecipe: recipe, directionId }
    );
    if (result.status !== "OK") throw new Error(`${directionId}: ${result.message}`);
    return result;
  };

  it("A/B/C produce materially different downstream directions; concept + message stay coherent", () => {
    const a = applied("editorial-photography");
    const b = applied("graphic-poster");
    const c = applied("typography-first");

    // three different recipes
    const hashes = new Set([a.recipe.recipe_hash, b.recipe.recipe_hash, c.recipe.recipe_hash]);
    expect(hashes.size).toBe(3);

    // A is photographic; B and C are graphic (no camera vocabulary)
    const adapterA = adapterForRecipe(a.recipe, null);
    const adapterB = adapterForRecipe(b.recipe, null);
    const adapterC = adapterForRecipe(c.recipe, null);
    expect(["photorealistic", "fashion-editorial", "product-photography", "cinematic", "documentary"]).toContain(adapterA);
    expect(["graphic-poster", "illustration"]).toContain(adapterB);
    expect(["graphic-poster", "illustration"]).toContain(adapterC);

    // 28/29 — the graphic + typographic prompts carry no photographic camera
    // INSTRUCTION. (The shared "Avoid: … synthetic bokeh …" negative line is a
    // negative, not an instruction — it is stripped before the check.)
    const positivePrompt = (r: typeof a) =>
      r.promptSet.masterPrompt
        .split("\n\n")
        .filter((section) => !section.startsWith("Avoid:") && !section.startsWith("Negative"))
        .join("\n\n")
        .toLowerCase();
    for (const graphic of [b, c]) {
      expect(positivePrompt(graphic)).not.toMatch(/\bcamera\b|\blens\b|\bbokeh\b|depth of field|skin texture/);
    }
    // the photographic one DOES describe optical / photographic behaviour
    expect(positivePrompt(a)).toMatch(/\bcamera\b|photographic|optical/);

    // B vs C still differ (ornament / saturation emphasis)
    expect(b.recipe.graphic_language.ornament).not.toBe(c.recipe.graphic_language.ornament);
    expect(b.recipe.recipe_hash).not.toBe(c.recipe.recipe_hash);

    // the creative concept / core message is NOT discarded
    for (const r of [a, b, c]) {
      expect(r.recipe.core_message).toBe(base().recipe.core_message);
      expect(r.recipe.concept_ref).toBe(base().recipe.concept_ref);
      expect(r.recipe.movement.id).toBe(base().recipe.movement.id);
    }
  });
});

describe("visual directions — safety (source scans)", () => {
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const forbidden = [
    /generation\.service|runVisualGeneration/,
    /vision-loop\.service|inspectGeneratedVisual|evidence\.service/,
    /applyCorrection|runCorrectionPipeline/,
    /CreativeDecision|\bapprove\b/,
    /gemini|GEMINI_API_KEY/i
  ];

  it("19/20/21/22 — the retarget engine + route generate / critique / correct / approve nothing", () => {
    for (const rel of ["engine/direction/retarget.ts", "app/api/direction/route.ts"]) {
      const src = stripComments(read(rel));
      for (const pattern of forbidden) expect(src).not.toMatch(pattern);
    }
    expect(stripComments(read("engine/direction/retarget.ts"))).toMatch(/buildDesignRecipe/);
  });

  it("6/7/8/9 — preview reads config only; it never calls the retarget", () => {
    // the component's preview path renders schematic + description; the apply
    // path is the only caller of /api/direction
    const ui = read("components/workspace/VisualDirectionStudio.tsx");
    expect(ui).toMatch(/Previewing/);
    expect(ui).toMatch(/\/api\/direction/);
    // exactly one fetch call site
    expect((ui.match(/fetch\("\/api\/direction"/g) ?? []).length).toBe(1);
  });

  it("17/18 — a non-recommended choice is recorded in the existing Decision Ledger", () => {
    const ledger = read("components/DecisionLedger.tsx");
    expect(ledger).toMatch(/directionOverride/);
    expect(ledger).toMatch(/VISUAL DIRECTION/i);
    const ws = read("components/workspace/Workspace.tsx");
    expect(ws).toMatch(/setDirectionOverride\(\{/);
    expect(ws).toMatch(/<DecisionLedger[\s\S]*?directionOverride=\{directionOverride\}/);
  });
});
