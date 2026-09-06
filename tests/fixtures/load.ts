import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDatasets } from "../../data/loader";
import { BrandSnapshot } from "../../types/schemas/brand.schema";
import { NormalizedBrief } from "../../types/schemas/brief.schema";
import { fixedClock } from "../../ports/clock.port";
import { sequentialIds } from "../../ports/id.port";
import { buildDesignContract } from "../../engine/contract/build";
import { buildDesignDirection } from "../../engine/decision/resolve";
import { buildDesignRecipe } from "../../engine/recipe/build";

const FIXTURE_ROOT = fileURLToPath(new URL(".", import.meta.url));

export const datasets = loadDatasets();

export const FIXED_TIME = "2026-09-04T09:00:00.000Z";
export const clock = fixedClock(FIXED_TIME);
export const newIds = () => sequentialIds();

export function loadBrief(name: string): NormalizedBrief {
  const raw = JSON.parse(readFileSync(join(FIXTURE_ROOT, "briefs", `${name}.json`), "utf8")) as unknown;
  return NormalizedBrief.parse(raw);
}

export function loadBrand(): BrandSnapshot {
  const raw = JSON.parse(readFileSync(join(FIXTURE_ROOT, "brand.json"), "utf8")) as unknown;
  return BrandSnapshot.parse(raw);
}

export const GOLDEN_BRIEFS = [
  "kopi-lawas-promotion",
  "hardstone-property-trust",
  "northbeam-saas-launch"
] as const;

/**
 * The full P1 fixture set: 15 briefs spanning every country, every industry,
 * both conflict scenarios and the country blend cases.
 *
 * `brutalist-trust-conflict` runs the real `healthcare` industry against a
 * pinned Brutalism movement; `luxury-density-conflict` runs the real `luxury`
 * industry under a six-mandatory information load against pinned Minimalism.
 * `wellness-studio-promo` exercises the third P7 industry. The structural
 * tension in each case — a trust-critical or restraint-critical industry
 * against the movement or the load that fights it — is what these test.
 */
export const P1_BRIEFS = [
  "kopi-lawas-promotion",
  "hardstone-property-trust",
  "northbeam-saas-launch",
  "tokyo-fashion-editorial",
  "helvetica-labs-swiss-tech",
  "cascade-house-hospitality",
  "brutalist-trust-conflict",
  "luxury-density-conflict",
  "wellness-studio-promo",
  "jakarta-tokyo-blend",
  "minimal-promo-cta",
  "type-led-fashion",
  "property-editorial",
  "tech-contemporary-digital",
  "warung-vernacular-promo"
] as const;

export type P1BriefName = (typeof P1_BRIEFS)[number];

/**
 * One brief per non-social-feed visual type (P7). Kept separate from
 * `P1_BRIEFS` so the doctrine-calibration set stays stable; these exist to
 * prove every visual type resolves end to end with the right ratio, zones and
 * safe area.
 */
export const VISUAL_TYPE_BRIEFS = [
  "story-skincare-launch",
  "tiktok-fnb-promo",
  "web-hero-saas-launch",
  "print-property-brochure",
  "ooh-hospitality-billboard"
] as const;

/** Build contract → direction → recipe for a fixture, failing loudly. */
export function pipeline(name: string) {
  const brief = loadBrief(name);
  const brand = brief.brand_id ? loadBrand() : null;
  const ids = sequentialIds();

  const contract = buildDesignContract({
    projectId: `proj_${name}`,
    brief,
    brand,
    datasets,
    clock,
    ids
  });
  if (!contract.ok) throw new Error(`${name} contract failed: ${JSON.stringify(contract.error, null, 2)}`);

  const direction = buildDesignDirection({
    projectId: `proj_${name}`,
    contract: contract.value,
    datasets,
    clock,
    ids
  });
  if (!direction.ok) throw new Error(`${name} direction failed: ${JSON.stringify(direction.error, null, 2)}`);

  const recipe = buildDesignRecipe({
    projectId: `proj_${name}`,
    contract: contract.value,
    direction: direction.value,
    datasets,
    clock,
    ids
  });
  if (!recipe.ok) throw new Error(`${name} recipe failed: ${JSON.stringify(recipe.error, null, 2)}`);

  return { brief, brand, contract: contract.value, direction: direction.value, recipe: recipe.value };
}
