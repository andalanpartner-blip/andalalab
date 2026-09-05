import { describe, expect, it } from "vitest";
import {
  buildPromptBlocks,
  compilePromptSet,
  resolveVisualAdapter,
  VISUAL_ADAPTERS,
  VISUAL_ADAPTER_IDS,
  type VisualAdapterId
} from "../../engine";
import { pipeline } from "../fixtures/load";

/**
 * The Visual Generation Adapter (P2.7): an additive, deterministic
 * prompt-rendering layer. It selects one adapter from already-resolved recipe
 * signals and translates a compact per-adapter vocabulary into generation
 * language. It makes NO new design decision.
 */

/** Extract just the Visual Generation paragraph from a compiled prompt. */
function visualGenSection(prompt: string): string {
  return (
    prompt.split("\n\n").find((s) => /^(Visual generation character|Visual medium character|Karakter visual generation|Karakter medium visual)/.test(s)) ??
    ""
  );
}

const PHOTOGRAPHIC_WORDS = [
  "camera",
  "lens",
  "photograph",
  "bokeh",
  "shutter",
  "aperture",
  "depth of field",
  "skin",
  "optical",
  "optik",
  "fotograf",
  "kulit"
];
const CAMERA_WORDS = ["camera", "lens", "shutter", "aperture", "bokeh", "focal length", "kamera"];

describe("resolveVisualAdapter: selection", () => {
  const CASES: { name: string; input: Parameters<typeof resolveVisualAdapter>[0]; expected: VisualAdapterId }[] = [
    { name: "documentary → photorealistic", input: { photographicStyle: "documentary", realismTarget: "photoreal-natural" }, expected: "photorealistic" },
    { name: "fashion-editorial → fashion-editorial", input: { photographicStyle: "fashion-editorial", realismTarget: "photoreal-natural" }, expected: "fashion-editorial" },
    { name: "product-studio → product-photography", input: { photographicStyle: "product-studio", realismTarget: "photoreal-refined" }, expected: "product-photography" },
    { name: "cinematic-natural → cinematic", input: { photographicStyle: "cinematic-natural", realismTarget: "photoreal-natural" }, expected: "cinematic" },
    { name: "graphic-photographic + literal → graphic-poster", input: { photographicStyle: "graphic-photographic", realismTarget: "graphic-non-photographic", abstractionLevel: "literal" }, expected: "graphic-poster" },
    { name: "graphic-photographic + abstract → illustration", input: { photographicStyle: "graphic-photographic", realismTarget: "graphic-non-photographic", abstractionLevel: "abstract" }, expected: "illustration" }
  ];

  it("A — resolves each of the six adapters from a recipe signal", () => {
    const seen = new Set<VisualAdapterId>();
    for (const c of CASES) {
      const got = resolveVisualAdapter(c.input);
      expect(got.adapterId, c.name).toBe(c.expected);
      expect(got.rationale.length).toBeGreaterThan(0);
      expect(got.sourceSignals.length).toBeGreaterThan(0);
      seen.add(got.adapterId);
    }
    expect(seen).toEqual(new Set(VISUAL_ADAPTER_IDS));
  });

  it("B — falls back to photorealistic deterministically for an unrecognised style", () => {
    const bogus = {
      photographicStyle: "some-future-style" as never,
      realismTarget: "photoreal-natural" as never
    };
    const first = resolveVisualAdapter(bogus);
    const second = resolveVisualAdapter(bogus);
    expect(first.adapterId).toBe("photorealistic");
    expect(first).toEqual(second);
    expect(first.sourceSignals.join(" ").toLowerCase()).toMatch(/fallback/);
  });

  it("rationale names the resolved signal that produced the selection (traceable)", () => {
    const r = resolveVisualAdapter({ photographicStyle: "fashion-editorial", realismTarget: "photoreal-natural" });
    expect(r.sourceSignals[0]).toContain("photographic_style");
    expect(r.rationale).toContain("fashion-editorial");
  });
});

describe("adapter vocabulary shape", () => {
  it("every adapter defines exactly the eight phrasing fields, bilingually", () => {
    const fields = [
      "camera_language",
      "lighting_language",
      "surface_or_material_language",
      "realism_language",
      "composition_language",
      "motion_language",
      "rendering_language",
      "avoid_language"
    ] as const;
    for (const id of VISUAL_ADAPTER_IDS) {
      const v = VISUAL_ADAPTERS[id];
      expect(Object.keys(v).sort()).toEqual([...fields].sort());
      for (const f of fields) {
        expect(v[f].en.length, `${id}.${f}.en`).toBeGreaterThan(0);
        expect(v[f].id.length, `${id}.${f}.id`).toBeGreaterThan(0);
      }
    }
  });

  it("E — photorealistic carries believable-photography realism vocabulary", () => {
    const blob = Object.values(VISUAL_ADAPTERS.photorealistic).map((p) => p.en).join(" ").toLowerCase();
    expect(blob).toMatch(/natural|realistic|believable|imperfection/);
  });

  it("F — graphic-poster vocabulary contains no photographic camera / skin / optics language", () => {
    const blob = Object.values(VISUAL_ADAPTERS["graphic-poster"]).map((p) => `${p.en} ${p.id}`).join(" ").toLowerCase();
    for (const w of PHOTOGRAPHIC_WORDS) expect(blob, w).not.toContain(w);
  });

  it("G — illustration vocabulary uses no photographic camera language", () => {
    const blob = Object.values(VISUAL_ADAPTERS.illustration).map((p) => `${p.en} ${p.id}`).join(" ").toLowerCase();
    for (const w of CAMERA_WORDS) expect(blob, w).not.toContain(w);
  });
});

describe("compiler integration", () => {
  const fashionRecipe = pipeline("tokyo-fashion-editorial").recipe;
  const posterRecipe = pipeline("type-led-fashion").recipe; // mixed-media-photographic → graphic-poster
  const photoRecipe = pipeline("hardstone-property-trust").recipe; // documentary → photorealistic

  it("I — deterministic: same recipe, ten compiles, identical output", () => {
    const runs = Array.from({ length: 10 }, () => compilePromptSet({ recipe: fashionRecipe, language: "en" }).masterPrompt);
    expect(new Set(runs).size).toBe(1);
  });

  it("H — selects the identical adapter regardless of prompt language", () => {
    for (const name of ["tokyo-fashion-editorial", "northbeam-saas-launch", "type-led-fashion", "hardstone-property-trust"]) {
      const recipe = pipeline(name).recipe;
      const en = compilePromptSet({ recipe, language: "en" });
      const id = compilePromptSet({ recipe, language: "id" });
      expect(en.visualCharacter.id).toBe(id.visualCharacter.id);
    }
  });

  it("C — changing the adapter changes only the visual-generation block, nothing structural", () => {
    const base = buildPromptBlocks({ recipe: fashionRecipe, concept: null });
    const swapped = buildPromptBlocks({ recipe: fashionRecipe, concept: null, visualAdapter: "graphic-poster" });

    const strip = (b: ReturnType<typeof buildPromptBlocks>) => {
      const { visualGeneration, ...rest } = b;
      void visualGeneration;
      return rest;
    };
    expect(strip(swapped)).toEqual(strip(base));
    expect(swapped.visualGeneration.adapterId).toBe("graphic-poster");
    expect(base.visualGeneration.adapterId).not.toBe("graphic-poster");
  });

  it("D — no adapter override introduces or removes a structural design decision", () => {
    const base = buildPromptBlocks({ recipe: photoRecipe, concept: null });
    const strip = (b: ReturnType<typeof buildPromptBlocks>) => {
      const { visualGeneration, ...rest } = b;
      void visualGeneration;
      return rest;
    };
    for (const id of VISUAL_ADAPTER_IDS) {
      const b = buildPromptBlocks({ recipe: photoRecipe, concept: null, visualAdapter: id });
      expect(strip(b), id).toEqual(strip(base));
    }
  });

  it("E — the compiled photorealistic section reads as believable photography", () => {
    const master = compilePromptSet({ recipe: photoRecipe, language: "en" }).masterPrompt;
    expect(compilePromptSet({ recipe: photoRecipe, language: "en" }).visualCharacter.id).toBe("photorealistic");
    expect(visualGenSection(master).toLowerCase()).toMatch(/natural|believable|realistic/);
  });

  it("F — the compiled graphic-poster section has no photographic vocabulary", () => {
    const en = compilePromptSet({ recipe: posterRecipe, language: "en" });
    const id = compilePromptSet({ recipe: posterRecipe, language: "id" });
    expect(en.visualCharacter.id).toBe("graphic-poster");
    for (const w of PHOTOGRAPHIC_WORDS) {
      expect(visualGenSection(en.masterPrompt).toLowerCase(), `en:${w}`).not.toContain(w);
      expect(visualGenSection(id.masterPrompt).toLowerCase(), `id:${w}`).not.toContain(w);
    }
  });

  it("renders the visual-generation section with the human label, not the raw id", () => {
    for (const name of ["tokyo-fashion-editorial", "type-led-fashion", "northbeam-saas-launch"]) {
      const recipe = pipeline(name).recipe;
      const set = compilePromptSet({ recipe, language: "en" });
      const section = visualGenSection(set.masterPrompt);
      expect(section).toContain(set.visualCharacter.label.split(" · ")[0]!); // the adapter label half
    }
  });

  it("never leaks a hyphenated adapter id token anywhere in a prompt", () => {
    const hyphenated = VISUAL_ADAPTER_IDS.filter((id) => id.includes("-"));
    for (const name of ["tokyo-fashion-editorial", "type-led-fashion", "hardstone-property-trust"]) {
      const recipe = pipeline(name).recipe;
      for (const lang of ["en", "id"] as const) {
        const set = compilePromptSet({ recipe, language: lang });
        for (const prompt of [set.masterPrompt, set.quickPrompt, set.imageOnlyPrompt, set.designLayoutPrompt, set.negativePrompt]) {
          for (const id of hyphenated) {
            expect(prompt, `${name}/${lang}/${id}`).not.toContain(id);
          }
        }
      }
    }
  });

  it("the negative prompt gains one adapter-specific avoidance, not a dump", () => {
    const set = compilePromptSet({ recipe: fashionRecipe, language: "en" });
    const avoid = VISUAL_ADAPTERS[set.visualCharacter.id].avoid_language.en;
    expect(set.negativePrompt).toContain(avoid.replace(/\.$/, ""));
  });

  it("exposes a localised visual-character metadata line, never a raw id", () => {
    const en = compilePromptSet({ recipe: fashionRecipe, language: "en" });
    expect(en.visualCharacter.label).toMatch(/·/);
    expect(en.visualCharacter.label).not.toContain(en.visualCharacter.id);
    expect(en.visualCharacter.description.length).toBeGreaterThan(0);
  });
});
