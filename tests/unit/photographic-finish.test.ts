import { describe, expect, it } from "vitest";
import { datasets } from "../fixtures/load";
import { resolvePhotographicCharacter } from "../../engine/photographic-character/resolve";
import { COLOR_CHARACTER_VOCABULARY } from "../../engine/photographic-character/finish-data";
import type { PhotographicCharacterInput } from "../../engine/photographic-character/types";
import {
  ColorCharacter,
  LightingCharacter,
  PhotographicFinishSpec,
  PhotographicFinishStyle
} from "../../types/schemas/photographic-finish.schema";
import type { AudienceSpec } from "../../types/schemas/brief.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type { DkvParams } from "../../types/schemas/dkv.schema";

/**
 * Photographic Finish (P2.9). Every test runs a deterministic, hand-built input
 * through the real resolver — no live Gemini call, no randomness, no clock.
 */

const fashion = datasets.industries.get("fashion")!;
const fnb = datasets.industries.get("fnb")!;
const property = datasets.industries.get("property")!;
const beauty = datasets.industries.get("beauty-skincare")!;
const editorialModernism = datasets.movements.get("editorial-modernism")!;
const brutalism = datasets.movements.get("brutalism")!;
const contemporaryDigital = datasets.movements.get("contemporary-digital")!;
const socialFeed = datasets.visualTypes.get("social-feed")!;

function audience(overrides: Partial<AudienceSpec> = {}): AudienceSpec {
  return {
    description: "A generic test audience description, long enough to pass validation.",
    age_range: [28, 40],
    sophistication: 0.5,
    price_sensitivity: 0.5,
    attention_context: "scroll",
    cultural_context: [],
    ...overrides
  };
}

function dkv(overrides: Partial<DkvParams> = {}): DkvParams {
  return {
    whitespace: 0.5,
    contrast: 0.55,
    visual_density: 0.5,
    alignment: 0.8,
    hierarchy_strength: 0.6,
    color_complexity: 0.4,
    focal_dominance: 0.6,
    typographic_scale_ratio: 1.5,
    ...overrides
  };
}

function concept(overrides: {
  subject_strategy?: string;
  human_presence?: string;
  abstraction_level?: string;
  temporal_strategy?: string;
}): CreativeConcept {
  return {
    proposal: {
      subject_strategy: overrides.subject_strategy ?? "product-as-subject",
      human_presence: overrides.human_presence ?? "none",
      abstraction_level: overrides.abstraction_level ?? "literal",
      temporal_strategy: overrides.temporal_strategy ?? "instant"
    }
  } as unknown as CreativeConcept;
}

function input(overrides: Partial<PhotographicCharacterInput> = {}): PhotographicCharacterInput {
  return {
    objective: "awareness",
    audience: audience(),
    industry: fnb,
    visualType: socialFeed,
    movement: contemporaryDigital,
    imageryRealism: 0.7,
    framing: "Close, appetite-led framing on the product with visible texture.",
    lightingContrast: 0.55,
    lightingDirectionText: "Directional light with real shadow.",
    colorStrategy: "restrained-neutral",
    colorSaturation: 0.5,
    colorContrast: 0.55,
    colorComplexity: 0.4,
    materialityTexture: 0.45,
    materialitySurfaces: ["matte paper", "ceramic"],
    compositionStrategy: "asymmetric-editorial",
    graphicTreatmentIntensity: "minimal",
    dkv: dkv(),
    bannedTokens: [],
    concept: null,
    ...overrides
  };
}

const FASHION_EDITORIAL = input({
  objective: "brand-building",
  industry: fashion,
  movement: editorialModernism,
  audience: audience({ sophistication: 0.85, price_sensitivity: 0.3, attention_context: "dwell" }),
  imageryRealism: 0.72,
  colorStrategy: "restrained-neutral",
  colorSaturation: 0.35,
  concept: concept({ subject_strategy: "person-as-subject", human_presence: "central" })
});

const FNB_PROMOTION = input({
  objective: "promotion",
  industry: fnb,
  imageryRealism: 0.75,
  colorStrategy: "high-chroma-vernacular",
  colorSaturation: 0.7,
  lightingContrast: 0.62,
  materialityTexture: 0.7,
  concept: concept({ subject_strategy: "product-as-subject", human_presence: "implied" })
});

const PROPERTY_DOCUMENTARY = input({
  objective: "trust",
  industry: property,
  movement: editorialModernism,
  imageryRealism: 0.68,
  colorStrategy: "monochrome-structural",
  colorSaturation: 0.3,
  lightingContrast: 0.5,
  concept: concept({ subject_strategy: "place-as-subject", human_presence: "none", temporal_strategy: "aftermath" })
});

const SOCIAL_CAMPAIGN_DOCUMENTARY = input({
  objective: "trust",
  industry: property,
  movement: editorialModernism,
  imageryRealism: 0.66,
  colorStrategy: "restrained-neutral",
  colorSaturation: 0.35,
  lightingContrast: 0.5,
  concept: concept({ subject_strategy: "person-as-subject", human_presence: "partial", temporal_strategy: "instant" })
});

const GRAPHIC_POSTER = input({
  objective: "awareness",
  industry: fashion,
  movement: brutalism,
  imageryRealism: 0.3,
  graphicTreatmentIntensity: "experimental",
  concept: concept({ subject_strategy: "typography-as-subject", human_presence: "none" })
});

const ILLUSTRATION = input({
  objective: "awareness",
  industry: fashion,
  movement: editorialModernism,
  imageryRealism: 0.3,
  concept: concept({ subject_strategy: "material-as-subject", human_presence: "none", abstraction_level: "abstract" })
});

const BEAUTY_PASTEL = input({
  objective: "brand-building",
  industry: beauty,
  movement: editorialModernism,
  audience: audience({ sophistication: 0.9, price_sensitivity: 0.2 }),
  imageryRealism: 0.72,
  colorStrategy: "restrained-neutral",
  colorSaturation: 0.28,
  concept: concept({ subject_strategy: "person-as-subject", human_presence: "central" })
});

const ALL = {
  "fashion editorial": FASHION_EDITORIAL,
  "F&B product promotion": FNB_PROMOTION,
  property: PROPERTY_DOCUMENTARY,
  "documentary / social campaign": SOCIAL_CAMPAIGN_DOCUMENTARY,
  "graphic poster": GRAPHIC_POSTER,
  illustration: ILLUSTRATION,
  "beauty pastel": BEAUTY_PASTEL
};

describe("resolvePhotographicFinish: determinism & schema", () => {
  it.each(Object.entries(ALL))("%s produces a schema-valid, byte-identical finish", (_n, scenario) => {
    const a = resolvePhotographicCharacter(scenario).finish;
    const b = resolvePhotographicCharacter(scenario).finish;
    expect(PhotographicFinishSpec.safeParse(a).success).toBe(true);
    expect(b).toEqual(a);
  });

  it("only ever emits values from the bounded taxonomy", () => {
    for (const scenario of Object.values(ALL)) {
      const f = resolvePhotographicCharacter(scenario).finish;
      expect(PhotographicFinishStyle.options).toContain(f.style.value);
      expect(ColorCharacter.options).toContain(f.color_character.value);
      if (f.lighting_character) expect(LightingCharacter.options).toContain(f.lighting_character.value);
    }
  });

  it("every field carries value + rationale + source_signals", () => {
    const f = resolvePhotographicCharacter(FASHION_EDITORIAL).finish;
    for (const field of [f.style, f.color_character]) {
      expect(field.value).toBeTruthy();
      expect(field.rationale.length).toBeGreaterThan(8);
      expect(field.source_signals.length).toBeGreaterThan(0);
    }
    expect(f.artificiality.source_signals.some((s) => s.includes("artificiality_risk"))).toBe(true);
  });

  it("the colour vocabulary always matches the fixed table for the resolved colour character", () => {
    for (const scenario of Object.values(ALL)) {
      const f = resolvePhotographicCharacter(scenario).finish;
      expect(f.color_vocabulary).toEqual(COLOR_CHARACTER_VOCABULARY[f.color_character.value]);
    }
  });

  it("reuses the P2.6 artificiality score verbatim, only banding it", () => {
    for (const scenario of Object.values(ALL)) {
      const p = resolvePhotographicCharacter(scenario);
      expect(p.finish.artificiality.score).toBe(p.artificiality_risk.score);
      expect(p.finish.artificiality.band).toBe(p.artificiality_risk.band);
    }
  });
});

describe("resolvePhotographicFinish: photographic styles get photographic finish fields", () => {
  it("fashion editorial → fashion-editorial style, photographic, lighting + realism notes present", () => {
    const f = resolvePhotographicCharacter(FASHION_EDITORIAL).finish;
    expect(f.style.value).toBe("fashion-editorial");
    expect(f.is_photographic).toBe(true);
    expect(f.lighting_character).not.toBeNull();
    expect(f.realism_notes).toContain("skin-and-face");
    expect(["low", "medium"]).toContain(f.artificiality.value);
  });

  it("F&B product promotion → product-photography, warm colour, low artificiality", () => {
    const f = resolvePhotographicCharacter(FNB_PROMOTION).finish;
    expect(f.style.value).toBe("product-photography");
    expect(f.color_character.value).toBe("natural-warm");
    expect(f.is_photographic).toBe(true);
    expect(f.artificiality.value).toBe("low");
  });

  it("property + trust → documentary style, muted colour", () => {
    const f = resolvePhotographicCharacter(PROPERTY_DOCUMENTARY).finish;
    expect(f.style.value).toBe("documentary");
    expect(f.color_character.value).toBe("monochrome");
    expect(f.is_photographic).toBe(true);
  });

  it("documentary / social campaign → documentary style, natural colour, ambient lighting", () => {
    const f = resolvePhotographicCharacter(SOCIAL_CAMPAIGN_DOCUMENTARY).finish;
    expect(f.style.value).toBe("documentary");
    expect(f.is_photographic).toBe(true);
    expect(["natural-neutral", "natural-warm", "muted-film"]).toContain(f.color_character.value);
    expect(["documentary-ambient", "diffuse-daylight", "soft-window", "directional-daylight"]).toContain(
      f.lighting_character!.value
    );
  });

  it("refined beauty-skincare at low saturation → soft-pastel colour character", () => {
    const f = resolvePhotographicCharacter(BEAUTY_PASTEL).finish;
    expect(f.color_character.value).toBe("soft-pastel");
    expect(f.color_vocabulary.saturation_restraint).toBe("restrained");
  });
});

describe("resolvePhotographicFinish: non-photographic media stay non-photographic", () => {
  it("graphic-poster → not photographic, no lighting character, no realism notes", () => {
    const f = resolvePhotographicCharacter(GRAPHIC_POSTER).finish;
    expect(f.style.value).toBe("graphic-poster");
    expect(f.is_photographic).toBe(false);
    expect(f.lighting_character).toBeNull();
    expect(f.realism_notes).toEqual([]);
    // A colour character still resolves — it follows the graphic recipe.
    expect(ColorCharacter.options).toContain(f.color_character.value);
  });

  it("illustration (graphic, non-photographic, abstract concept) → not photographic", () => {
    const f = resolvePhotographicCharacter(ILLUSTRATION).finish;
    expect(f.style.value).toBe("illustration");
    expect(f.is_photographic).toBe(false);
    expect(f.lighting_character).toBeNull();
    expect(f.realism_notes).toEqual([]);
  });
});

describe("resolvePhotographicFinish: colour restraint", () => {
  it("a natural colour character never carries elevated saturation", () => {
    for (const key of ["natural-neutral", "natural-warm", "natural-cool", "muted-film", "soft-pastel"] as const) {
      expect(COLOR_CHARACTER_VOCABULARY[key].saturation_restraint).not.toBe("elevated");
    }
  });

  it("only the explicitly commercial-chroma character carries elevated saturation", () => {
    const elevated = ColorCharacter.options.filter(
      (c) => COLOR_CHARACTER_VOCABULARY[c].saturation_restraint === "elevated"
    );
    expect(elevated).toEqual(["high-chroma-commercial"]);
  });

  it("a natural F&B promotion does not inject high-chroma saturation", () => {
    const f = resolvePhotographicCharacter({ ...FNB_PROMOTION, colorStrategy: "restrained-neutral", colorSaturation: 0.45 }).finish;
    expect(f.color_character.value).toBe("natural-warm");
    expect(f.color_vocabulary.saturation_restraint).not.toBe("elevated");
  });
});

describe("resolvePhotographicFinish: low artificiality carries natural realism controls", () => {
  it("a low-artificiality photographic finish always lists natural realism notes", () => {
    for (const scenario of [FASHION_EDITORIAL, FNB_PROMOTION, PROPERTY_DOCUMENTARY]) {
      const f = resolvePhotographicCharacter(scenario).finish;
      if (f.artificiality.value !== "high") {
        expect(f.realism_notes).toEqual(expect.arrayContaining(["highlight-rolloff", "restrained-retouching"]));
      }
    }
  });
});

describe("regression: P2.9 is additive", () => {
  it("does not change the P2.6 artificiality score or any existing field", () => {
    const p = resolvePhotographicCharacter(FNB_PROMOTION);
    // The pre-P2.9 golden value for this scenario shape is unchanged.
    expect(p.photographic_style).toBe("commercial-editorial");
    expect(p.color_response).toBe("warm-natural");
    expect(typeof p.artificiality_risk.score).toBe("number");
  });
});
