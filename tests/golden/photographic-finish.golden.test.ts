import { describe, expect, it } from "vitest";
import { pipeline } from "../fixtures/load";
import { compilePromptSet } from "../../engine/prompt/compile";
import { PhotographicFinishSpec } from "../../types/schemas/photographic-finish.schema";

/**
 * Golden cases for Photographic Finish (P2.9). Runs the real pipeline (no LLM)
 * for the six required scenarios and checks the resolved finish plus its
 * appearance in the compiled prompts, in both languages.
 */

/** Camera / lens / skin / bokeh vocabulary that must never reach a non-photographic finish. */
const PHOTO_WORDS = ["camera", "lens", "bokeh", "shutter", "aperture", "depth of field", " skin", "optical", "optik", "kamera", "kulit", "fotograf"];

/** Extract the P2.9 finish paragraph from a compiled prompt. */
function finishSection(prompt: string): string {
  return (
    prompt
      .split("\n\n")
      .find((s) => /^(Photographic finish|Colour finish|Finish fotografis|Finish warna)/.test(s)) ?? ""
  );
}

const CASES = {
  "fashion editorial": "tokyo-fashion-editorial",
  "F&B product promotion": "kopi-lawas-promotion",
  // hardstone is a property feed post resolved to the documentary finish family —
  // it stands for both "property" and "documentary / social campaign".
  "property / documentary social campaign": "hardstone-property-trust",
  "cinematic hospitality": "cascade-house-hospitality",
  "graphic poster": "type-led-fashion"
} as const;

describe("golden: photographic finish resolves for every scenario", () => {
  it.each(Object.entries(CASES))("%s → schema-valid, deterministic finish", (_n, fixture) => {
    const a = pipeline(fixture).recipe.photographic_character.finish;
    const b = pipeline(fixture).recipe.photographic_character.finish;
    expect(PhotographicFinishSpec.safeParse(a).success).toBe(true);
    expect(b).toEqual(a);
  });
});

describe("golden: photographic styles receive photographic finish fields", () => {
  it("fashion editorial", () => {
    const f = pipeline("tokyo-fashion-editorial").recipe.photographic_character.finish;
    expect(f.style.value).toBe("fashion-editorial");
    expect(f.is_photographic).toBe(true);
    expect(f.lighting_character).not.toBeNull();
    expect(["low", "medium"]).toContain(f.artificiality.value);
  });

  it("F&B product promotion → warm, natural colour, low artificiality, no skin note (no human)", () => {
    const f = pipeline("kopi-lawas-promotion").recipe.photographic_character.finish;
    expect(f.style.value).toBe("product-photography");
    expect(f.color_character.value).toBe("natural-warm");
    expect(f.artificiality.value).toBe("low");
    expect(f.realism_notes).not.toContain("skin-and-face");
    expect(f.realism_notes).toContain("highlight-rolloff");
  });

  it("property feed post → documentary finish family, natural/muted colour", () => {
    const f = pipeline("hardstone-property-trust").recipe.photographic_character.finish;
    expect(f.style.value).toBe("documentary");
    expect(f.is_photographic).toBe(true);
    expect(["muted-film", "natural-neutral", "natural-cool", "monochrome"]).toContain(
      f.color_character.value
    );
    expect(f.lighting_character).not.toBeNull();
  });

  it("cinematic hospitality → photographic, lighting + realism notes present", () => {
    const f = pipeline("cascade-house-hospitality").recipe.photographic_character.finish;
    expect(f.is_photographic).toBe(true);
    expect(f.lighting_character).not.toBeNull();
    expect(f.realism_notes.length).toBeGreaterThan(0);
  });
});

describe("golden: non-photographic media stay non-photographic", () => {
  it("graphic poster → not photographic, no lighting character, no realism notes", () => {
    const f = pipeline("type-led-fashion").recipe.photographic_character.finish;
    expect(f.style.value).toBe("graphic-poster");
    expect(f.is_photographic).toBe(false);
    expect(f.lighting_character).toBeNull();
    expect(f.realism_notes).toEqual([]);
  });

  it("the compiled graphic-poster finish section carries NO camera / lens / skin / bokeh vocabulary", () => {
    for (const lang of ["en", "id"] as const) {
      const set = compilePromptSet({ recipe: pipeline("type-led-fashion").recipe, language: lang });
      for (const prompt of [set.masterPrompt, set.imageOnlyPrompt, set.designLayoutPrompt]) {
        const section = finishSection(prompt).toLowerCase();
        expect(section.length).toBeGreaterThan(0);
        for (const w of PHOTO_WORDS) {
          expect(section, `${lang}:${w}`).not.toContain(w);
        }
      }
    }
  });

  it("the compiled photographic finish section DOES read as photographic", () => {
    const section = finishSection(
      compilePromptSet({ recipe: pipeline("kopi-lawas-promotion").recipe, language: "en" }).masterPrompt
    );
    expect(section.toLowerCase()).toMatch(/photographic finish/);
    expect(section.toLowerCase()).toMatch(/colour character/);
    expect(section.toLowerCase()).toMatch(/artificiality/);
  });
});

describe("golden: English and Indonesian preserve identical resolved values", () => {
  it.each(Object.values(CASES))("%s — recipe finish is language-independent", (fixture) => {
    const recipe = pipeline(fixture).recipe;
    const en = compilePromptSet({ recipe, language: "en" });
    const id = compilePromptSet({ recipe, language: "id" });
    // The resolved finish lives on the recipe, not the prompt.
    const f = recipe.photographic_character.finish;
    expect(PhotographicFinishSpec.safeParse(f).success).toBe(true);
    // Both prompts render a finish section, and they differ in wording.
    expect(finishSection(en.masterPrompt).length).toBeGreaterThan(0);
    expect(finishSection(id.masterPrompt).length).toBeGreaterThan(0);
    expect(finishSection(en.masterPrompt)).not.toBe(finishSection(id.masterPrompt));
  });

  it("the finish section names the same style token concept in both languages", () => {
    const recipe = pipeline("kopi-lawas-promotion").recipe;
    const en = finishSection(compilePromptSet({ recipe, language: "en" }).masterPrompt);
    const id = finishSection(compilePromptSet({ recipe, language: "id" }).masterPrompt);
    expect(en).toContain("product photography");
    expect(id).toContain("fotografi produk");
  });
});

describe("regression: P2.9 is additive", () => {
  it("does not mutate the recipe's immutable anchors", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    const byKind = Object.fromEntries(recipe.anchors.map((a) => [a.kind, a]));
    expect(byKind.objective?.status).toBe("locked");
    expect(byKind.primary_visual_direction?.status).toBe("locked");
  });

  it("keeps the recipe reproducible: same inputs, same recipe_hash", () => {
    expect(pipeline("kopi-lawas-promotion").recipe.recipe_hash).toBe(
      pipeline("kopi-lawas-promotion").recipe.recipe_hash
    );
  });

  it("leaves the P2.6 photographic_character decision and artificiality score untouched", () => {
    const p = pipeline("kopi-lawas-promotion").recipe.photographic_character;
    expect(p.photographic_style).toBe("commercial-editorial");
    expect(p.color_response).toBe("warm-natural");
    expect(p.artificiality_risk.score).toBe(27);
    expect(p.finish.artificiality.score).toBe(27);
  });
});
