import { describe, expect, it } from "vitest";
import { datasets } from "../fixtures/load";
import { resolveGraphicTreatment } from "../../engine/graphic-treatment/resolve";
import { GRAPHIC_DEVICES } from "../../engine/graphic-treatment/data";
import type { GraphicTreatmentInput } from "../../engine/graphic-treatment/types";
import { GraphicDevicePurpose, GraphicTreatmentIntensity } from "../../types/schemas/graphic-treatment.schema";
import type { AudienceSpec } from "../../types/schemas/brief.schema";
import type { DkvParams } from "../../types/schemas/dkv.schema";

/**
 * The Graphic Treatment engine (P2.5). Every test here runs against a
 * deterministic, hand-built input — no live Gemini calls, no randomness, no
 * clock reads. Movements, industries and layouts are the real fixtures
 * shipped in data/, exactly as engine/decision unit tests already do.
 */

const bauhaus = datasets.movements.get("bauhaus")!;
const brutalism = datasets.movements.get("brutalism")!;
const contemporaryDigital = datasets.movements.get("contemporary-digital")!;
const editorialModernism = datasets.movements.get("editorial-modernism")!;
const minimalism = datasets.movements.get("minimalism")!;
const swissInternational = datasets.movements.get("swiss-international")!;

const fnb = datasets.industries.get("fnb")!;
const property = datasets.industries.get("property")!;
const technologySaas = datasets.industries.get("technology-saas")!;
const fashion = datasets.industries.get("fashion")!;

const heroVisual = datasets.layouts.get("hero-visual")!;
const typographic = datasets.layouts.get("typographic")!;

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

const YOUTH_AUDIENCE = audience({ age_range: [20, 28], attention_context: "scroll" });
const PROFESSIONAL_AUDIENCE = audience({ age_range: [45, 60], attention_context: "dwell", sophistication: 0.6 });
const REFINED_AUDIENCE = audience({ sophistication: 0.9, price_sensitivity: 0.15 });

function dkv(overrides: Partial<DkvParams> = {}): DkvParams {
  return {
    whitespace: 0.5,
    contrast: 0.6,
    visual_density: 0.5,
    alignment: 0.8,
    hierarchy_strength: 0.6,
    color_complexity: 0.4,
    focal_dominance: 0.6,
    typographic_scale_ratio: 1.5,
    ...overrides
  };
}

function input(overrides: Partial<GraphicTreatmentInput> = {}): GraphicTreatmentInput {
  return {
    objective: "awareness",
    audience: audience(),
    industry: fnb,
    movement: contemporaryDigital,
    layout: heroVisual,
    dkv: dkv(),
    ornament: 0.5,
    hasDenseBodyCopy: false,
    bannedTokens: [],
    concept: null,
    ...overrides
  };
}

// A high-signal scenario: high ornament, high density, low focal dominance,
// an aesthetically permissive industry (fnb), a youth audience — everything
// that should push intensity toward the expressive/experimental end.
const HIGH_SIGNAL = input({
  objective: "awareness",
  audience: YOUTH_AUDIENCE,
  industry: fnb,
  dkv: dkv({ visual_density: 0.75, focal_dominance: 0.4 }),
  ornament: 0.85
});

// A low-signal scenario: low ornament, low density, high focal dominance, a
// trust-critical industry (property), a trust objective — everything that
// should push intensity toward none/minimal.
const LOW_SIGNAL = input({
  objective: "trust",
  audience: PROFESSIONAL_AUDIENCE,
  industry: property,
  movement: swissInternational,
  dkv: dkv({ visual_density: 0.15, focal_dominance: 0.9 }),
  ornament: 0.1
});

describe("resolveGraphicTreatment: determinism", () => {
  it("produces byte-identical output for the same input", () => {
    const first = resolveGraphicTreatment(HIGH_SIGNAL);
    const second = resolveGraphicTreatment(HIGH_SIGNAL);
    expect(second).toEqual(first);
  });

  it("is stable across many repeated calls", () => {
    const runs = Array.from({ length: 8 }, () => resolveGraphicTreatment(HIGH_SIGNAL));
    const unique = new Set(runs.map((run) => JSON.stringify(run)));
    expect(unique.size).toBe(1);
  });
});

describe("resolveGraphicTreatment: intensity bands", () => {
  it("NONE produces no devices at all", () => {
    const plan = resolveGraphicTreatment(LOW_SIGNAL);
    expect(plan.intensity).toBe("none");
    expect(plan.structural_devices).toHaveLength(0);
    expect(plan.expressive_devices).toHaveLength(0);
    expect(plan.image_treatments).toHaveLength(0);
    expect(plan.typography_treatments).toHaveLength(0);
    expect(plan.textures).toHaveLength(0);
    expect(plan.patterns).toHaveLength(0);
    expect(plan.layering).toHaveLength(0);
    expect(plan.accents).toHaveLength(0);
  });

  it("MINIMAL stays minimal: at most one structural device and one optional treatment", () => {
    const plan = resolveGraphicTreatment(
      input({
        objective: "brand-building",
        industry: fashion,
        movement: minimalism,
        dkv: dkv({ visual_density: 0.4, focal_dominance: 0.7 }),
        ornament: 0.25,
        audience: REFINED_AUDIENCE
      })
    );
    expect(plan.intensity).toBe("minimal");
    expect(plan.structural_devices.length).toBeLessThanOrEqual(1);
    expect(plan.expressive_devices).toHaveLength(0);
    expect(plan.textures).toHaveLength(0);
    expect(plan.patterns).toHaveLength(0);
    expect(plan.layering).toHaveLength(0);
    expect(plan.accents).toHaveLength(0);
  });

  it("MODERATE remains a small, coordinated set", () => {
    const plan = resolveGraphicTreatment(
      input({ objective: "promotion", industry: fnb, movement: bauhaus, dkv: dkv({ visual_density: 0.45, focal_dominance: 0.8 }), ornament: 0.48, audience: YOUTH_AUDIENCE })
    );
    expect(plan.intensity).toBe("moderate");
    const total =
      plan.structural_devices.length +
      plan.expressive_devices.length +
      plan.image_treatments.length +
      plan.typography_treatments.length +
      plan.textures.length +
      plan.patterns.length +
      plan.layering.length +
      plan.accents.length;
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(5);
    expect(plan.textures).toHaveLength(0);
    expect(plan.patterns).toHaveLength(0);
  });

  it("never exceeds what the selection targets allow, even at maximum signal", () => {
    const plan = resolveGraphicTreatment(HIGH_SIGNAL);
    expect(GraphicTreatmentIntensity.options).toContain(plan.intensity);
    expect(plan.structural_devices.length).toBeLessThanOrEqual(2);
    expect(plan.expressive_devices.length).toBeLessThanOrEqual(3);
  });
});

describe("resolveGraphicTreatment: communication objective outranks decorative treatment", () => {
  it("a conversion/promotion objective caps intensity at moderate even with maximum signal", () => {
    const uncapped = resolveGraphicTreatment({ ...HIGH_SIGNAL, objective: "awareness" });
    const capped = resolveGraphicTreatment({ ...HIGH_SIGNAL, objective: "promotion" });

    const rank = (level: string) => GraphicTreatmentIntensity.options.indexOf(level as never);
    expect(rank(capped.intensity)).toBeLessThanOrEqual(rank("moderate"));
    expect(rank(uncapped.intensity)).toBeGreaterThan(rank(capped.intensity));
  });

  it("a trust objective caps intensity at minimal", () => {
    const plan = resolveGraphicTreatment({ ...HIGH_SIGNAL, objective: "trust" });
    const rank = (level: string) => GraphicTreatmentIntensity.options.indexOf(level as never);
    expect(rank(plan.intensity)).toBeLessThanOrEqual(rank("minimal"));
  });
});

describe("resolveGraphicTreatment: audience influence", () => {
  it("a refined/luxury-leaning audience suppresses excessive devices (caps at moderate)", () => {
    const plan = resolveGraphicTreatment({ ...HIGH_SIGNAL, objective: "awareness", audience: REFINED_AUDIENCE });
    const rank = (level: string) => GraphicTreatmentIntensity.options.indexOf(level as never);
    expect(rank(plan.intensity)).toBeLessThanOrEqual(rank("moderate"));
  });

  it("a youth campaign is allowed more expressive treatment than an equivalent professional campaign", () => {
    const base = input({
      objective: "awareness",
      industry: fnb,
      movement: contemporaryDigital,
      dkv: dkv({ visual_density: 0.55, focal_dominance: 0.65 }),
      ornament: 0.55
    });
    const youthPlan = resolveGraphicTreatment({ ...base, audience: YOUTH_AUDIENCE });
    const professionalPlan = resolveGraphicTreatment({ ...base, audience: PROFESSIONAL_AUDIENCE });

    const rank = (level: string) => GraphicTreatmentIntensity.options.indexOf(level as never);
    expect(rank(youthPlan.intensity)).toBeGreaterThanOrEqual(rank(professionalPlan.intensity));
  });
});

describe("resolveGraphicTreatment: movement compatibility", () => {
  it("only selects a device for a movement it declares compatibility with", () => {
    const forBauhaus = resolveGraphicTreatment({ ...HIGH_SIGNAL, movement: bauhaus });
    const forEditorial = resolveGraphicTreatment({ ...HIGH_SIGNAL, movement: editorialModernism });

    const ids = (plan: ReturnType<typeof resolveGraphicTreatment>) => plan.expressive_devices.map((d) => d.id);
    expect(ids(forBauhaus)).not.toContain("organic-blob-accent");
    // organic-blob-accent only declares contemporary-digital compatibility.
    const forContemporary = resolveGraphicTreatment({
      ...HIGH_SIGNAL,
      movement: contemporaryDigital,
      objective: "awareness"
    });
    expect(ids(forEditorial)).not.toContain("organic-blob-accent");
    expect(forContemporary).toBeDefined();
  });
});

describe("resolveGraphicTreatment: incompatible pairings are rejected", () => {
  it("never selects two devices that declare avoid_with on each other", () => {
    // geometric-block-accent and organic-blob-accent both suit contemporary-digital
    // and both explicitly avoid_with each other — at most one may survive.
    const plan = resolveGraphicTreatment({
      ...HIGH_SIGNAL,
      movement: contemporaryDigital,
      objective: "awareness"
    });
    const ids = plan.expressive_devices.map((d) => d.id);
    expect(ids.includes("geometric-block-accent") && ids.includes("organic-blob-accent")).toBe(false);
  });
});

describe("resolveGraphicTreatment: cultural / anti-stereotype safety", () => {
  it("never selects a device whose own text mentions a banned token from the country blend", () => {
    const withoutBan = resolveGraphicTreatment({
      ...HIGH_SIGNAL,
      movement: bauhaus,
      objective: "awareness",
      dkv: dkv({ visual_density: 0.75, focal_dominance: 0.4 })
    });
    const structuralWithBan = resolveGraphicTreatment({
      ...HIGH_SIGNAL,
      movement: bauhaus,
      objective: "awareness",
      dkv: dkv({ visual_density: 0.75, focal_dominance: 0.4 }),
      bannedTokens: ["modular"]
    });

    const idsWithout = withoutBan.structural_devices.map((d) => d.id);
    const idsWithBan = structuralWithBan.structural_devices.map((d) => d.id);
    expect(idsWithout).toContain("modular-grid-blocks");
    expect(idsWithBan).not.toContain("modular-grid-blocks");
    expect(idsWithBan).not.toContain("modular-panel");
  });
});

describe("resolveGraphicTreatment: gating rules reuse existing signals", () => {
  it("excludes a device that requires a grid when the layout does not have enough columns", () => {
    const oneColumnLayout = { ...typographic, grid: { ...typographic.grid, columns: 1 } };
    const plan = resolveGraphicTreatment({
      ...HIGH_SIGNAL,
      movement: bauhaus,
      layout: oneColumnLayout,
      objective: "awareness"
    });
    expect(plan.structural_devices.map((d) => d.id)).not.toContain("modular-grid-blocks");
  });

  it("excludes typography devices that conflict with dense body copy", () => {
    const plan = resolveGraphicTreatment({
      ...HIGH_SIGNAL,
      movement: bauhaus,
      objective: "awareness",
      hasDenseBodyCopy: true
    });
    expect(plan.typography_treatments.map((d) => d.id)).not.toContain("oversized-cropped-headline");
  });

  it("excludes texture/pattern devices when imagery is already visually dense", () => {
    const plan = resolveGraphicTreatment({
      ...HIGH_SIGNAL,
      movement: brutalism,
      objective: "awareness",
      dkv: dkv({ visual_density: 0.9, focal_dominance: 0.4 })
    });
    expect(plan.textures).toHaveLength(0);
  });
});

describe("resolveGraphicTreatment: no random decoration invariant", () => {
  it("every device in the taxonomy declares at least one valid purpose", () => {
    for (const device of GRAPHIC_DEVICES) {
      expect(device.purpose.length).toBeGreaterThan(0);
      for (const purpose of device.purpose) {
        expect(GraphicDevicePurpose.options).toContain(purpose);
      }
    }
  });

  it("every selected device on a resolved plan carries its purpose and a traceable rationale", () => {
    const plan = resolveGraphicTreatment(HIGH_SIGNAL);
    const all = [
      ...plan.structural_devices,
      ...plan.expressive_devices,
      ...plan.image_treatments,
      ...plan.typography_treatments,
      ...plan.textures,
      ...plan.patterns,
      ...plan.layering,
      ...plan.accents
    ];
    for (const device of all) {
      expect(device.purpose.length).toBeGreaterThan(0);
      expect(device.source.length).toBeGreaterThan(0);
      expect(device.rationale.length).toBeGreaterThan(0);
    }
  });

  it("device ids in the taxonomy are unique", () => {
    const ids = GRAPHIC_DEVICES.map((device) => device.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("resolveGraphicTreatment: industry constrains, does not template", () => {
  it("a formal/high-trust industry (property) suppresses expressive-audience-only devices", () => {
    const plan = resolveGraphicTreatment({
      ...HIGH_SIGNAL,
      industry: property,
      movement: contemporaryDigital,
      objective: "awareness"
    });
    const allIds = [...plan.expressive_devices, ...plan.accents, ...plan.layering].map((d) => d.id);
    expect(allIds).not.toContain("organic-blob-accent");
    expect(allIds).not.toContain("badge-mark");
    expect(allIds).not.toContain("stamp-mark");
  });

  it("technology-saas under a conversion objective stays restrained", () => {
    const plan = resolveGraphicTreatment(
      input({ objective: "conversion", industry: technologySaas, movement: contemporaryDigital, ornament: 0.38, dkv: dkv({ visual_density: 0.39, focal_dominance: 0.78 }) })
    );
    const rank = (level: string) => GraphicTreatmentIntensity.options.indexOf(level as never);
    expect(rank(plan.intensity)).toBeLessThanOrEqual(rank("moderate"));
  });
});
