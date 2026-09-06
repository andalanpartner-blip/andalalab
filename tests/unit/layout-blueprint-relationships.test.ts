import { describe, expect, it } from "vitest";
import { computeGeometry } from "../../engine/blueprint/geometry";
import { resolveFocal, resolveReadingFlow, resolveZones } from "../../engine/blueprint/zones";
import { resolveRelationships } from "../../engine/blueprint/relationships";
import { resolveRationale } from "../../engine/blueprint/rationale";
import { detectImageIntegration } from "../../engine/blueprint/signals";
import { BlueprintRationale, ZoneRelationship } from "../../types/schemas/layout-blueprint.schema";
import { DOCTRINE_PRINCIPLES } from "../../types/schemas/visual-review.schema";
import { blueprintInputs, BLUEPRINT_FIXTURES } from "../fixtures/blueprint-inputs";

function parts(name: string) {
  const i = blueprintInputs(name);
  const geometry = computeGeometry({
    recipe: i.recipe,
    visualType: i.visualType,
    layout: i.layout,
    aspectRatio: i.aspectRatio
  });
  const integration = detectImageIntegration(i.recipe);
  const { zones } = resolveZones({
    recipe: i.recipe,
    layout: i.layout,
    visualType: i.visualType,
    geometry,
    layerContext: { integratesImage: integration.integrates }
  });
  const focal = resolveFocal(i.recipe, geometry, []);
  const readingFlow = resolveReadingFlow(i.recipe, geometry, []);
  const relationships = resolveRelationships({
    recipe: i.recipe,
    layout: i.layout,
    zones,
    geometry,
    focal,
    integratesImage: integration.integrates,
    integrationSignal: integration.signal
  });
  const rationale = resolveRationale({
    contract: i.contract,
    direction: i.direction,
    recipe: i.recipe,
    layout: i.layout,
    visualType: i.visualType,
    geometry,
    zones,
    focal,
    readingFlow,
    integratesImage: integration.integrates,
    integrationDeviceName: integration.deviceName
  });
  return { inputs: i, zones, focal, readingFlow, relationships, rationale };
}

describe("blueprint relationships (P2.10.4)", () => {
  it.each(BLUEPRINT_FIXTURES)("%s — every relationship is schema-valid and traceable", (name) => {
    const { relationships, zones } = parts(name);
    const ids = new Set<string>([...zones.map((z) => z.id), "canvas", "grid", "safe_area", "margin"]);
    for (const rel of relationships) {
      expect(ZoneRelationship.safeParse(rel).success).toBe(true);
      expect(zones.some((z) => z.id === rel.from)).toBe(true);
      expect(ids.has(String(rel.to))).toBe(true);
      expect(rel.signal.length).toBeGreaterThan(0);
    }
  });

  it("emits a precedes chain that matches the reading order", () => {
    const { relationships, readingFlow } = parts("print-property-brochure");
    const precedes = relationships.filter((r) => r.kind === "precedes");
    expect(precedes.map((r) => r.from)).toEqual(readingFlow.path.slice(0, -1));
    expect(precedes.map((r) => r.to)).toEqual(readingFlow.path.slice(1));
  });

  it("the focal zone dominates every other zone", () => {
    const { relationships, zones, focal } = parts("northbeam-saas-launch");
    const dominates = relationships.filter((r) => r.kind === "dominates");
    expect(dominates.every((r) => r.from === focal.zone)).toBe(true);
    expect(new Set(dominates.map((r) => r.to)).size).toBe(zones.length - 1);
  });

  it("marks every zone aligned to the grid", () => {
    const { relationships, zones } = parts("kopi-lawas-promotion");
    const aligns = relationships.filter((r) => r.kind === "aligns_with" && r.to === "grid");
    expect(new Set(aligns.map((r) => r.from)).size).toBe(zones.length);
  });

  it("emits contained_by → safe_area only for zones actually inside it", () => {
    const { relationships, zones } = parts("story-skincare-launch");
    const safe = relationships.filter((r) => r.kind === "contained_by" && r.to === "safe_area");
    for (const rel of safe) {
      expect(zones.find((z) => z.id === rel.from)!.within_safe_area).toBe(true);
    }
  });

  it("emits a figure/ground contrast when an image zone is present", () => {
    const { relationships, zones } = parts("kopi-lawas-promotion");
    const hasImage = zones.some((z) => z.id === "image" || z.id === "hero" || z.id === "product");
    const contrast = relationships.filter((r) => r.kind === "contrasts_with");
    expect(contrast.length > 0).toBe(hasImage);
  });

  it("a cta / offer zone depends on the zone ahead of it", () => {
    const { relationships, readingFlow } = parts("web-hero-saas-launch");
    for (const rel of relationships.filter((r) => r.kind === "depends_on")) {
      const idx = readingFlow.path.indexOf(rel.from);
      expect(readingFlow.path[idx - 1]).toBe(rel.to);
    }
  });

  it("is deterministic", () => {
    for (const name of BLUEPRINT_FIXTURES) {
      expect(JSON.stringify(parts(name).relationships)).toEqual(
        JSON.stringify(parts(name).relationships)
      );
    }
  });
});

describe("blueprint rationale (P2.10.4)", () => {
  it.each(BLUEPRINT_FIXTURES)("%s — every entry is schema-valid, sourced, and doctrine-linked", (name) => {
    const { rationale } = parts(name);
    expect(rationale.length).toBeGreaterThanOrEqual(6);
    for (const entry of rationale) {
      expect(BlueprintRationale.safeParse(entry).success).toBe(true);
      expect(entry.basis.length).toBeGreaterThan(0);
      expect(entry.signal.length).toBeGreaterThan(0);
      if (entry.principle !== null) {
        expect(DOCTRINE_PRINCIPLES).toContain(entry.principle);
      }
    }
  });

  it("traces the focal claim to real recipe values, not prose", () => {
    const { rationale, inputs, focal } = parts("northbeam-saas-launch");
    const focalEntry = rationale.find((r) => r.claim.toLowerCase().includes("focal claim"));
    expect(focalEntry).toBeDefined();
    expect(focalEntry!.signal).toContain(`focal_dominance=${focal.dominance}`);
    expect(focalEntry!.basis).toContain("recipe");
    void inputs;
  });

  it("does not invent a strategic reason — reading-flow rationale quotes the recipe flow", () => {
    const { rationale, inputs } = parts("kopi-lawas-promotion");
    const flowEntry = rationale.find((r) => r.claim.toLowerCase().includes("the eye moves"));
    expect(flowEntry!.signal).toContain(`recipe.composition.flow=${inputs.recipe.composition.flow}`);
  });

  it("is deterministic", () => {
    for (const name of BLUEPRINT_FIXTURES) {
      expect(JSON.stringify(parts(name).rationale)).toEqual(JSON.stringify(parts(name).rationale));
    }
  });
});

describe("image-integration signal (P2.10.4)", () => {
  it("returns a stable shape and only fires on a framing / integration purpose", () => {
    for (const name of BLUEPRINT_FIXTURES) {
      const result = detectImageIntegration(blueprintInputs(name).recipe);
      expect(typeof result.integrates).toBe("boolean");
      if (result.integrates) {
        expect(result.deviceName).toBeTruthy();
        expect(result.signal).toMatch(/purpose=/);
      } else {
        expect(result.deviceName).toBeNull();
      }
    }
  });
});
