import { describe, expect, it } from "vitest";
import { loadDatasets, summariseDatasets, DatasetValidationError } from "../../data/loader";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_ROOT = fileURLToPath(new URL("../../data/", import.meta.url));

describe("dataset loading", () => {
  const registry = loadDatasets();

  it("loads the full MVP dataset", () => {
    expect(summariseDatasets(registry)).toEqual({
      countries: 4,
      movements: 6,
      industries: 6,
      visualTypes: 1,
      layouts: 4,
      lexicons: 1
    });
  });

  it("pins a valid dataset version", () => {
    expect(registry.version).toMatch(/^\d{4}\.\d{2}\.\d+$/);
  });

  it("keys every entry by its own id", () => {
    for (const [key, country] of registry.countries) expect(country.id).toBe(key);
    for (const [key, movement] of registry.movements) expect(movement.id).toBe(key);
    for (const [key, industry] of registry.industries) expect(industry.id).toBe(key);
  });

  it("normalises country dimension weights to 1", () => {
    for (const country of registry.countries.values()) {
      const sum = Object.values(country.weights).reduce((total, weight) => total + weight, 0);
      expect(sum).toBeCloseTo(1, 3);
      for (const variant of country.style_variants) {
        if (!variant.weights_override) continue;
        const overrideSum = Object.values(variant.weights_override).reduce((t, w) => t + w, 0);
        expect(overrideSum, `${country.id}/${variant.id}`).toBeCloseTo(1, 3);
      }
    }
  });

  it("gives every country a non-empty stereotype guard", () => {
    for (const country of registry.countries.values()) {
      expect(country.avoid_stereotypes.length, country.id).toBeGreaterThanOrEqual(5);
      for (const entry of country.avoid_stereotypes) {
        expect(entry.token, country.id).not.toBe("");
        expect(entry.instead.length, `${country.id}/${entry.token}`).toBeGreaterThan(20);
      }
    }
  });

  it("keeps movement compatibility symmetric enough to be usable", () => {
    for (const movement of registry.movements.values()) {
      for (const [other, score] of Object.entries(movement.compatibility)) {
        expect(score, `${movement.id}->${other}`).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("dataset validation gate", () => {
  function scratchDataRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), "andala-data-"));
    cpSync(DATA_ROOT, dir, {
      recursive: true,
      filter: (source) => !source.endsWith(".ts")
    });
    return dir;
  }

  it("rejects a file whose id does not match its filename", () => {
    const root = scratchDataRoot();
    const broken = { ...JSON.parse(JSON.stringify(loadDatasets().industries.get("fnb"))), id: "wrong-id" };
    writeFileSync(join(root, "industries", "fnb.json"), JSON.stringify(broken));
    expect(() => loadDatasets({ root })).toThrow(DatasetValidationError);
  });

  it("rejects an entry that fails its schema", () => {
    const root = scratchDataRoot();
    writeFileSync(
      join(root, "layouts", "hero-visual.json"),
      JSON.stringify({ id: "hero-visual", name: "Broken", schema_version: "1.0.0" })
    );
    expect(() => loadDatasets({ root })).toThrow(DatasetValidationError);
  });

  it("rejects a dangling cross-file reference", () => {
    const root = scratchDataRoot();
    const industry = JSON.parse(JSON.stringify(loadDatasets().industries.get("fnb")));
    industry.preferred_movements = ["does-not-exist"];
    writeFileSync(join(root, "industries", "fnb.json"), JSON.stringify(industry));
    expect(() => loadDatasets({ root })).toThrow(/unknown "does-not-exist"/);
  });

  it("rejects a stale schema_version instead of silently accepting it", () => {
    const root = scratchDataRoot();
    const country = JSON.parse(JSON.stringify(loadDatasets().countries.get("japan")));
    country.schema_version = "0.9.0";
    writeFileSync(join(root, "countries", "japan.json"), JSON.stringify(country));
    expect(() => loadDatasets({ root })).toThrow(/schema_version/);
  });

  it("reports every problem at once rather than the first one", () => {
    const root = scratchDataRoot();
    const country = JSON.parse(JSON.stringify(loadDatasets().countries.get("japan")));
    country.weights = { composition: 0.5, typography: 0.5, color: 0.5, imagery: 0.5, materiality: 0.5, graphic_language: 0.5 };
    country.contemporary_traits = [];
    writeFileSync(join(root, "countries", "japan.json"), JSON.stringify(country));
    try {
      loadDatasets({ root });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DatasetValidationError);
      expect((error as DatasetValidationError).issues.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("picks up a new country from a file alone, with no code change", () => {
    const root = scratchDataRoot();
    const template = JSON.parse(JSON.stringify(loadDatasets().countries.get("switzerland")));
    template.id = "netherlands";
    template.name = "Netherlands";
    mkdirSync(join(root, "countries"), { recursive: true });
    writeFileSync(join(root, "countries", "netherlands.json"), JSON.stringify(template));

    const registry = loadDatasets({ root });
    expect(registry.countries.size).toBe(5);
    expect(registry.countries.get("netherlands")?.name).toBe("Netherlands");
  });
});
