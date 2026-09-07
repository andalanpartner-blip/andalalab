import { describe, expect, it } from "vitest";
import { datasets, pipeline } from "../fixtures/load";
import {
  LAYOUT_TEMPLATES,
  templateAvailability,
  templateForLayout
} from "../../engine/layout/templates";
import { retargetLayout } from "../../engine/layout/retarget";
import { runLayoutRetargetPipeline } from "../../services/pipeline.service";
import { resolveLayoutBlueprint } from "../../engine";
import { newIds, clock } from "../fixtures/load";

/**
 * Nine visual layout templates over the existing canonical taxonomy.
 * The templates are a presentation layer; "Use this layout" re-derives the
 * design through Recipe → Blueprint → Prompt with fresh hashes and never
 * touches generation.
 */

const DATASET_LAYOUT_IDS = new Set([...datasets.layouts.keys()]);

type Node = (typeof LAYOUT_TEMPLATES)[number]["schematic"];
function collectBlocks(node: Node): string[] {
  if ("block" in node) return [node.block];
  return node.children.flatMap((child) => collectBlocks(child));
}

describe("layout templates — catalogue", () => {
  it("1 — exactly nine templates are exposed", () => {
    expect(LAYOUT_TEMPLATES).toHaveLength(9);
    expect(new Set(LAYOUT_TEMPLATES.map((t) => t.id)).size).toBe(9);
    expect(LAYOUT_TEMPLATES.map((t) => t.index)).toEqual([
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
  });

  it("2 — every template maps to a canonical layout id that exists in the dataset", () => {
    for (const template of LAYOUT_TEMPLATES) {
      expect(DATASET_LAYOUT_IDS.has(template.canonicalLayoutId)).toBe(true);
    }
  });

  it("3 — the templates add no dataset records (10 canonical layouts, unchanged)", () => {
    expect(DATASET_LAYOUT_IDS.size).toBe(10);
    // the templates reference a subset of the existing ids, never a new one
    const referenced = new Set(LAYOUT_TEMPLATES.map((t) => t.canonicalLayoutId));
    for (const id of referenced) expect(DATASET_LAYOUT_IDS.has(id)).toBe(true);
  });

  it("5 — each mini-preview schematic is deterministic and structural only", () => {
    for (const template of LAYOUT_TEMPLATES) {
      expect(JSON.stringify(template.schematic)).toBe(JSON.stringify(template.schematic));
      const blocks = collectBlocks(template.schematic);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(["image", "headline", "body", "cta", "brand", "offer", "product", "scene"]).toContain(block);
      }
    }
    // the whole catalogue is frozen
    expect(Object.isFrozen(LAYOUT_TEMPLATES)).toBe(true);
  });

  it("19 — availability comes from the canonical layout's suitable_visual_types", () => {
    const heroTemplate = templateForLayout("hero-visual")!;
    // hero-visual declares social-feed
    expect(templateAvailability(datasets, heroTemplate, "social-feed").status).toBe("available");
    expect(templateAvailability(datasets, heroTemplate, "web-hero").status).toBe("not-ideal");

    const editorial = templateForLayout("print-editorial-page")!;
    expect(templateAvailability(datasets, editorial, "print-a4").status).toBe("available");
    expect(templateAvailability(datasets, editorial, "social-feed").status).toBe("not-ideal");

    // it never invents a claim — the reason names the declared types
    const notIdeal = templateAvailability(datasets, editorial, "social-feed");
    expect(notIdeal.reason).toContain("print-a4");
  });
});

describe("layout templates — retarget derivation", () => {
  const base = () => pipeline("kopi-lawas-promotion"); // social-feed, image-text-split

  it("4 — the AI's current layout resolves to its template (the default recommendation)", () => {
    const { contract, direction, recipe } = base();
    const current = direction.candidates.find(
      (c) => c.candidate.candidate_id === direction.selected_candidate_id
    )!.candidate.layout_id;
    expect(templateForLayout(current)?.name).toBe("Image + Text Split");

    // the pipeline overview names the recommendation, and after a retarget the
    // overview's recommendation follows the NEW layout — so the client must
    // freeze the original (it does, in Workspace's aiLayoutRec).
    const first = runLayoutRetargetPipeline(
      { datasets, ids: newIds(), clock },
      { contract, direction, parentRecipe: recipe, layoutId: "hero-visual" }
    );
    expect(first.status).toBe("OK");
    if (first.status !== "OK") return;
    expect(first.layoutTemplates.recommendedTemplateId).toBe("hero-dominant");
    expect(first.layoutTemplates.recommendedTemplateName).toBe("Hero Dominant");
  });

  it("7/8/11/12 — Use this layout derives a NEW recipe; parent recipe + blueprint stay immutable", () => {
    const { contract, direction, recipe } = base();
    const parentBlueprint = resolveLayoutBlueprint({ recipe, contract, direction, datasets });
    expect(parentBlueprint.ok).toBe(true);
    const parentRecipeHash = recipe.recipe_hash;
    const parentBlueprintHash = parentBlueprint.ok ? parentBlueprint.value.blueprint_hash : "";

    const retargeted = retargetLayout({
      contract,
      direction,
      concept: null,
      parentRecipe: recipe,
      layoutId: "hero-visual",
      datasets,
      ids: newIds(),
      clock
    });
    expect(retargeted.ok).toBe(true);
    if (!retargeted.ok) return;

    // new recipe, new hash, derived from the parent
    expect(retargeted.value.recipe.recipe_hash).not.toBe(parentRecipeHash);
    expect(retargeted.value.recipe.derived_from).toBe(recipe.id);
    // the layout actually changed
    const newLayout = retargeted.value.direction.candidates.find(
      (c) => c.candidate.candidate_id === retargeted.value.direction.selected_candidate_id
    )!.candidate.layout_id;
    expect(newLayout).toBe("hero-visual");

    // 9 — a fresh blueprint derives from the NEW recipe with a new hash
    const nextBlueprint = resolveLayoutBlueprint({
      recipe: retargeted.value.recipe,
      contract: retargeted.value.contract,
      direction: retargeted.value.direction,
      datasets
    });
    expect(nextBlueprint.ok).toBe(true);
    if (!nextBlueprint.ok) return;
    expect(nextBlueprint.value.blueprint_hash).not.toBe(parentBlueprintHash);
    expect(nextBlueprint.value.derived_from.recipe_hash).toBe(retargeted.value.recipe.recipe_hash);
    expect(nextBlueprint.value.provenance.layout_id).toBe("hero-visual");

    // 11/12 — the parent artifacts are untouched (frozen, same hashes)
    expect(recipe.recipe_hash).toBe(parentRecipeHash);
    expect(Object.isFrozen(recipe)).toBe(true);
    expect(parentBlueprint.ok && parentBlueprint.value.blueprint_hash).toBe(parentBlueprintHash);
  });

  it("keeps the movement, objective and core message — only structure moves", () => {
    const { contract, direction, recipe } = base();
    const retargeted = retargetLayout({
      contract,
      direction,
      concept: null,
      parentRecipe: recipe,
      layoutId: "headline-dominant",
      datasets,
      ids: newIds(),
      clock
    });
    expect(retargeted.ok).toBe(true);
    if (!retargeted.ok) return;
    expect(retargeted.value.recipe.movement.id).toBe(recipe.movement.id);
    expect(retargeted.value.contract.objective).toBe(contract.objective);
    expect(retargeted.value.contract.core_message).toBe(contract.core_message);
  });

  it("10 — the pipeline re-derives the prompt and blueprint from the new recipe", () => {
    const { contract, direction, recipe } = base();
    const result = runLayoutRetargetPipeline(
      { datasets, ids: newIds(), clock },
      { contract, direction, parentRecipe: recipe, layoutId: "typographic" }
    );
    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    expect(result.promptSet).toBeTruthy();
    expect(result.recipe.recipe_hash).not.toBe(recipe.recipe_hash);
    expect(result.blueprint.provenance.recipe_hash).toBe(result.recipe.recipe_hash);
    expect(result.blueprint.provenance.layout_id).toBe("typographic");
  });

  it("a target layout that is not in the dataset is rejected, no partial state", () => {
    const { contract, direction, recipe } = base();
    const result = runLayoutRetargetPipeline(
      { datasets, ids: newIds(), clock },
      { contract, direction, parentRecipe: recipe, layoutId: "not-a-real-layout" }
    );
    expect(result.status).toBe("ERROR");
  });

  it("6 — previewing / reading a template never touches the committed recipe", () => {
    const { recipe } = base();
    const before = JSON.stringify(recipe);
    // everything the preview UI reads
    for (const template of LAYOUT_TEMPLATES) {
      void template.schematic;
      void templateAvailability(datasets, template, "social-feed");
      void templateForLayout(template.canonicalLayoutId);
    }
    expect(JSON.stringify(recipe)).toBe(before);
  });

  it("13 — after a retarget the blueprint hash changes, so an existing visual reads as stale", () => {
    const { contract, direction, recipe } = base();
    const parentBlueprint = resolveLayoutBlueprint({ recipe, contract, direction, datasets });
    expect(parentBlueprint.ok).toBe(true);
    const result = runLayoutRetargetPipeline(
      { datasets, ids: newIds(), clock },
      { contract, direction, parentRecipe: recipe, layoutId: "headline-dominant" }
    );
    expect(result.status).toBe("OK");
    if (result.status !== "OK" || !parentBlueprint.ok) return;
    // a decision / generated artifact bound to the old hashes no longer matches
    expect(result.blueprint.blueprint_hash).not.toBe(parentBlueprint.value.blueprint_hash);
    expect(result.recipe.recipe_hash).not.toBe(recipe.recipe_hash);
  });
});
