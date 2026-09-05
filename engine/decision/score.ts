import type { DatasetRegistry } from "../../types/datasets";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type {
  Candidate,
  DimensionScore,
  ScoreDimension,
  ScoreRule,
  ScoredCandidate
} from "../../types/schemas/direction.schema";
import type { ZoneId } from "../../types/schemas/reference/layout.schema";
import { clampRatio, round } from "../dkv/params";
import type { ResolvedCountry } from "../country/blend";
import { blendScalar } from "../country/blend";

/**
 * Deterministic candidate scoring.
 *
 * Weights are fixed by the P1 specification and sum to 1. Every rule inside a
 * dimension declares the share of that dimension it can contribute, and those
 * shares also sum to 1 — so a dimension's raw score is always 0..1 and can be
 * read as "how much of what this dimension wanted did the candidate deliver".
 *
 * There are no unnamed constants here. Every threshold is a named export or a
 * documented literal, because a scoring system nobody can argue with is a
 * scoring system nobody can trust.
 */

export const SCORING_VERSION = "1.0.0";

export const SCORE_WEIGHTS: Record<ScoreDimension, number> = {
  communication_fit: 0.25,
  industry_fit: 0.15,
  audience_fit: 0.15,
  brand_fit: 0.15,
  culture_fit: 0.1,
  movement_fit: 0.1,
  platform_fit: 0.05,
  distinctiveness: 0.05
};

/** 1 when identical, 0 when maximally apart. The workhorse of every fit rule. */
export const closeness = (a: number, b: number): number => clampRatio(1 - Math.abs(a - b));

type RuleOutcome = { readonly matched: ScoreRule[]; readonly failed: ScoreRule[]; readonly raw: number };

class DimensionBuilder {
  private readonly matched: ScoreRule[] = [];
  private readonly failed: ScoreRule[] = [];
  private total = 0;

  constructor(private readonly dimension: ScoreDimension) {}

  /** Award `share × quality` and record why. Anything below PASS_MARK is a failed rule. */
  add(id: string, share: number, quality: number, detail: string): void {
    const delta = round(share * clampRatio(quality));
    this.total += delta;
    const rule: ScoreRule = { id, dimension: this.dimension, detail, delta };
    if (quality >= PASS_MARK) this.matched.push(rule);
    else this.failed.push(rule);
  }

  build(): RuleOutcome {
    return { matched: this.matched, failed: this.failed, raw: round(clampRatio(this.total)) };
  }
}

/** Below this a rule is reported as failed rather than matched. */
export const PASS_MARK = 0.5;

type Context = {
  readonly contract: DesignContract;
  readonly datasets: DatasetRegistry;
  readonly countries: readonly ResolvedCountry[];
};

const zoneIds = (candidate: Candidate, ctx: Context): ZoneId[] =>
  ctx.datasets.layouts.get(candidate.layout_id)?.zones.map((zone) => zone.id) ?? [];

/** Zones each objective needs in order to do its job at all. */
export const OBJECTIVE_ZONE_NEEDS: Record<string, ZoneId[]> = {
  awareness: ["hero", "image"],
  consideration: ["body", "image"],
  conversion: ["cta", "offer"],
  launch: ["hero", "product"],
  promotion: ["offer", "cta"],
  education: ["body", "data"],
  trust: ["body", "brand"],
  "brand-building": ["brand", "hero"],
  recruitment: ["body", "cta"],
  event: ["headline", "data"]
};

/** Focal and hierarchy pressure each objective applies, 0..1. */
export const OBJECTIVE_DEMANDS: Record<string, { focal: number; hierarchy: number }> = {
  awareness: { focal: 0.85, hierarchy: 0.7 },
  consideration: { focal: 0.6, hierarchy: 0.7 },
  conversion: { focal: 0.75, hierarchy: 0.85 },
  launch: { focal: 0.85, hierarchy: 0.75 },
  promotion: { focal: 0.8, hierarchy: 0.85 },
  education: { focal: 0.5, hierarchy: 0.8 },
  trust: { focal: 0.6, hierarchy: 0.75 },
  "brand-building": { focal: 0.75, hierarchy: 0.65 },
  recruitment: { focal: 0.6, hierarchy: 0.7 },
  event: { focal: 0.7, hierarchy: 0.8 }
};

function communicationFit(candidate: Candidate, ctx: Context): RuleOutcome {
  const builder = new DimensionBuilder("communication_fit");
  const movement = ctx.datasets.movements.get(candidate.movement_id);
  const objective = ctx.contract.objective;
  const zones = zoneIds(candidate, ctx);

  const supportsObjective = movement?.suitable_objectives.includes(objective) ?? false;
  builder.add(
    "comm.movement_declares_objective",
    0.35,
    supportsObjective ? 1 : 0,
    supportsObjective
      ? `${candidate.movement_name} declares support for objective "${objective}".`
      : `${candidate.movement_name} does not declare support for objective "${objective}".`
  );

  const needed = OBJECTIVE_ZONE_NEEDS[objective] ?? [];
  const present = needed.filter((zone) => zones.includes(zone));
  builder.add(
    "comm.layout_carries_required_zones",
    0.3,
    needed.length === 0 ? 1 : present.length / needed.length,
    needed.length === 0
      ? `Objective "${objective}" imposes no zone requirement.`
      : `${candidate.layout_name} carries ${present.length} of ${needed.length} zones needed by "${objective}" (${needed.join(", ")}).`
  );

  const demand = OBJECTIVE_DEMANDS[objective] ?? { focal: 0.7, hierarchy: 0.7 };
  const focalFit = closeness(candidate.bias.focal_dominance ?? 0.6, demand.focal);
  const hierarchyFit = closeness(candidate.bias.hierarchy_strength ?? 0.6, demand.hierarchy);
  builder.add(
    "comm.focal_and_hierarchy_pressure",
    0.2,
    (focalFit + hierarchyFit) / 2,
    `Objective "${objective}" wants focal ${demand.focal} and hierarchy ${demand.hierarchy}; candidate offers ${round(candidate.bias.focal_dominance ?? 0.6)} and ${round(candidate.bias.hierarchy_strength ?? 0.6)}.`
  );

  // Every mandatory has to physically land somewhere on the surface.
  const textZones = zones.filter((zone) =>
    ["headline", "body", "offer", "cta", "data"].includes(zone)
  ).length;
  const load = ctx.contract.constraints.filter((c) => c.kind === "must").length;
  const capacity = load === 0 ? 1 : clampRatio(textZones / Math.max(1, Math.ceil(load / 2)));
  builder.add(
    "comm.message_capacity",
    0.15,
    capacity,
    `${load} mandatory element(s) against ${textZones} text-bearing zone(s) in ${candidate.layout_name}.`
  );

  return builder.build();
}

function industryFit(candidate: Candidate, ctx: Context): RuleOutcome {
  const builder = new DimensionBuilder("industry_fit");
  const industry = ctx.datasets.industries.get(ctx.contract.industry.id);
  const layout = ctx.datasets.layouts.get(candidate.layout_id);
  if (!industry) return builder.build();

  const preferred = industry.preferred_movements.includes(candidate.movement_id);
  builder.add(
    "ind.preferred_movement",
    0.35,
    preferred ? 1 : 0,
    preferred
      ? `${industry.name} lists ${candidate.movement_name} among its preferred movements.`
      : `${industry.name} does not list ${candidate.movement_name} as preferred.`
  );

  const contrast = candidate.bias.contrast ?? 0.6;
  const meetsContrast = contrast >= industry.dkv_floor.contrast;
  builder.add(
    "ind.contrast_floor",
    0.2,
    meetsContrast ? 1 : closeness(contrast, industry.dkv_floor.contrast),
    `${industry.name} requires contrast ≥ ${industry.dkv_floor.contrast}; candidate proposes ${round(contrast)}.`
  );

  const density = candidate.bias.visual_density ?? 0.5;
  const meetsDensity = density <= industry.dkv_ceiling.visual_density;
  builder.add(
    "ind.density_ceiling",
    0.2,
    meetsDensity ? 1 : closeness(density, industry.dkv_ceiling.visual_density),
    `${industry.name} caps visual density at ${industry.dkv_ceiling.visual_density}; candidate proposes ${round(density)}.`
  );

  builder.add(
    "ind.information_pressure",
    0.25,
    closeness(layout?.density ?? 0.5, industry.information_pressure),
    `${industry.name} carries information pressure ${industry.information_pressure}; ${candidate.layout_name} has density ${layout?.density ?? 0.5}.`
  );

  return builder.build();
}

/** What each attention context demands of focal dominance and density. */
export const ATTENTION_DEMANDS: Record<string, { focal: number; density: number }> = {
  scroll: { focal: 0.85, density: 0.35 },
  search: { focal: 0.65, density: 0.5 },
  dwell: { focal: 0.6, density: 0.6 },
  captive: { focal: 0.55, density: 0.7 }
};

function audienceFit(candidate: Candidate, ctx: Context): RuleOutcome {
  const builder = new DimensionBuilder("audience_fit");
  const audience = ctx.contract.audience;
  const layout = ctx.datasets.layouts.get(candidate.layout_id);
  const zones = zoneIds(candidate, ctx);

  const demand = ATTENTION_DEMANDS[audience.attention_context] ?? { focal: 0.7, density: 0.5 };
  const focalFit = closeness(candidate.bias.focal_dominance ?? 0.6, demand.focal);
  const densityFit = closeness(candidate.bias.visual_density ?? 0.5, demand.density);
  builder.add(
    "aud.attention_context",
    0.4,
    (focalFit + densityFit) / 2,
    `A "${audience.attention_context}" audience wants focal ${demand.focal} and density ${demand.density}.`
  );

  // Sophisticated audiences tolerate — and reward — more compositional complexity.
  builder.add(
    "aud.sophistication_vs_complexity",
    0.3,
    closeness(layout?.complexity ?? 0.5, audience.sophistication),
    `Audience sophistication ${audience.sophistication} against ${candidate.layout_name} complexity ${layout?.complexity ?? 0.5}.`
  );

  const priceLed = audience.price_sensitivity >= 0.5;
  const hasOffer = zones.includes("offer") || zones.includes("cta");
  builder.add(
    "aud.price_sensitivity",
    0.3,
    priceLed ? (hasOffer ? 1 : 0.2) : hasOffer ? 0.7 : 1,
    priceLed
      ? `Price sensitivity ${audience.price_sensitivity} needs a visible offer or CTA zone; ${candidate.layout_name} ${hasOffer ? "has one" : "has none"}.`
      : `Price sensitivity ${audience.price_sensitivity} does not demand an offer zone.`
  );

  return builder.build();
}

function brandFit(candidate: Candidate, ctx: Context): RuleOutcome {
  const builder = new DimensionBuilder("brand_fit");
  const brand = ctx.contract.brand;
  const movement = ctx.datasets.movements.get(candidate.movement_id);
  if (!brand || !movement) return builder.build();

  const preferred = brand.preferred_movements.includes(candidate.movement_id);
  builder.add(
    "brand.preferred_movement",
    0.4,
    preferred ? 1 : 0.25,
    preferred
      ? `${brand.name} lists ${candidate.movement_name} among its preferred movements.`
      : `${brand.name} expresses no preference for ${candidate.movement_name}.`
  );

  // Grid discipline is the closest measurable proxy for brand formality.
  builder.add(
    "brand.formality_vs_structure",
    0.3,
    closeness(movement.grid.modularity, brand.formality),
    `${brand.name} formality ${brand.formality} against ${candidate.movement_name} modularity ${movement.grid.modularity}.`
  );

  const brandPalette = brand.palette.length;
  builder.add(
    "brand.palette_size",
    0.3,
    closeness(clampRatio(brandPalette / 8), clampRatio(movement.color.palette_size / 8)),
    `${brand.name} carries ${brandPalette} palette roles; ${candidate.movement_name} works in ${movement.color.palette_size}.`
  );

  return builder.build();
}

function cultureFit(candidate: Candidate, ctx: Context): RuleOutcome {
  const builder = new DimensionBuilder("culture_fit");
  const movement = ctx.datasets.movements.get(candidate.movement_id);
  if (ctx.countries.length === 0 || !movement) return builder.build();

  const whitespace = blendScalar(ctx.countries, (c) => c.composition.whitespace_bias);
  const density = blendScalar(ctx.countries, (c) => c.composition.density_bias);

  builder.add(
    "cul.whitespace_behaviour",
    0.3,
    closeness(candidate.bias.whitespace ?? 0.5, whitespace),
    `Country blend leans to whitespace ${whitespace}; candidate proposes ${round(candidate.bias.whitespace ?? 0.5)}.`
  );
  builder.add(
    "cul.density_behaviour",
    0.3,
    closeness(candidate.bias.visual_density ?? 0.5, density),
    `Country blend leans to density ${density}; candidate proposes ${round(candidate.bias.visual_density ?? 0.5)}.`
  );

  const dominant = [...ctx.countries].sort((a, b) =>
    b.weight === a.weight ? a.country.id.localeCompare(b.country.id) : b.weight - a.weight
  )[0];
  const symmetry = dominant?.country.composition.symmetry ?? "mixed";
  const symmetryMatch =
    (symmetry === "asymmetric" && candidate.composition_strategy === "asymmetric-editorial") ||
    (symmetry === "symmetric" && candidate.composition_strategy === "centred-frontal") ||
    symmetry === "mixed";
  builder.add(
    "cul.symmetry_behaviour",
    0.2,
    symmetryMatch ? 1 : 0.3,
    `${dominant?.country.name ?? "Blend"} composes ${symmetry}; strategy is ${candidate.composition_strategy}.`
  );

  const countryWeight = dominant?.country.typography.weight_bias ?? "mixed";
  const movementWeight = movement.typography.weight_bias;
  const weightMatch =
    countryWeight === movementWeight || countryWeight === "mixed" || movementWeight === "mixed";
  builder.add(
    "cul.typographic_weight",
    0.2,
    weightMatch ? 1 : 0.4,
    `${dominant?.country.name ?? "Blend"} favours ${countryWeight} type; ${candidate.movement_name} favours ${movementWeight}.`
  );

  return builder.build();
}

/** Widest column count treated as fully modular when normalising a grid. */
export const MAX_COLUMNS = 12;

function movementFit(candidate: Candidate, ctx: Context): RuleOutcome {
  const builder = new DimensionBuilder("movement_fit");
  const movement = ctx.datasets.movements.get(candidate.movement_id);
  const layout = ctx.datasets.layouts.get(candidate.layout_id);
  if (!movement || !layout) return builder.build();

  const columnFit = closeness(
    clampRatio(layout.grid.columns / MAX_COLUMNS),
    movement.grid.modularity
  );
  builder.add(
    "mov.grid_agreement",
    0.4,
    columnFit,
    `${candidate.movement_name} modularity ${movement.grid.modularity} against a ${layout.grid.columns}-column layout.`
  );

  const shared = Object.keys(movement.dkv_bias).filter(
    (key) => key in layout.dkv_bias
  ) as (keyof typeof movement.dkv_bias)[];
  const agreement =
    shared.length === 0
      ? 0.6
      : shared.reduce(
          (total, key) => total + closeness(movement.dkv_bias[key] ?? 0, layout.dkv_bias[key] ?? 0),
          0
        ) / shared.length;
  builder.add(
    "mov.parameter_agreement",
    0.6,
    agreement,
    shared.length === 0
      ? `${candidate.movement_name} and ${candidate.layout_name} express no overlapping parameters.`
      : `${candidate.movement_name} and ${candidate.layout_name} agree on ${shared.length} shared parameter(s) at ${round(agreement)}.`
  );

  return builder.build();
}

function platformFit(candidate: Candidate, ctx: Context): RuleOutcome {
  const builder = new DimensionBuilder("platform_fit");
  const visualType = ctx.datasets.visualTypes.get(ctx.contract.visual_type.id);
  const zones = zoneIds(candidate, ctx);
  if (!visualType) return builder.build();

  const required = visualType.dkv_bias.focal_dominance ?? 0.7;
  const focal = candidate.bias.focal_dominance ?? 0.6;
  builder.add(
    "plat.focal_requirement",
    0.35,
    focal >= required - 0.1 ? 1 : closeness(focal, required),
    `${visualType.name} expects focal dominance near ${required}; candidate offers ${round(focal)}.`
  );

  const textZones = zones.filter((zone) =>
    ["headline", "body", "offer", "cta", "data"].includes(zone)
  ).length;
  const risk = visualType.text_render_risk;
  const tolerable = Math.max(1, Math.round((1 - risk) * visualType.structural_rules.max_text_blocks));
  builder.add(
    "plat.text_render_risk",
    0.35,
    textZones <= tolerable ? 1 : clampRatio(tolerable / textZones),
    `Text render risk ${risk} tolerates about ${tolerable} text zone(s); ${candidate.layout_name} carries ${textZones}.`
  );

  const thumbnail = ctx.contract.platform.viewing_context === "thumb";
  const contrast = candidate.bias.contrast ?? 0.6;
  builder.add(
    "plat.viewing_distance",
    0.3,
    thumbnail ? (contrast >= 0.6 ? 1 : closeness(contrast, 0.6)) : 1,
    thumbnail
      ? `Thumbnail viewing needs contrast ≥ 0.6; candidate proposes ${round(contrast)}.`
      : `Viewing context "${ctx.contract.platform.viewing_context}" imposes no thumbnail contrast floor.`
  );

  return builder.build();
}

function distinctiveness(candidate: Candidate, ctx: Context): RuleOutcome {
  const builder = new DimensionBuilder("distinctiveness");
  const industry = ctx.datasets.industries.get(ctx.contract.industry.id);
  const visualType = ctx.datasets.visualTypes.get(ctx.contract.visual_type.id);

  const obviousMovement = industry?.preferred_movements[0] === candidate.movement_id;
  const obviousLayout = visualType?.default_layouts[0] === candidate.layout_id;
  const typicality = (obviousMovement ? 0.5 : 0) + (obviousLayout ? 0.5 : 0);

  builder.add(
    "dist.departure_from_default",
    1,
    1 - typicality,
    `Typicality ${typicality}: ${obviousMovement ? "is" : "is not"} the industry's first-listed movement and ${obviousLayout ? "is" : "is not"} the visual type's first-listed layout.`
  );

  return builder.build();
}

const SCORERS: Record<ScoreDimension, (candidate: Candidate, ctx: Context) => RuleOutcome> = {
  communication_fit: communicationFit,
  industry_fit: industryFit,
  audience_fit: audienceFit,
  brand_fit: brandFit,
  culture_fit: cultureFit,
  movement_fit: movementFit,
  platform_fit: platformFit,
  distinctiveness: distinctiveness
};

/**
 * Score one candidate.
 *
 * A dimension with no evidence — brand fit with no brand supplied — is marked
 * inapplicable and its weight is redistributed proportionally across the rest.
 * Scoring it 0.5 instead would quietly pull every candidate toward the middle
 * and pretend the system knows something it does not.
 */
export function scoreCandidate(
  candidate: Candidate,
  contract: DesignContract,
  datasets: DatasetRegistry,
  countries: readonly ResolvedCountry[]
): ScoredCandidate {
  const ctx: Context = { contract, datasets, countries };
  const matched: ScoreRule[] = [];
  const failed: ScoreRule[] = [];

  const applicable: Record<ScoreDimension, boolean> = {
    communication_fit: true,
    industry_fit: true,
    audience_fit: true,
    brand_fit: contract.brand !== null,
    culture_fit: countries.length > 0,
    movement_fit: true,
    platform_fit: true,
    distinctiveness: true
  };

  const applicableWeight = (Object.keys(SCORE_WEIGHTS) as ScoreDimension[])
    .filter((dimension) => applicable[dimension])
    .reduce((total, dimension) => total + SCORE_WEIGHTS[dimension], 0);

  const breakdown: DimensionScore[] = [];
  let total = 0;

  for (const dimension of Object.keys(SCORE_WEIGHTS) as ScoreDimension[]) {
    const isApplicable = applicable[dimension];
    const outcome = isApplicable
      ? SCORERS[dimension](candidate, ctx)
      : { matched: [], failed: [], raw: 0 };
    const weight = isApplicable ? round(SCORE_WEIGHTS[dimension] / applicableWeight) : 0;
    const weighted = round(outcome.raw * weight);

    breakdown.push({ dimension, raw: outcome.raw, weight, weighted, applicable: isApplicable });
    matched.push(...outcome.matched);
    failed.push(...outcome.failed);
    total += weighted;
  }

  return {
    candidate,
    total_score: round(clampRatio(total)),
    score_breakdown: breakdown,
    matched_rules: matched,
    failed_rules: failed
  };
}

/**
 * Score and rank every candidate.
 *
 * Ties break on candidate_id, never on input order — property test §13.2
 * depends on this and so does anyone trying to reproduce a result.
 */
export function scoreCandidates(
  candidates: readonly Candidate[],
  contract: DesignContract,
  datasets: DatasetRegistry,
  countries: readonly ResolvedCountry[]
): ScoredCandidate[] {
  return candidates
    .map((candidate) => scoreCandidate(candidate, contract, datasets, countries))
    .sort((a, b) =>
      b.total_score === a.total_score
        ? a.candidate.candidate_id.localeCompare(b.candidate.candidate_id)
        : b.total_score - a.total_score
    );
}
