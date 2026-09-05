import { readFileSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";

import { SCHEMA_VERSIONS } from "../types/versions";
import { DatasetVersion } from "../types/primitives";
import { CommunicationObjective } from "../types/schemas/brief.schema";
import { CountryDNA } from "../types/schemas/reference/country.schema";
import { DesignMovement } from "../types/schemas/reference/movement.schema";
import { IndustryDNA } from "../types/schemas/reference/industry.schema";
import { LayoutSystem } from "../types/schemas/reference/layout.schema";
import { ConceptLexicon } from "../types/schemas/reference/lexicon.schema";
import { VisualType } from "../types/schemas/reference/visual-type.schema";
import type { DatasetRegistry } from "../types/datasets";

/**
 * The dataset loader.
 *
 * This is the ONLY module in the system that reads from disk, which is why it
 * lives in data/ and not in engine/. The engine receives a DatasetRegistry as
 * an argument and can therefore stay pure, synchronous and trivially testable.
 *
 * Directory scanning is deliberate: adding a fifth country must mean dropping
 * in one JSON file, with no import statement to update and no registry to edit.
 * That is why dataset ids are validated as slugs rather than modelled as
 * TypeScript union types — compile-time autocomplete on ids would be pleasant,
 * but it would make the data layer un-extendable without a code change.
 */

const DATA_ROOT = fileURLToPath(new URL(".", import.meta.url));

export class DatasetValidationError extends Error {
  public readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Dataset validation failed with ${issues.length} issue(s):\n  - ${issues.join("\n  - ")}`);
    this.name = "DatasetValidationError";
    this.issues = issues;
  }
}

type Collector = string[];

function readJsonFiles(directory: string, issues: Collector): { file: string; value: unknown }[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    issues.push(`missing dataset directory: ${directory}`);
    return [];
  }

  const files = entries.filter((entry) => extname(entry) === ".json").sort();
  if (files.length === 0) issues.push(`no dataset files found in ${directory}`);

  const parsed: { file: string; value: unknown }[] = [];
  for (const file of files) {
    const path = join(directory, file);
    try {
      parsed.push({ file, value: JSON.parse(readFileSync(path, "utf8")) as unknown });
    } catch (error) {
      issues.push(`${file}: not valid JSON (${(error as Error).message})`);
    }
  }
  return parsed;
}

function loadCollection<TSchema extends z.ZodType<{ id: string; schema_version: string }>>(
  directory: string,
  schema: TSchema,
  schemaVersion: string,
  label: string,
  issues: Collector
): Map<string, z.infer<TSchema>> {
  const collection = new Map<string, z.infer<TSchema>>();

  for (const { file, value } of readJsonFiles(directory, issues)) {
    const result = schema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        issues.push(`${label}/${file} → ${path}: ${issue.message}`);
      }
      continue;
    }

    const entry = result.data;
    const expectedId = basename(file, ".json");
    if (entry.id !== expectedId) {
      issues.push(`${label}/${file} → id "${entry.id}" does not match filename "${expectedId}"`);
    }
    if (entry.schema_version !== schemaVersion) {
      issues.push(
        `${label}/${file} → schema_version "${entry.schema_version}" is not the current ${schemaVersion}. ` +
          `Register an upcaster in types/versions.ts or update the file.`
      );
    }
    if (collection.has(entry.id)) {
      issues.push(`${label}/${file} → duplicate id "${entry.id}"`);
    }
    collection.set(entry.id, entry);
  }

  return collection;
}

function requireRefs(
  refs: readonly string[],
  available: ReadonlySet<string>,
  context: string,
  issues: Collector
): void {
  for (const ref of refs) {
    if (!available.has(ref)) issues.push(`${context} references unknown "${ref}"`);
  }
}

/**
 * Cross-file referential integrity.
 *
 * Zod validates each file in isolation; this validates the graph between them.
 * Without it, a typo in `preferred_movements` would sit silently in the data
 * until the Design Direction engine quietly scored nothing in P1.
 */
function checkReferentialIntegrity(registry: DatasetRegistry, issues: Collector): void {
  const countryIds = new Set(registry.countries.keys());
  const movementIds = new Set(registry.movements.keys());
  const industryIds = new Set(registry.industries.keys());
  const visualTypeIds = new Set(registry.visualTypes.keys());
  const layoutIds = new Set(registry.layouts.keys());
  const objectives = new Set<string>(CommunicationObjective.options);

  for (const country of registry.countries.values()) {
    for (const variant of country.style_variants) {
      requireRefs(
        variant.suitable_for,
        industryIds,
        `countries/${country.id} → style_variants.${variant.id}.suitable_for`,
        issues
      );
    }
  }

  for (const movement of registry.movements.values()) {
    requireRefs(
      movement.suitable_industries,
      industryIds,
      `movements/${movement.id} → suitable_industries`,
      issues
    );
    requireRefs(
      movement.suitable_objectives,
      objectives,
      `movements/${movement.id} → suitable_objectives`,
      issues
    );
    requireRefs(
      Object.keys(movement.compatibility),
      movementIds,
      `movements/${movement.id} → compatibility`,
      issues
    );
    if (Object.prototype.hasOwnProperty.call(movement.compatibility, movement.id)) {
      issues.push(`movements/${movement.id} → compatibility must not include itself`);
    }
  }

  for (const industry of registry.industries.values()) {
    requireRefs(
      industry.preferred_movements,
      movementIds,
      `industries/${industry.id} → preferred_movements`,
      issues
    );
  }

  for (const visualType of registry.visualTypes.values()) {
    requireRefs(
      visualType.default_layouts,
      layoutIds,
      `visual-types/${visualType.id} → default_layouts`,
      issues
    );
    const ratioIds = new Set(visualType.aspect_ratios.map((ratio) => ratio.id));
    if (!ratioIds.has(visualType.default_aspect_ratio)) {
      issues.push(
        `visual-types/${visualType.id} → default_aspect_ratio "${visualType.default_aspect_ratio}" is not one of its aspect_ratios`
      );
    }
    const allowed = new Set<string>(visualType.allowed_zones);
    requireRefs(visualType.required_zones, allowed, `visual-types/${visualType.id} → required_zones`, issues);

    for (const layoutId of visualType.default_layouts) {
      const layout = registry.layouts.get(layoutId);
      if (!layout) continue;
      for (const zone of layout.zones) {
        if (!allowed.has(zone.id)) {
          issues.push(
            `layouts/${layout.id} → zone "${zone.id}" is not allowed by visual-types/${visualType.id}`
          );
        }
      }
      for (const required of visualType.required_zones) {
        if (!layout.zones.some((zone) => zone.id === required && zone.required)) {
          issues.push(
            `layouts/${layout.id} → must declare required zone "${required}" for visual-types/${visualType.id}`
          );
        }
      }
    }
  }

  for (const layout of registry.layouts.values()) {
    requireRefs(
      layout.suitable_visual_types,
      visualTypeIds,
      `layouts/${layout.id} → suitable_visual_types`,
      issues
    );
  }

  if (countryIds.size === 0) issues.push("at least one country is required");
}

export type LoadOptions = {
  /** Override the data root. Used by tests that load fixture datasets. */
  readonly root?: string;
};

/**
 * Load, validate and cross-check every reference dataset.
 * Throws DatasetValidationError listing every problem found — never partial.
 */
export function loadDatasets(options: LoadOptions = {}): DatasetRegistry {
  const root = options.root ?? DATA_ROOT;
  const issues: Collector = [];

  const rawVersion = readFileSync(join(root, "VERSION"), "utf8").trim();
  const versionResult = DatasetVersion.safeParse(rawVersion);
  if (!versionResult.success) {
    issues.push(`VERSION → "${rawVersion}" is not a valid dataset version (expected e.g. 2026.09.0)`);
  }

  const countries = loadCollection(
    join(root, "countries"),
    CountryDNA,
    SCHEMA_VERSIONS.country,
    "countries",
    issues
  );
  const movements = loadCollection(
    join(root, "movements"),
    DesignMovement,
    SCHEMA_VERSIONS.movement,
    "movements",
    issues
  );
  const industries = loadCollection(
    join(root, "industries"),
    IndustryDNA,
    SCHEMA_VERSIONS.industry,
    "industries",
    issues
  );
  const visualTypes = loadCollection(
    join(root, "visual-types"),
    VisualType,
    SCHEMA_VERSIONS.visualType,
    "visual-types",
    issues
  );
  const layouts = loadCollection(
    join(root, "layouts"),
    LayoutSystem,
    SCHEMA_VERSIONS.layout,
    "layouts",
    issues
  );

  const lexicons = loadCollection(
    join(root, "lexicons"),
    ConceptLexicon,
    SCHEMA_VERSIONS.lexicon,
    "lexicons",
    issues
  );

  const registry: DatasetRegistry = {
    version: versionResult.success ? versionResult.data : "0000.00.0",
    countries,
    movements,
    industries,
    visualTypes,
    layouts,
    lexicons
  };

  if (issues.length === 0) checkReferentialIntegrity(registry, issues);

  if (issues.length > 0) throw new DatasetValidationError(issues);

  return registry;
}

/** Counts per collection, for reporting from the validation script. */
export function summariseDatasets(registry: DatasetRegistry): Record<string, number> {
  return {
    countries: registry.countries.size,
    movements: registry.movements.size,
    industries: registry.industries.size,
    visualTypes: registry.visualTypes.size,
    layouts: registry.layouts.size,
    lexicons: registry.lexicons.size
  };
}
