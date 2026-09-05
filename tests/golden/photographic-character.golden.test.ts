import { describe, expect, it } from "vitest";
import { pipeline } from "../fixtures/load";
import { compilePromptSet } from "../../engine/prompt/compile";
import { PhotographicCharacterSpec } from "../../types/schemas/photographic-character.schema";

/**
 * Golden cases for Photographic Character (P2.6). The three named scenarios
 * from the spec — an Instagram F&B promotional poster, a Tokyo fashion feed
 * post, and a North-American SaaS launch — plus the prompt rendering and
 * regression checks. Every scenario runs through the real pipeline with no
 * LLM call.
 */

describe("golden: photographic character for an Instagram F&B promotional poster", () => {
  it("resolves a stable commercial-editorial optical profile", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    const p = recipe.photographic_character;

    expect(p.photographic_style).toBe("commercial-editorial");
    expect(p.realism_target).toBe("photoreal-refined");
    expect(p.camera_language).toBe("full-frame-editorial");
    expect(p.lens_character).toBe("100mm-macro-product");
    expect(p.depth_of_field).toBe("selective-focus");
    expect(p.focus_behavior).toBe("plane-of-focus-selective");
    expect(p.lighting_behavior).toBe("soft-directional");
    expect(p.color_response).toBe("warm-natural");
    expect(p.white_balance).toBe("warm-ambient");
    expect(p.dynamic_range).toBe("extended");
    expect(p.skin_realism).toBe("not-applicable");
    expect(p.hand_realism).toBe("detailed-naturalistic");
    expect(p.material_realism).toBe("detailed-naturalistic");
    expect(p.imperfection_level).toBe("subtle");
    expect(p.artificiality_risk.score).toBe(27);
    expect(p.artificiality_risk.band).toBe("moderate");
  });

  it("is byte-identical across repeated pipeline runs", () => {
    const first = pipeline("kopi-lawas-promotion").recipe.photographic_character;
    const second = pipeline("kopi-lawas-promotion").recipe.photographic_character;
    expect(second).toEqual(first);
  });

  it("is schema-valid and traceable to industry, objective and visual type", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    const p = recipe.photographic_character;
    expect(PhotographicCharacterSpec.safeParse(p).success).toBe(true);
    expect(p.source).toContain("industry:fnb");
    expect(p.source).toContain("objective:promotion");
    expect(p.source).toContain("visual_type:social-feed");
  });
});

describe("golden: photographic character for a Tokyo fashion feed post", () => {
  it("resolves a fashion-editorial portrait profile with detailed human realism", () => {
    const { recipe } = pipeline("tokyo-fashion-editorial");
    const p = recipe.photographic_character;

    expect(p.photographic_style).toBe("fashion-editorial");
    expect(p.camera_language).toBe("full-frame-editorial");
    expect(p.lens_character).toBe("85mm-portrait-compression");
    expect(p.depth_of_field).toBe("shallow-optical");
    expect(p.skin_realism).toBe("detailed-naturalistic");
    expect(p.face_realism).toBe("detailed-naturalistic");
    expect(p.hair_realism).toBe("detailed-naturalistic");
    expect(p.fabric_realism).toBe("detailed-naturalistic");
    expect(p.imperfection_level).toBe("natural");
    // Editorial, but NOT forced to high-contrast dynamic range (spec §12).
    expect(p.dynamic_range).not.toBe("high-contrast");
  });

  it("carries the people realism doctrine because a human figure is in frame", () => {
    const { recipe } = pipeline("tokyo-fashion-editorial");
    const avoid = recipe.photographic_character.constraints
      .filter((c) => c.kind === "avoid")
      .map((c) => c.statement)
      .join(" ");
    expect(avoid).toMatch(/plastic or wax-like skin/i);
    expect(avoid).toMatch(/perfect facial symmetry/i);
  });
});

describe("golden: photographic character for a SaaS launch", () => {
  it("resolves a controlled product-studio profile with deep focus and restrained range", () => {
    const { recipe } = pipeline("northbeam-saas-launch");
    const p = recipe.photographic_character;

    expect(p.photographic_style).toBe("product-studio");
    expect(p.camera_language).toBe("studio-commercial");
    expect(p.depth_of_field).toBe("deep-natural");
    expect(p.lighting_behavior).toBe("controlled-studio");
    expect(p.color_response).toBe("restrained-commercial");
    expect(p.dynamic_range).toBe("restrained");
    expect(p.skin_realism).toBe("not-applicable");
    // The people realism block must NOT appear when there is no human subject.
    const statements = p.constraints.map((c) => c.statement).join(" ");
    expect(statements).not.toMatch(/facial asymmetry/i);
  });
});

describe("golden: photographic character in the compiled prompts", () => {
  it("appears in the Master Prompt as natural-language instruction, not raw enum ids", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    const en = compilePromptSet({ recipe, language: "en" });

    expect(en.masterPrompt).toContain("Photographic character: render believable commercial editorial photography");
    expect(en.masterPrompt).toContain("100mm macro product perspective");
    expect(en.masterPrompt).not.toContain("commercial-editorial");
    expect(en.masterPrompt).not.toContain("100mm-macro-product");
    // No generic filler (spec §14).
    expect(en.masterPrompt.toLowerCase()).not.toContain("8k");
    expect(en.masterPrompt.toLowerCase()).not.toContain("masterpiece");
    expect(en.masterPrompt.toLowerCase()).not.toContain("award-winning");
  });

  it("puts the full photographic spec in the Image-Only Prompt (the image-generation stage)", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    const en = compilePromptSet({ recipe, language: "en" });

    expect(en.imageOnlyPrompt).toContain("Photographic character: render believable");
    expect(en.imageOnlyPrompt).toMatch(/Camera: .*camera response with/);
    expect(en.imageOnlyPrompt).toMatch(/Light: .*from a three-quarter angle/);
    expect(en.imageOnlyPrompt).toMatch(/Realism: /);
  });

  it("keeps the Design/Layout Prompt to a brief reference only", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    const en = compilePromptSet({ recipe, language: "en" });

    const marker = "Photographic character: believable";
    expect(en.designLayoutPrompt).toContain(marker);
    const section = en.designLayoutPrompt.slice(
      en.designLayoutPrompt.indexOf(marker),
      en.designLayoutPrompt.indexOf("\n\n", en.designLayoutPrompt.indexOf(marker))
    );
    // One sentence, not the full multi-line spec.
    expect(section.split("\n")).toHaveLength(1);
    expect(en.designLayoutPrompt).not.toMatch(/Camera: .*camera response with/);
  });

  it("adds exactly one compact deterministic realism block to the Negative Prompt (spec §18)", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    const en = compilePromptSet({ recipe, language: "en" });
    const block =
      "plastic skin, artificial facial symmetry, wax-like surfaces, synthetic eyes, impossible hands, CGI-like material response, fake reflections, excessive HDR, over-sharpening, synthetic bokeh, inconsistent lighting, orange skin, excessive saturation, impossible perspective, cloned objects, and overly perfect repetition";
    expect(en.negativePrompt).toContain(block);
    expect(en.negativePrompt.split(block)).toHaveLength(2); // exactly once
  });

  it("carries the same resolved decision into Bahasa Indonesia — only the wording differs", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    const en = compilePromptSet({ recipe, language: "en" });
    const id = compilePromptSet({ recipe, language: "id" });

    // Resolved values are identical (they live on the recipe, not the prompt).
    expect(recipe.photographic_character.photographic_style).toBe("commercial-editorial");

    expect(id.masterPrompt).toContain("Karakter fotografis: render fotografi editorial komersial");
    expect(id.masterPrompt).toContain("perspektif makro produk 100mm");
    expect(id.masterPrompt).not.toContain("commercial-editorial");
    expect(en.masterPrompt).not.toBe(id.masterPrompt);
    expect(id.negativePrompt).toContain("kulit seperti plastik, simetri wajah yang artifisial");
  });

  it("language choice never changes the resolved photographic_character values", () => {
    const a = pipeline("kopi-lawas-promotion").recipe.photographic_character;
    const b = pipeline("kopi-lawas-promotion").recipe.photographic_character;
    compilePromptSet({ recipe: pipeline("kopi-lawas-promotion").recipe, language: "en" });
    compilePromptSet({ recipe: pipeline("kopi-lawas-promotion").recipe, language: "id" });
    expect(a).toEqual(b);
  });
});

describe("regression: P2.6 is additive", () => {
  it("does not mutate the recipe's immutable anchors", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    const byKind = Object.fromEntries(recipe.anchors.map((a) => [a.kind, a]));
    expect(byKind.objective?.status).toBe("locked");
    expect(byKind.core_message?.status).toBe("locked");
    expect(byKind.primary_visual_direction?.status).toBe("locked");
  });

  it("keeps the recipe reproducible: same inputs, same recipe_hash", () => {
    const first = pipeline("kopi-lawas-promotion").recipe;
    const second = pipeline("kopi-lawas-promotion").recipe;
    expect(second.recipe_hash).toBe(first.recipe_hash);
  });

  it("leaves the existing graphic_treatment decision untouched", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    // The P2.5 golden decision still holds.
    expect(recipe.graphic_treatment.intensity).toBe("moderate");
    expect(recipe.graphic_treatment.structural_devices.map((d) => d.id)).toEqual([
      "modular-grid-blocks",
      "modular-panel"
    ]);
  });
});
