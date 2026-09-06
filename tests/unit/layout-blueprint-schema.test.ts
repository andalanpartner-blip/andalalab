import { describe, expect, it } from "vitest";
import {
  BlueprintRect,
  BlueprintReadingFlow,
  LayoutBlueprint,
  RelationshipKind,
  ValueBasis,
  ZoneRole
} from "../../types/schemas/layout-blueprint.schema";
import { SCHEMA_VERSIONS } from "../../types/versions";
import { validBlueprint } from "../fixtures/blueprint";

describe("LayoutBlueprint schema (P2.10.1)", () => {
  it("accepts a well-formed blueprint", () => {
    expect(LayoutBlueprint.safeParse(validBlueprint()).success).toBe(true);
  });

  it("is strict — an unexpected top-level key is rejected, not ignored", () => {
    const parsed = LayoutBlueprint.safeParse({ ...validBlueprint(), rendered_image: "data:..." });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
    }
  });

  it("registers a pinned schema version", () => {
    expect(SCHEMA_VERSIONS.layoutBlueprint).toBe("1.0.0");
    expect(validBlueprint().schema_version).toBe(SCHEMA_VERSIONS.layoutBlueprint);
  });

  it("requires an 8-char blueprint_hash and recipe_hash", () => {
    expect(LayoutBlueprint.safeParse(validBlueprint({ blueprint_hash: "short" })).success).toBe(false);
    const bad = validBlueprint();
    expect(
      LayoutBlueprint.safeParse({
        ...bad,
        provenance: { ...bad.provenance, recipe_hash: "nothex-too-long" }
      }).success
    ).toBe(false);
  });

  it("distinguishes structural, derived and unassessed values", () => {
    expect(ValueBasis.options).toEqual(["structural", "derived", "unassessed"]);
    const bp = validBlueprint();
    expect(bp.grid.basis).toBe("structural");
    expect(bp.zones[0]!.basis).toBe("derived");
  });

  it("closes the zone-role vocabulary at four", () => {
    expect(ZoneRole.options).toEqual(["primary", "secondary", "supporting", "utility"]);
  });

  it("closes the relationship vocabulary and rejects an invented kind", () => {
    expect(RelationshipKind.options).toContain("overlaps");
    expect(RelationshipKind.options).toContain("aligns_with");
    const bp = validBlueprint();
    const parsed = LayoutBlueprint.safeParse({
      ...bp,
      relationships: [{ ...bp.relationships[0]!, kind: "vibes_with" }]
    });
    expect(parsed.success).toBe(false);
  });

  describe("BlueprintRect refinements", () => {
    it("rejects a rect that overflows the right edge", () => {
      expect(BlueprintRect.safeParse({ x: 0.8, y: 0, w: 0.5, h: 0.2 }).success).toBe(false);
    });
    it("rejects a rect that overflows the bottom edge", () => {
      expect(BlueprintRect.safeParse({ x: 0, y: 0.9, w: 0.2, h: 0.5 }).success).toBe(false);
    });
    it("rejects a zero-area rect", () => {
      expect(BlueprintRect.safeParse({ x: 0.1, y: 0.1, w: 0, h: 0.2 }).success).toBe(false);
    });
    it("accepts a rect flush with both far edges", () => {
      expect(BlueprintRect.safeParse({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }).success).toBe(true);
    });
  });

  describe("BlueprintReadingFlow refinements", () => {
    const flow = validBlueprint().reading_flow;

    it("rejects an entry that is not the first path zone", () => {
      expect(BlueprintReadingFlow.safeParse({ ...flow, entry: "headline" }).success).toBe(false);
    });
    it("rejects an exit that is not the last path zone", () => {
      expect(BlueprintReadingFlow.safeParse({ ...flow, exit: "headline" }).success).toBe(false);
    });
    it("rejects a waypoint count that does not match the path", () => {
      expect(
        BlueprintReadingFlow.safeParse({ ...flow, waypoints: flow.waypoints.slice(0, 1) }).success
      ).toBe(false);
    });
  });

  it("rejects a zone id outside the shared ZoneId enum", () => {
    const bp = validBlueprint();
    const parsed = LayoutBlueprint.safeParse({
      ...bp,
      zones: [{ ...bp.zones[0]!, id: "sidebar" }]
    });
    expect(parsed.success).toBe(false);
  });

  it("requires issues to use the closed issue-code vocabulary", () => {
    const bp = validBlueprint();
    const parsed = LayoutBlueprint.safeParse({
      ...bp,
      issues: [
        { code: "made_up_code", severity: "P1", path: "zones[0]", message: "something happened here", zone: null }
      ]
    });
    expect(parsed.success).toBe(false);
  });
});
