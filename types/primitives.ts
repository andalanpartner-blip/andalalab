import { z } from "zod";

/**
 * Shared primitive schemas.
 *
 * Everything in the system is built from these. Keep them dumb and total —
 * no cross-file references, no dataset knowledge.
 */

/** A normalised 0..1 parameter. The spine of the DKV system. */
export const Ratio = z.number().min(0).max(1);
export type Ratio = z.infer<typeof Ratio>;

/** Lowercase kebab identifier used for every dataset entry. */
export const Slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase kebab-case slug");
export type Slug = z.infer<typeof Slug>;

/** Semantic version of a schema, e.g. "1.0.0". */
export const SemVer = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "must be a semver string like 1.0.0");
export type SemVer = z.infer<typeof SemVer>;

/** Dataset release, e.g. "2026.09.0". Pinned by every stored artifact. */
export const DatasetVersion = z
  .string()
  .regex(/^\d{4}\.\d{2}\.\d+$/, "must look like 2026.09.0");
export type DatasetVersion = z.infer<typeof DatasetVersion>;

export const NonEmptyText = z.string().trim().min(1);
export const Id = z.string().trim().min(1);
export const IsoDate = z.string().datetime();

/** A prose note. Long enough to be useful, short enough to stay curated. */
export const Note = z.string().trim().min(8).max(600);

/**
 * Builds a schema for a weight map whose values must sum to 1 (±tolerance).
 * Used for country dimension weights and country blends.
 */
export const WEIGHT_SUM_TOLERANCE = 0.001;

export function weightsSumToOne<
  Output extends Record<string, number>,
  Def extends z.ZodTypeDef,
  Input
>(schema: z.ZodType<Output, Def, Input>) {
  return schema.superRefine((value, ctx) => {
    const weights = Object.values(value);
    const sum = weights.reduce((total, weight) => total + weight, 0);
    if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `weights must sum to 1 (got ${sum.toFixed(4)})`
      });
    }
  });
}

/** Deterministic, dependency-free 32-bit FNV-1a hash. Not cryptographic. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Canonical JSON: object keys sorted recursively, so hashes are stable. */
export function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalise(entryValue)}`);
  return `{${entries.join(",")}}`;
}
