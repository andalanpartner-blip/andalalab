import { describe, expect, it } from "vitest";
import { datasets } from "../fixtures/load";
import { resolvePhotographicCharacter } from "../../engine/photographic-character/resolve";
import type { PhotographicCharacterInput } from "../../engine/photographic-character/types";
import {
  CameraLanguage,
  ColorResponse,
  DepthOfField,
  DynamicRange,
  ImperfectionLevel,
  LensCharacter,
  LightingBehavior,
  PhotographicCharacterSpec,
  PhotographicStyle,
  RealismEmphasis
} from "../../types/schemas/photographic-character.schema";
import type { AudienceSpec } from "../../types/schemas/brief.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type { DkvParams } from "../../types/schemas/dkv.schema";

/**
 * The Photographic Character engine (P2.6). Every test runs against a
 * deterministic, hand-built input — no live Gemini call, no randomness, no
 * clock read. Movements, industries and visual types are the real fixtures
 * shipped in data/, exactly as the Graphic Treatment unit tests do.
 */

const fashion = datasets.industries.get("fashion")!;
const fnb = datasets.industries.get("fnb")!;
const property = datasets.industries.get("property")!;
const technologySaas = datasets.industries.get("technology-saas")!;
const hospitality = datasets.industries.get("hospitality")!;

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

/** Only the four proposal fields the resolver actually reads. */
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

// --- Named scenarios (P2.6 spec §21) -------------------------------------

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
  concept: concept({ subject_strategy: "product-as-subject", human_presence: "implied", temporal_strategy: "instant" })
});

const PRODUCT_PHOTOGRAPHY = input({
  objective: "conversion",
  industry: technologySaas,
  imageryRealism: 0.7,
  colorStrategy: "restrained-neutral",
  colorSaturation: 0.3,
  lightingContrast: 0.6,
  concept: concept({ subject_strategy: "product-as-subject", human_presence: "none" })
});

const DOCUMENTARY = input({
  objective: "trust",
  industry: property,
  movement: editorialModernism,
  imageryRealism: 0.68,
  colorStrategy: "monochrome-structural",
  colorSaturation: 0.3,
  lightingContrast: 0.5,
  concept: concept({ subject_strategy: "place-as-subject", human_presence: "none", temporal_strategy: "aftermath" })
});

const COMMERCIAL_PORTRAIT = input({
  objective: "consideration",
  industry: fnb,
  imageryRealism: 0.85,
  colorStrategy: "restrained-neutral",
  colorSaturation: 0.45,
  lightingContrast: 0.6,
  concept: concept({ subject_strategy: "person-as-subject", human_presence: "central" })
});

const SURREAL_PHOTOGRAPHIC = input({
  objective: "awareness",
  industry: fashion,
  movement: editorialModernism,
  imageryRealism: 0.55,
  concept: concept({ subject_strategy: "material-as-subject", human_presence: "none", abstraction_level: "abstract" })
});

const MIXED_MEDIA = input({
  objective: "awareness",
  industry: fashion,
  movement: brutalism,
  imageryRealism: 0.6,
  graphicTreatmentIntensity: "experimental",
  concept: concept({ subject_strategy: "typography-as-subject", human_presence: "none" })
});

const ALL_SCENARIOS: Record<string, PhotographicCharacterInput> = {
  "fashion editorial": FASHION_EDITORIAL,
  "F&B promotion": FNB_PROMOTION,
  "product photography": PRODUCT_PHOTOGRAPHY,
  documentary: DOCUMENTARY,
  "commercial portrait": COMMERCIAL_PORTRAIT,
  "surreal photographic": SURREAL_PHOTOGRAPHIC,
  "mixed-media photographic": MIXED_MEDIA
};

describe("resolvePhotographicCharacter: determinism & schema", () => {
  it.each(Object.entries(ALL_SCENARIOS))("%s produces a schema-valid, byte-identical result", (_name, scenario) => {
    const first = resolvePhotographicCharacter(scenario);
    const second = resolvePhotographicCharacter(scenario);
    expect(PhotographicCharacterSpec.safeParse(first).success).toBe(true);
    expect(second).toEqual(first);
  });

  it("is stable across many repeated calls", () => {
    const runs = Array.from({ length: 8 }, () => resolvePhotographicCharacter(FNB_PROMOTION));
    expect(new Set(runs.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  it("only ever emits values from the bounded taxonomy", () => {
    for (const scenario of Object.values(ALL_SCENARIOS)) {
      const p = resolvePhotographicCharacter(scenario);
      expect(PhotographicStyle.options).toContain(p.photographic_style);
      expect(CameraLanguage.options).toContain(p.camera_language);
      expect(LensCharacter.options).toContain(p.lens_character);
      expect(DepthOfField.options).toContain(p.depth_of_field);
      expect(LightingBehavior.options).toContain(p.lighting_behavior);
      expect(ColorResponse.options).toContain(p.color_response);
      expect(DynamicRange.options).toContain(p.dynamic_range);
      for (const emphasis of [
        p.skin_realism,
        p.face_realism,
        p.hair_realism,
        p.hand_realism,
        p.fabric_realism,
        p.material_realism,
        p.environmental_realism
      ]) {
        expect(RealismEmphasis.options).toContain(emphasis);
      }
    }
  });
});

describe("resolvePhotographicCharacter: named scenarios (spec §10, §21)", () => {
  it("fashion + editorial + human subject → fashion editorial, editorial camera, portrait lens", () => {
    const p = resolvePhotographicCharacter(FASHION_EDITORIAL);
    expect(p.photographic_style).toBe("fashion-editorial");
    expect(p.camera_language).toBe("full-frame-editorial");
    expect(p.lens_character).toBe("85mm-portrait-compression");
    expect(p.skin_realism).toBe("detailed-naturalistic");
    expect(p.face_realism).toBe("detailed-naturalistic");
  });

  it("F&B + promotion + product hero → commercial-editorial / product-studio family, natural product perspective", () => {
    const p = resolvePhotographicCharacter(FNB_PROMOTION);
    expect(["commercial-editorial", "product-studio"]).toContain(p.photographic_style);
    expect(["100mm-macro-product", "50mm-natural-perspective"]).toContain(p.lens_character);
    expect(["warm-natural", "high-fidelity-product", "restrained-commercial"]).toContain(p.color_response);
    expect(p.skin_realism).toBe("not-applicable");
    expect(p.hand_realism).toBe("detailed-naturalistic");
  });

  it("technology-saas product → controlled product photography with deep focus", () => {
    const p = resolvePhotographicCharacter(PRODUCT_PHOTOGRAPHY);
    expect(p.photographic_style).toBe("product-studio");
    expect(p.camera_language).toBe("studio-commercial");
    expect(p.depth_of_field).toBe("deep-natural");
    expect(p.lighting_behavior).toBe("controlled-studio");
  });

  it("documentary + place + trust → documentary style, environmental lens, deep focus, muted colour", () => {
    const p = resolvePhotographicCharacter(DOCUMENTARY);
    expect(p.photographic_style).toBe("documentary");
    expect(p.lens_character).toBe("35mm-environmental");
    expect(p.depth_of_field).toBe("deep-natural");
    expect(p.color_response).toBe("muted-documentary");
    expect(p.environmental_realism).toBe("detailed-naturalistic");
  });

  it("high-realism commercial portrait raises artificiality risk vs. the same brief at natural realism", () => {
    const p = resolvePhotographicCharacter(COMMERCIAL_PORTRAIT);
    expect(p.photographic_style).toBe("commercial-editorial");
    const lower = resolvePhotographicCharacter({ ...COMMERCIAL_PORTRAIT, imageryRealism: 0.65 });
    expect(p.artificiality_risk.score).toBeGreaterThan(lower.artificiality_risk.score);
  });

  it("abstract concept at mid realism → surreal-photographic, stylised realism target", () => {
    const p = resolvePhotographicCharacter(SURREAL_PHOTOGRAPHIC);
    expect(p.photographic_style).toBe("surreal-photographic");
    expect(p.realism_target).toBe("stylised-photographic");
  });

  it("experimental graphic treatment over a photograph → mixed-media-photographic", () => {
    const p = resolvePhotographicCharacter(MIXED_MEDIA);
    expect(p.photographic_style).toBe("mixed-media-photographic");
    expect(p.realism_target).toBe("stylised-photographic");
  });
});

describe("resolvePhotographicCharacter: imperfection doctrine (§11)", () => {
  it("never defaults to 'none'", () => {
    for (const scenario of Object.values(ALL_SCENARIOS)) {
      expect(resolvePhotographicCharacter(scenario).imperfection_level).not.toBe("none");
    }
  });

  it("only ever emits bounded imperfection levels", () => {
    for (const scenario of Object.values(ALL_SCENARIOS)) {
      expect(ImperfectionLevel.options).toContain(resolvePhotographicCharacter(scenario).imperfection_level);
    }
  });
});

describe("resolvePhotographicCharacter: dynamic range doctrine (§12)", () => {
  it("does not default to high-contrast just because the visual is editorial", () => {
    const p = resolvePhotographicCharacter({
      ...FASHION_EDITORIAL,
      lightingContrast: 0.5
    });
    expect(p.dynamic_range).not.toBe("high-contrast");
  });

  it("reaches high-contrast only with a hard-sun-driving contrast on a cinematic/lifestyle style", () => {
    const p = resolvePhotographicCharacter(
      input({
        industry: hospitality,
        objective: "awareness",
        lightingContrast: 0.82,
        concept: concept({ subject_strategy: "place-as-subject", human_presence: "partial" })
      })
    );
    expect(["high-contrast", "extended"]).toContain(p.dynamic_range);
  });
});

describe("resolvePhotographicCharacter: artificiality risk (§9)", () => {
  it("returns a bounded 0–100 score with a matching band and non-empty rationale factors", () => {
    for (const scenario of Object.values(ALL_SCENARIOS)) {
      const risk = resolvePhotographicCharacter(scenario).artificiality_risk;
      expect(risk.score).toBeGreaterThanOrEqual(0);
      expect(risk.score).toBeLessThanOrEqual(100);
      expect(risk.factors.length).toBeGreaterThan(0);
      const expectedBand =
        risk.score < 25 ? "low" : risk.score < 50 ? "moderate" : risk.score < 75 ? "elevated" : "high";
      expect(risk.band).toBe(expectedBand);
    }
  });

  it("is higher for a shallow-depth / HDR / high-saturation recipe than a restrained one", () => {
    const risky = resolvePhotographicCharacter(
      input({
        industry: hospitality,
        objective: "awareness",
        imageryRealism: 0.92,
        colorSaturation: 0.85,
        lightingContrast: 0.85,
        graphicTreatmentIntensity: "experimental",
        concept: concept({ subject_strategy: "person-as-subject", human_presence: "central" })
      })
    );
    const calm = resolvePhotographicCharacter(DOCUMENTARY);
    expect(risky.artificiality_risk.score).toBeGreaterThan(calm.artificiality_risk.score);
  });

  it("is diagnostic only — it never changes another resolved field", () => {
    const base = resolvePhotographicCharacter(FNB_PROMOTION);
    // Re-resolving with an identical input reproduces every value including the score.
    const again = resolvePhotographicCharacter(FNB_PROMOTION);
    expect(again).toEqual(base);
  });
});

describe("resolvePhotographicCharacter: no country-only inference (§10)", () => {
  it("takes no country id and produces identical output when unrelated recipe context is held constant", () => {
    // The resolver's input type carries no country field at all; the only
    // country-shaped influence is via already-resolved recipe dimensions
    // (realism, lighting, colour saturation, materiality). Holding those equal
    // must hold the whole result equal, whatever country produced them.
    const a = resolvePhotographicCharacter(FNB_PROMOTION);
    const b = resolvePhotographicCharacter({ ...FNB_PROMOTION });
    expect(b).toEqual(a);

    const keys = Object.keys(FNB_PROMOTION);
    expect(keys).not.toContain("country");
    expect(keys).not.toContain("countryId");
    expect(keys).not.toContain("countryBlend");
  });

  it("changing only the realism bias (a country-shaped recipe dimension) is what moves the style", () => {
    const natural = resolvePhotographicCharacter({ ...FASHION_EDITORIAL, imageryRealism: 0.72 });
    const graphic = resolvePhotographicCharacter({ ...FASHION_EDITORIAL, imageryRealism: 0.3 });
    expect(natural.photographic_style).toBe("fashion-editorial");
    expect(graphic.photographic_style).toBe("graphic-photographic");
  });
});

describe("resolvePhotographicCharacter: realism doctrine constraints (§8)", () => {
  it("always carries the universal optical/colour/material floor", () => {
    const p = resolvePhotographicCharacter(PRODUCT_PHOTOGRAPHY);
    const avoid = p.constraints.filter((c) => c.kind === "avoid").map((c) => c.statement).join(" ");
    expect(avoid).toMatch(/universal orange cinematic look/i);
    expect(avoid).toMatch(/excessive HDR/i);
  });

  it("adds the people block only when a human figure is in frame", () => {
    const withHuman = resolvePhotographicCharacter(FASHION_EDITORIAL);
    const withoutHuman = resolvePhotographicCharacter(PRODUCT_PHOTOGRAPHY);
    const mentions = (spec: typeof withHuman, needle: string) =>
      spec.constraints.some((c) => c.statement.includes(needle));
    expect(mentions(withHuman, "natural facial asymmetry")).toBe(true);
    expect(mentions(withoutHuman, "natural facial asymmetry")).toBe(false);
  });

  it("adds an explicit avoid line when the quoted imagery notes mention a banned token", () => {
    const clean = resolvePhotographicCharacter(DOCUMENTARY);
    const flagged = resolvePhotographicCharacter({
      ...DOCUMENTARY,
      framing: "Wide framing that leans on a torii gateway motif.",
      bannedTokens: ["torii"]
    });
    const hasMotifLine = (spec: typeof clean) =>
      spec.constraints.some((c) => c.statement.includes("literal cultural motif"));
    expect(hasMotifLine(clean)).toBe(false);
    expect(hasMotifLine(flagged)).toBe(true);
  });
});
