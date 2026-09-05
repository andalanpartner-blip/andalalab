import type { CountryDNA } from "../../types/schemas/reference/country.schema";
import type { CountryBlend } from "../../types/schemas/brief.schema";
import { round } from "../dkv/params";

export type ResolvedCountry = {
  readonly country: CountryDNA;
  readonly weight: number;
};

/** Normalise a blend so weights sum to exactly 1, preserving proportions. */
export function normaliseBlend(blend: CountryBlend): Record<string, number> {
  const entries = Object.entries(blend);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return {};
  return Object.fromEntries(entries.map(([id, weight]) => [id, round(weight / total)]));
}

/**
 * Blend a single scalar dimension across countries.
 *
 * Note the deliberate limitation: this averages one numeric bias. Blending the
 * *qualitative* dimensions by averaging would produce mush — 70/30 of two
 * spatial philosophies is not a philosophy. P1 assigns whole dimensions to a
 * dominant country using the per-country `weights` vector instead, which is why
 * that vector exists in the schema.
 */
export function blendScalar(
  resolved: readonly ResolvedCountry[],
  pick: (country: CountryDNA) => number
): number {
  if (resolved.length === 0) return 0;
  const total = resolved.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return 0;
  const weighted = resolved.reduce((sum, entry) => sum + pick(entry.country) * entry.weight, 0);
  return round(weighted / total);
}

/** The country with the highest weight. Ties resolve by id for determinism. */
export function dominantCountry(resolved: readonly ResolvedCountry[]): ResolvedCountry | null {
  if (resolved.length === 0) return null;
  return [...resolved].sort((a, b) =>
    b.weight === a.weight ? a.country.id.localeCompare(b.country.id) : b.weight - a.weight
  )[0] as ResolvedCountry;
}

/** The six dimensions a country influences, in a fixed order for determinism. */
export const COUNTRY_DIMENSIONS = [
  "composition",
  "typography",
  "color",
  "imagery",
  "materiality",
  "graphic_language"
] as const;
export type CountryDimensionKey = (typeof COUNTRY_DIMENSIONS)[number];

export type DimensionOwner = {
  readonly country_id: string;
  readonly country_name: string;
  /** blend weight × that country's own weight for this dimension. */
  readonly influence: number;
  /** True when the runner-up is within CONTEST_MARGIN — worth surfacing. */
  readonly contested: boolean;
};

/** Two owners this close are effectively tied; the recipe says so out loud. */
export const CONTEST_MARGIN = 0.05;

/**
 * Dimension-aware blending (P1 spec §7).
 *
 * Averaging every field across a 70/30 blend produces mush: 70% of one spatial
 * philosophy plus 30% of another is not a philosophy, it is a contradiction
 * with a decimal point. So each dimension is ASSIGNED to whichever country has
 * the strongest claim on it — blend weight multiplied by that country's own
 * declared weight for the dimension.
 *
 * The consequence is the useful part: a 70/30 Indonesia/Japan blend can hand
 * spatial behaviour to Indonesia and materiality to Japan, which is a real
 * design position rather than a smeared average of two.
 *
 * Ties break on country id so the result never depends on map ordering.
 */
export function blendDimensions(
  resolved: readonly ResolvedCountry[]
): Record<CountryDimensionKey, DimensionOwner> {
  const owners = {} as Record<CountryDimensionKey, DimensionOwner>;

  for (const dimension of COUNTRY_DIMENSIONS) {
    const claims = resolved
      .map((entry) => ({
        country_id: entry.country.id,
        country_name: entry.country.name,
        influence: round(entry.weight * entry.country.weights[dimension])
      }))
      .sort((a, b) =>
        b.influence === a.influence
          ? a.country_id.localeCompare(b.country_id)
          : b.influence - a.influence
      );

    const top = claims[0];
    if (!top) continue;
    const runnerUp = claims[1];
    owners[dimension] = {
      country_id: top.country_id,
      country_name: top.country_name,
      influence: top.influence,
      contested: runnerUp !== undefined && top.influence - runnerUp.influence <= CONTEST_MARGIN
    };
  }

  return owners;
}

/** The country that owns a dimension, as a full dataset entry. */
export function countryForDimension(
  resolved: readonly ResolvedCountry[],
  owners: Record<CountryDimensionKey, DimensionOwner>,
  dimension: CountryDimensionKey
): CountryDNA | null {
  const owner = owners[dimension];
  if (!owner) return dominantCountry(resolved)?.country ?? null;
  return resolved.find((entry) => entry.country.id === owner.country_id)?.country ?? null;
}
