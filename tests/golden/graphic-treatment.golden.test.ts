import { describe, expect, it } from "vitest";
import { pipeline } from "../fixtures/load";
import { compilePromptSet } from "../../engine/prompt/compile";

/**
 * Golden case for Graphic Treatment (P2.5): an Instagram promotional poster,
 * Food & Beverage, resolved to the Bauhaus movement, for a youth office
 * audience (tests/fixtures/briefs/kopi-lawas-promotion.json) — the same
 * scenario named in the P2.5 spec. The exact selected devices must be stable.
 */

describe("golden: graphic treatment for an Instagram F&B promotional poster", () => {
  it("resolves a small, coordinated moderate-intensity set", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    const gt = recipe.graphic_treatment;

    expect(gt.intensity).toBe("moderate");
    expect(gt.structural_devices.map((d) => d.id)).toEqual(["modular-grid-blocks", "modular-panel"]);
    expect(gt.expressive_devices.map((d) => d.id)).toEqual(["geometric-block-accent"]);
    expect(gt.image_treatments).toHaveLength(0);
    expect(gt.typography_treatments.map((d) => d.id)).toEqual(["oversized-cropped-headline"]);
    expect(gt.textures).toHaveLength(0);
    expect(gt.patterns).toHaveLength(0);
    expect(gt.layering).toHaveLength(0);
    expect(gt.accents).toHaveLength(0);
  });

  it("is byte-identical across repeated pipeline runs", () => {
    const first = pipeline("kopi-lawas-promotion").recipe.graphic_treatment;
    const second = pipeline("kopi-lawas-promotion").recipe.graphic_treatment;
    expect(second).toEqual(first);
  });

  it("every selected device is traceable to movement, industry and objective", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    const all = [
      ...recipe.graphic_treatment.structural_devices,
      ...recipe.graphic_treatment.expressive_devices,
      ...recipe.graphic_treatment.typography_treatments
    ];
    for (const device of all) {
      expect(device.source).toContain("movement:bauhaus");
      expect(device.source).toContain("industry:fnb");
      expect(device.source).toContain("objective:promotion");
    }
  });

  it("appears in the Master Prompt and Design/Layout Prompt as natural-language instruction, not raw ids", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    const en = compilePromptSet({ recipe, language: "en" });

    expect(en.masterPrompt).toContain("Graphic treatment (moderate)");
    expect(en.masterPrompt).toContain(
      "Introduce one controlled geometric block to reinforce the visual hierarchy."
    );
    expect(en.designLayoutPrompt).toContain("Graphic treatment (moderate)");
    for (const device of recipe.graphic_treatment.structural_devices) {
      expect(en.masterPrompt).not.toContain(device.id);
    }
  });

  it("carries the same treatment decision into Bahasa Indonesia, only the wording differs", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    const en = compilePromptSet({ recipe, language: "en" });
    const id = compilePromptSet({ recipe, language: "id" });

    expect(id.masterPrompt).toContain("Perlakuan grafis (moderat)");
    expect(en.masterPrompt).not.toBe(id.masterPrompt);

    const countDevices = (text: string) =>
      recipe.graphic_treatment.structural_devices.filter((d) => text.includes(d.prompt_en)).length;
    expect(countDevices(en.masterPrompt)).toBe(recipe.graphic_treatment.structural_devices.length);
  });

  it("omits typography treatment from the Image-Only Prompt but keeps structural/expressive devices", () => {
    const { recipe } = pipeline("kopi-lawas-promotion");
    const en = compilePromptSet({ recipe, language: "en" });

    expect(en.imageOnlyPrompt).toContain(
      "Introduce one controlled geometric block to reinforce the visual hierarchy."
    );
    expect(en.imageOnlyPrompt).not.toContain(
      "Set the headline at an oversized scale, cropped by the frame edge, as the composition's dominant mass."
    );
  });
});
