import { describe, expect, it } from "vitest";
import { buildDesignContract } from "../../engine/contract/build";
import { fixedClock } from "../../ports/clock.port";
import { GOLDEN_BRIEFS, clock, datasets, loadBrand, loadBrief, newIds } from "../fixtures/load";

/**
 * Golden fixtures: brief → contract.
 *
 * These assert INVARIANTS rather than exact output. Snapshotting the whole
 * contract would fail every time a dataset note is reworded, which would train
 * everyone to run `--update` without reading the diff. What must hold is that
 * the industry floor is present, the anchors are locked, the guard is attached
 * and the hash is stable — those are the properties the rest of the system
 * depends on.
 */
describe.each(GOLDEN_BRIEFS)("golden brief: %s", (name) => {
  const brief = loadBrief(name);
  const brand = brief.brand_id ? loadBrand() : null;

  const result = buildDesignContract({
    projectId: "proj_golden",
    brief,
    brand,
    datasets,
    clock,
    ids: newIds()
  });

  it("builds successfully", () => {
    if (!result.ok) throw new Error(JSON.stringify(result.error, null, 2));
    expect(result.ok).toBe(true);
  });

  it("pins schema and dataset versions", () => {
    if (!result.ok) return;
    expect(result.value.schema_version).toBe("1.0.0");
    expect(result.value.dataset_version).toBe(datasets.version);
  });

  it("is frozen and immutable", () => {
    if (!result.ok) return;
    expect(result.value.frozen).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(() => {
      (result.value as unknown as { objective: string }).objective = "tampered";
    }).toThrow();
  });

  it("locks the anchors that exist at contract time and defers the rest", () => {
    if (!result.ok) return;
    const byKind = Object.fromEntries(result.value.anchors.map((a) => [a.kind, a]));
    expect(byKind.objective?.status).toBe("locked");
    expect(byKind.core_message?.status).toBe("locked");
    expect(byKind.concept?.status).toBe("pending");
    expect(byKind.primary_visual_direction?.status).toBe("pending");
    expect(byKind.brand?.status).toBe(brand ? "locked" : undefined);
  });

  it("applies the industry DKV floor and ceiling", () => {
    if (!result.ok) return;
    const industry = datasets.industries.get(brief.industry_id)!;
    const contrast = result.value.dkv_rules.find(
      (rule) => rule.param === "contrast" && rule.source.startsWith("industry:")
    );
    const density = result.value.dkv_rules.find(
      (rule) => rule.param === "visual_density" && rule.source.startsWith("industry:")
    );
    expect(contrast?.min).toBe(industry.dkv_floor.contrast);
    expect(density?.max).toBe(industry.dkv_ceiling.visual_density);
  });

  it("orders DKV rules by doctrine rank, strongest first", () => {
    if (!result.ok) return;
    const ranks = result.value.dkv_rules.map((rule) => rule.doctrine_rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("attaches the country stereotype guard", () => {
    if (!result.ok) return;
    expect(result.value.banned_tokens.length).toBeGreaterThan(0);
    expect(result.value.constraints.some((c) => c.source === "country")).toBe(true);
  });

  it("carries every brief mandatory and prohibition into the constraints", () => {
    if (!result.ok) return;
    const statements = result.value.constraints.map((c) => c.statement);
    for (const mandatory of brief.mandatories) expect(statements).toContain(mandatory);
    for (const prohibition of brief.prohibitions) expect(statements).toContain(prohibition);
  });

  it("produces the same hash regardless of id and timestamp", () => {
    const again = buildDesignContract({
      projectId: "proj_golden",
      brief,
      brand,
      datasets,
      clock: fixedClock("2031-01-01T00:00:00.000Z"),
      ids: newIds()
    });
    if (!result.ok || !again.ok) throw new Error("expected both builds to succeed");
    expect(again.value.contract_hash).toBe(result.value.contract_hash);
    expect(again.value.id).not.toBe("");
    expect(again.value.created_at).not.toBe(result.value.created_at);
  });
});

describe("brief-specific expectations", () => {
  it("snapshots the brand rather than referencing it", () => {
    const result = buildDesignContract({
      projectId: "p",
      brief: loadBrief("kopi-lawas-promotion"),
      brand: loadBrand(),
      datasets,
      clock,
      ids: newIds()
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.brand?.name).toBe("Kopi Lawas");
    expect(result.value.brand?.snapshot_of_version).toBe(3);
    expect(result.value.constraints.some((c) => c.source === "brand" && c.kind === "must_not")).toBe(true);
  });

  it("keeps property trust pressure above the F&B floor", () => {
    const property = buildDesignContract({
      projectId: "p",
      brief: loadBrief("hardstone-property-trust"),
      brand: null,
      datasets,
      clock,
      ids: newIds()
    });
    const fnb = buildDesignContract({
      projectId: "p",
      brief: loadBrief("kopi-lawas-promotion"),
      brand: loadBrand(),
      datasets,
      clock,
      ids: newIds()
    });
    if (!property.ok || !fnb.ok) throw new Error("expected both builds to succeed");

    const floorOf = (contract: typeof property.value) =>
      contract.dkv_rules.find((r) => r.param === "contrast" && r.source.startsWith("industry:"))!.min;

    expect(floorOf(property.value)).toBeGreaterThan(floorOf(fnb.value));
  });

  it("blends two countries into normalised weights", () => {
    const result = buildDesignContract({
      projectId: "p",
      brief: loadBrief("northbeam-saas-launch"),
      brand: null,
      datasets,
      clock,
      ids: newIds()
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const total = Object.values(result.value.country).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(Object.keys(result.value.country).sort()).toEqual(["switzerland", "united-states"]);
  });

  it("flags high text-render risk so the prompt compiler can plan for it", () => {
    const result = buildDesignContract({
      projectId: "p",
      brief: loadBrief("northbeam-saas-launch"),
      brand: null,
      datasets,
      clock,
      ids: newIds()
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.constraints.some((c) => c.id === "visual-type-04")).toBe(true);
  });
});
