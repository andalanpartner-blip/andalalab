import type { DatasetRegistry } from "../../types/datasets";
import type { DesignContract } from "../../types/schemas/contract.schema";
import type { DesignDirection } from "../../types/schemas/direction.schema";
import type {
  ConceptProposal,
  ConceptScore,
  ConceptScoreDimension,
  DiversityVector
} from "../../types/schemas/concept.schema";
import { ABSTRACTION_ORDER } from "../../types/schemas/concept.schema";
import { clampRatio, round } from "../dkv/params";
import { closeness } from "../decision/score";
import { CONCEPT_SCORE_WEIGHTS } from "./config";
import { pairwiseConceptDistance } from "./diversity";

/**
 * Deterministic concept scoring.
 *
 * The model may attach a `self_score`; it is carried as advisory metadata and
 * never used. A model scoring its own output is a model grading its own
 * homework, and the whole doctrine of this system is that the engine decides.
 */

/** Concept types that serve each objective well. Doctrine rank 1 drives the largest weight. */
export const OBJECTIVE_CONCEPT_FIT: Record<string, string[]> = {
  awareness: ["visual_metaphor", "unexpected_juxtaposition", "minimal_statement", "brand_world"],
  consideration: ["editorial_narrative", "product_hero", "data_information", "transformation"],
  conversion: ["product_hero", "contrast", "data_information", "minimal_statement"],
  launch: ["product_hero", "transformation", "brand_world", "visual_metaphor"],
  promotion: ["contrast", "minimal_statement", "product_hero", "data_information"],
  education: ["data_information", "editorial_narrative", "transformation", "contrast"],
  trust: ["human_story", "editorial_narrative", "data_information", "brand_world"],
  "brand-building": ["brand_world", "cultural_reinterpretation", "human_story", "visual_metaphor"],
  recruitment: ["human_story", "lifestyle_aspiration", "editorial_narrative", "brand_world"],
  event: ["minimal_statement", "unexpected_juxtaposition", "contrast", "brand_world"]
};

/** Concept types each industry is usually well served by. */
export const INDUSTRY_CONCEPT_FIT: Record<string, string[]> = {
  fnb: ["product_hero", "human_story", "cultural_reinterpretation", "lifestyle_aspiration"],
  fashion: ["editorial_narrative", "lifestyle_aspiration", "visual_metaphor", "brand_world"],
  property: ["data_information", "transformation", "brand_world", "editorial_narrative"],
  "beauty-skincare": ["product_hero", "transformation", "minimal_statement", "human_story"],
  "technology-saas": ["data_information", "transformation", "contrast", "minimal_statement"],
  hospitality: ["human_story", "lifestyle_aspiration", "editorial_narrative", "brand_world"]
};

/** Production load per feature. Higher is harder to actually shoot or build. */
const PRODUCTION_LOAD: Record<string, number> = {
  crowd: 0.9,
  central: 0.6,
  partial: 0.4,
  implied: 0.2,
  none: 0.1,
  sequence: 0.8,
  "before-after": 0.7,
  documentary: 0.6,
  "layered-depth": 0.7,
  "wide-context": 0.6,
  "grid-of-parts": 0.5
};

type Context = {
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly datasets: DatasetRegistry;
};

type Dimension = { raw: number; detail: string };

function strategicRelevance(proposal: ConceptProposal, ctx: Context): Dimension {
  const favoured = OBJECTIVE_CONCEPT_FIT[ctx.contract.objective] ?? [];
  const rank = favoured.indexOf(proposal.type);
  const raw = rank < 0 ? 0.35 : 1 - rank * 0.15;
  return {
    raw: clampRatio(raw),
    detail:
      rank < 0
        ? `"${proposal.type}" is not a listed fit for objective "${ctx.contract.objective}".`
        : `"${proposal.type}" is fit #${rank + 1} for objective "${ctx.contract.objective}".`
  };
}

function audienceRelevance(proposal: ConceptProposal, ctx: Context): Dimension {
  const audience = ctx.contract.audience;
  const abstraction = ABSTRACTION_ORDER.indexOf(proposal.abstraction_level) / 3;
  // Sophisticated audiences reward abstraction; general ones need it literal.
  const abstractionFit = closeness(abstraction, audience.sophistication);
  const humanFit =
    proposal.human_presence === "none" && audience.attention_context === "scroll" ? 0.6 : 1;
  return {
    raw: clampRatio(0.7 * abstractionFit + 0.3 * humanFit),
    detail: `Abstraction ${round(abstraction)} against audience sophistication ${audience.sophistication}; human presence "${proposal.human_presence}".`
  };
}

function industryFit(proposal: ConceptProposal, ctx: Context): Dimension {
  const favoured = INDUSTRY_CONCEPT_FIT[ctx.contract.industry.id] ?? [];
  const industry = ctx.datasets.industries.get(ctx.contract.industry.id);
  const listed = favoured.includes(proposal.type);
  const informationFit = industry
    ? closeness(
        proposal.type === "data_information" ? 0.9 : 0.5,
        industry.information_pressure
      )
    : 0.5;
  return {
    raw: clampRatio(0.7 * (listed ? 1 : 0.4) + 0.3 * informationFit),
    detail: listed
      ? `"${proposal.type}" is a listed fit for ${ctx.contract.industry.id}.`
      : `"${proposal.type}" is not a listed fit for ${ctx.contract.industry.id}.`
  };
}

function brandFit(proposal: ConceptProposal, ctx: Context): Dimension | null {
  const brand = ctx.contract.brand;
  if (!brand) return null;
  const restrained = ["calm", "reverent", "austere", "confident"].includes(
    proposal.emotional_direction
  );
  const fit = closeness(restrained ? 0.8 : 0.35, brand.formality);
  return {
    raw: clampRatio(fit),
    detail: `Emotional direction "${proposal.emotional_direction}" against brand formality ${brand.formality}.`
  };
}

function originality(
  vector: DiversityVector,
  siblings: readonly DiversityVector[],
  ctx: Context
): Dimension {
  const others = siblings.filter((entry) => entry !== vector);
  const mean =
    others.length === 0
      ? 0.6
      : others.reduce((sum, other) => sum + pairwiseConceptDistance(vector, other).total, 0) /
        others.length;

  const favoured = INDUSTRY_CONCEPT_FIT[ctx.contract.industry.id] ?? [];
  // Being the industry's most obvious concept type costs a little originality.
  const obvious = favoured[0] === vector.concept_type ? 0.15 : 0;

  return {
    raw: clampRatio(Math.min(1, mean / 0.6) - obvious),
    detail: `Mean distance to the other concepts is ${round(mean)}${obvious > 0 ? "; it is also the industry's most obvious type" : ""}.`
  };
}

function visualPotential(specificity: number): Dimension {
  return {
    raw: clampRatio(specificity),
    detail: `Specificity score ${specificity} — how much concrete material a designer could work from.`
  };
}

function culturalCoherence(proposal: ConceptProposal, ctx: Context): Dimension {
  const blend = Object.entries(ctx.contract.country).sort((a, b) => b[1] - a[1]);
  const dominant = blend[0];
  const minority = blend[1];
  if (!dominant) return { raw: 0.5, detail: "No country influence recorded." };

  const text = `${proposal.visual_metaphor} ${proposal.visual_world}`.toLowerCase();
  const dominantCountry = ctx.datasets.countries.get(dominant[0]);
  const minorityCountry = minority ? ctx.datasets.countries.get(minority[0]) : null;

  // A concept that finds room for the minority influence is rewarded, because
  // the dimension-ownership rule in P1 otherwise erases it entirely.
  const namesMinority =
    minorityCountry !== null &&
    minorityCountry !== undefined &&
    text.includes(minorityCountry.name.toLowerCase());

  const namesDominant = dominantCountry
    ? text.includes(dominantCountry.name.toLowerCase())
    : false;

  return {
    raw: clampRatio(0.6 + (namesMinority ? 0.25 : 0) + (namesDominant ? 0.15 : 0)),
    detail: minorityCountry
      ? `${minorityCountry.name} at ${minority?.[1]} is ${namesMinority ? "carried" : "not carried"} by the concept text.`
      : `Single-country influence (${dominantCountry?.name ?? dominant[0]}).`
  };
}

function platformSuitability(proposal: ConceptProposal, ctx: Context): Dimension {
  const thumbnail = ctx.contract.platform.viewing_context === "thumb";
  const legible =
    proposal.composition_intent === "single-object-focus" ||
    proposal.composition_intent === "typographic-field" ||
    proposal.composition_intent === "figure-in-environment";
  return {
    raw: clampRatio(thumbnail ? (legible ? 1 : 0.5) : 0.9),
    detail: thumbnail
      ? `Thumbnail viewing favours a single readable focus; intent is "${proposal.composition_intent}".`
      : `Viewing context "${ctx.contract.platform.viewing_context}" is forgiving of complexity.`
  };
}

function productionFeasibility(proposal: ConceptProposal): Dimension {
  const load = Math.max(
    PRODUCTION_LOAD[proposal.human_presence] ?? 0.3,
    PRODUCTION_LOAD[proposal.narrative_strategy] ?? 0.3,
    PRODUCTION_LOAD[proposal.composition_intent] ?? 0.3
  );
  return {
    raw: clampRatio(1 - load * 0.6),
    detail: `Heaviest production feature scores ${round(load)} on load.`
  };
}

export function scoreConcept(input: {
  readonly proposal: ConceptProposal;
  readonly vector: DiversityVector;
  readonly siblings: readonly DiversityVector[];
  readonly specificity: number;
  readonly contract: DesignContract;
  readonly direction: DesignDirection;
  readonly datasets: DatasetRegistry;
}): ConceptScore {
  const ctx: Context = {
    contract: input.contract,
    direction: input.direction,
    datasets: input.datasets
  };

  const brand = brandFit(input.proposal, ctx);

  const dimensions: Record<ConceptScoreDimension, Dimension | null> = {
    strategic_relevance: strategicRelevance(input.proposal, ctx),
    audience_relevance: audienceRelevance(input.proposal, ctx),
    industry_fit: industryFit(input.proposal, ctx),
    brand_fit: brand,
    originality: originality(input.vector, input.siblings, ctx),
    visual_potential: visualPotential(input.specificity),
    cultural_coherence: culturalCoherence(input.proposal, ctx),
    platform_suitability: platformSuitability(input.proposal, ctx),
    production_feasibility: productionFeasibility(input.proposal)
  };

  // Inapplicable dimensions redistribute their weight, exactly as candidate
  // scoring does in P1 — scoring an absent brand at 0.5 would fake knowledge.
  const applicableWeight = (Object.keys(CONCEPT_SCORE_WEIGHTS) as ConceptScoreDimension[])
    .filter((dimension) => dimensions[dimension] !== null)
    .reduce((sum, dimension) => sum + CONCEPT_SCORE_WEIGHTS[dimension], 0);

  const breakdown = (Object.keys(CONCEPT_SCORE_WEIGHTS) as ConceptScoreDimension[]).map(
    (dimension) => {
      const entry = dimensions[dimension];
      const weight = entry ? round(CONCEPT_SCORE_WEIGHTS[dimension] / applicableWeight) : 0;
      return {
        dimension,
        raw: entry ? round(entry.raw) : 0,
        weight,
        weighted: entry ? round(entry.raw * weight) : 0,
        applicable: entry !== null,
        detail: entry ? entry.detail : "No brand supplied; weight redistributed."
      };
    }
  );

  return {
    total: round(clampRatio(breakdown.reduce((sum, entry) => sum + entry.weighted, 0))),
    breakdown,
    model_advisory: input.proposal.self_score ?? null
  };
}
