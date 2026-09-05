import { describe, expect, it } from "vitest";
import { buildDesignContract } from "../../engine/contract/build";
import { clock, datasets, loadBrand, loadBrief, newIds } from "../fixtures/load";
import type { NormalizedBrief } from "../../types/schemas/brief.schema";

/**
 * Failure paths.
 *
 * The builder must reject clearly and completely: a machine-readable code, the
 * path that caused it, and every problem in one pass. If the P2 brief
 * interpreter hallucinates four bad references, the user should see four
 * corrections, not discover them one round trip at a time.
 */
function build(brief: NormalizedBrief, brand = null as ReturnType<typeof loadBrand> | null) {
  return buildDesignContract({
    projectId: "p",
    brief,
    brand,
    datasets,
    clock,
    ids: newIds()
  });
}

const base = () => loadBrief("hardstone-property-trust");

describe("reference errors", () => {
  it("rejects an unknown industry", () => {
    const result = build({ ...base(), industry_id: "aerospace" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]?.code).toBe("unknown_industry");
    expect(result.error[0]?.message).toContain("aerospace");
  });

  it("rejects an unknown visual type", () => {
    const result = build({ ...base(), visual_type_id: "billboard" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.some((e) => e.code === "unknown_visual_type")).toBe(true);
  });

  it("rejects an unknown country in the blend", () => {
    const result = build({ ...base(), country: { indonesia: 0.5, atlantis: 0.5 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.some((e) => e.code === "unknown_country")).toBe(true);
  });

  it("rejects an aspect ratio the visual type does not offer", () => {
    const brief = base();
    const result = build({
      ...brief,
      platform: { ...brief.platform, aspect_ratio_id: "billboard-wide" }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const problem = result.error.find((e) => e.code === "unknown_aspect_ratio");
    expect(problem?.message).toContain("square");
  });

  it("rejects a layout the visual type does not support", () => {
    const brief = base();
    const patched = {
      ...datasets,
      layouts: new Map(datasets.layouts).set("hero-visual", {
        ...datasets.layouts.get("hero-visual")!,
        suitable_visual_types: ["poster"]
      })
    };
    const result = buildDesignContract({
      projectId: "p",
      brief: { ...brief, layout_id: "hero-visual" },
      brand: null,
      datasets: patched,
      clock,
      ids: newIds()
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.some((e) => e.code === "layout_not_supported_by_visual_type")).toBe(true);
  });

  it("reports every reference problem in a single pass", () => {
    const result = build({
      ...base(),
      industry_id: "aerospace",
      movement_id: "vaporwave",
      layout_id: "spiral",
      country: { atlantis: 1 }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThanOrEqual(4);
  });
});

describe("brand errors", () => {
  it("requires a snapshot when the brief references a brand", () => {
    const result = build(loadBrief("kopi-lawas-promotion"), null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.some((e) => e.code === "brand_required")).toBe(true);
  });

  it("rejects a snapshot for a different brand", () => {
    const brand = { ...loadBrand(), brand_id: "brand_someone_else" };
    const result = build(loadBrief("kopi-lawas-promotion"), brand);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.some((e) => e.code === "brand_mismatch")).toBe(true);
  });

  it("ignores a supplied brand when the brief has none", () => {
    const result = build(base(), loadBrand());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.brand).toBeNull();
  });
});

describe("schema errors", () => {
  it("rejects a malformed brief before touching the datasets", () => {
    const result = build({ ...base(), objective: "vibes" } as unknown as NormalizedBrief);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.every((e) => e.code === "brief_invalid")).toBe(true);
  });

  it("rejects a country blend whose weights do not sum to one", () => {
    const result = build({ ...base(), country: { indonesia: 0.6, japan: 0.6 } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error[0]?.code).toBe("brief_invalid");
  });
});
