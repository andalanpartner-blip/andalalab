/**
 * The design doctrine, as a precedence table rather than as prose.
 *
 * "If visual style conflicts with communication quality, communication wins"
 * is not a sentiment — it is a comparison between two integers. Every rule and
 * every constraint carries the rank of the layer that produced it, so the
 * Design Direction engine in P1 can resolve conflicts by arithmetic and then
 * report, in plain language, which rule beat which.
 */
export const DOCTRINE = [
  { rank: 1, id: "communication_objective", label: "Communication objective" },
  { rank: 2, id: "audience", label: "Audience" },
  { rank: 3, id: "industry_requirements", label: "Industry requirements" },
  { rank: 4, id: "brand_identity", label: "Brand identity" },
  { rank: 5, id: "dkv_fundamentals", label: "DKV fundamentals" },
  { rank: 6, id: "platform_constraints", label: "Platform constraints" },
  { rank: 7, id: "country_visual_dna", label: "Country visual DNA" },
  { rank: 8, id: "design_movement", label: "Design movement" },
  { rank: 9, id: "contemporary_trends", label: "Contemporary trends" },
  { rank: 10, id: "decorative_treatment", label: "Decorative treatment" }
] as const;

export type DoctrineLayerId = (typeof DOCTRINE)[number]["id"];
export type DoctrineRank = (typeof DOCTRINE)[number]["rank"];

const BY_ID = new Map(DOCTRINE.map((layer) => [layer.id, layer]));

export function rankOf(id: DoctrineLayerId): number {
  const layer = BY_ID.get(id);
  if (!layer) throw new Error(`unknown doctrine layer: ${id}`);
  return layer.rank;
}

export function labelOf(rank: number): string {
  return DOCTRINE.find((layer) => layer.rank === rank)?.label ?? `rank ${rank}`;
}

/** Lower rank wins. Returns the winning rank. */
export function resolveRank(a: number, b: number): number {
  return Math.min(a, b);
}
