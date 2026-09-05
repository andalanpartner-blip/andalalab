import { describe, expect, it } from "vitest";
import { pipeline } from "../fixtures/load";
import { buildPromptBlocks, compilePromptSet, type VisualAdapterId } from "../../engine";

/**
 * Golden: one Design Recipe, three visual-generation adapters. The structural
 * recipe values (grid, hierarchy, colour numbers, typography, composition,
 * culture, constraints) must be byte-identical across all three; only the
 * rendering-language layer changes.
 */

const MEDIA: readonly VisualAdapterId[] = ["photorealistic", "fashion-editorial", "graphic-poster"];

function stripVisualGeneration(blocks: ReturnType<typeof buildPromptBlocks>) {
  const { visualGeneration, ...rest } = blocks;
  void visualGeneration;
  return rest;
}

describe("golden: recipe → visual adapter resolution → PromptSet", () => {
  const recipe = pipeline("tokyo-fashion-editorial").recipe;

  it("keeps every structural block identical across the three adapters", () => {
    const [base, ...others] = MEDIA.map((m) => buildPromptBlocks({ recipe, concept: null, visualAdapter: m }));
    for (const other of others) {
      expect(stripVisualGeneration(other)).toEqual(stripVisualGeneration(base!));
    }
  });

  it("changes only the rendering-language layer", () => {
    const renders = MEDIA.map((m) => buildPromptBlocks({ recipe, concept: null, visualAdapter: m }).visualGeneration.rendering);
    expect(renders[0]).not.toEqual(renders[1]);
    expect(renders[1]).not.toEqual(renders[2]);
    expect(renders[0]).not.toEqual(renders[2]);
  });

  it("preserves the resolved grid and palette verbatim in every compiled master prompt", () => {
    const gridToken = `${recipe.grid.columns}x${recipe.grid.rows}`;
    for (const m of MEDIA) {
      const set = compilePromptSet({ recipe, visualAdapter: m, language: "en" });
      expect(set.masterPrompt).toContain(gridToken);
      for (const swatch of recipe.color.brand_palette) {
        expect(set.masterPrompt).toContain(swatch.hex);
      }
    }
  });

  it("surfaces a distinct, human-facing visual-character line per adapter", () => {
    const labels = MEDIA.map((m) => compilePromptSet({ recipe, visualAdapter: m, language: "en" }).visualCharacter.label);
    expect(new Set(labels).size).toBe(MEDIA.length);
    expect(labels.some((l) => l.startsWith("Photorealistic"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Fashion Editorial"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Graphic Poster"))).toBe(true);
  });

  it("resolves the same adapter in English and Bahasa Indonesia", () => {
    const en = compilePromptSet({ recipe, language: "en" });
    const id = compilePromptSet({ recipe, language: "id" });
    expect(en.visualCharacter.id).toBe(id.visualCharacter.id);
    expect(en.masterPrompt).not.toBe(id.masterPrompt);
  });
});
