/**
 * Schema version registry.
 *
 * Every artifact and every dataset entry pins the version of the schema that
 * produced it. Readers use these to select an upcaster chain.
 *
 * Rules:
 *  - additive, optional field ....... minor bump
 *  - field removed or retyped ....... major bump
 *  - wording/description only ....... no bump
 *
 * Never edit a version in place to "fix" data. Bump and write an upcaster.
 */
export const SCHEMA_VERSIONS = {
  // reference datasets
  country: "1.0.0",
  movement: "1.1.0",
  industry: "1.0.0",
  visualType: "1.0.0",
  layout: "1.0.0",
  lexicon: "1.0.0",
  // artifacts
  brand: "1.0.0",
  brief: "1.0.0",
  contract: "1.0.0",
  direction: "1.0.0",
  recipe: "1.0.0",
  concept: "1.0.0",
  // P2.10 — Layout Blueprint. A derived, deterministic, content-hashed artifact
  // (ADR 0004 § P2.10). Additive: nothing upstream reads it.
  layoutBlueprint: "1.0.0"
} as const;

export type SchemaKey = keyof typeof SCHEMA_VERSIONS;

/** Qualified version tag stored on artifacts, e.g. "contract@1.0.0". */
export function schemaTag(key: SchemaKey): string {
  return `${key}@${SCHEMA_VERSIONS[key]}`;
}

/**
 * Upcaster registry.
 * When contract@2.0.0 lands, register { from: "1.0.0", to: "2.0.0", up } here
 * and the read path will migrate in memory without rewriting stored rows.
 */
export type Upcaster = {
  readonly key: SchemaKey;
  readonly from: string;
  readonly to: string;
  readonly up: (payload: unknown) => unknown;
};

export const UPCASTERS: readonly Upcaster[] = [
  {
    // P7 — movement@1.1.0 adds the optional `aliases` array. Older payloads are
    // valid as-is with an empty list; the field default handles it, so this is
    // an identity migration kept for a complete, auditable version chain.
    key: "movement",
    from: "1.0.0",
    to: "1.1.0",
    up: (payload) =>
      payload !== null && typeof payload === "object" && !Array.isArray(payload)
        ? { aliases: [], ...(payload as Record<string, unknown>), schema_version: "1.1.0" }
        : payload
  }
];
