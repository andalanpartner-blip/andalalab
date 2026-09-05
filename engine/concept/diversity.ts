import type { DatasetRegistry } from "../../types/datasets";
import type {
  ConceptProposal,
  DiversityVector
} from "../../types/schemas/concept.schema";
import { ABSTRACTION_ORDER } from "../../types/schemas/concept.schema";
import { round } from "../dkv/params";
import { DISTANCE_WEIGHTS, MIN_CONCEPT_DISTANCE } from "./config";
import { conceptLexicon, deriveMetaphorFamily, jaccard, lexicalSignature } from "./lexicon";

/**
 * Concept diversity.
 *
 * Three concepts that differ only in palette are one concept and two repaints.
 * The gate exists because a model asked for "three different concepts" will
 * happily produce exactly that and label them differently.
 *
 * Two defences. First, the lexical signature strips all styling vocabulary
 * before comparing, so a repaint has nowhere to hide. Second, the vector mixes
 * features the model declares with a feature the engine derives from the text —
 * declared labels alone could be gamed, deliberately or otherwise.
 */

/** The text that carries the idea. Styling lives elsewhere and is stripped anyway. */
const conceptText = (proposal: ConceptProposal): string =>
  [proposal.big_idea, proposal.creative_tension, proposal.visual_metaphor, proposal.visual_world].join(
    " "
  );

export function buildDiversityVector(
  proposal: ConceptProposal,
  datasets: DatasetRegistry
): DiversityVector {
  const lexicon = conceptLexicon(datasets);
  const text = conceptText(proposal);

  const abstractionIndex = ABSTRACTION_ORDER.indexOf(proposal.abstraction_level);

  return {
    concept_type: proposal.type,
    metaphor_family: lexicon
      ? deriveMetaphorFamily(proposal.visual_metaphor, lexicon)
      : "unclassified",
    subject_strategy: proposal.subject_strategy,
    narrative_strategy: proposal.narrative_strategy,
    composition_intent: proposal.composition_intent,
    emotional_strategy: proposal.emotional_direction,
    human_presence: proposal.human_presence,
    abstraction_level: round(
      abstractionIndex < 0 ? 0 : abstractionIndex / (ABSTRACTION_ORDER.length - 1)
    ),
    temporal_strategy: proposal.temporal_strategy,
    interaction_strategy: proposal.interaction_strategy,
    lexical_signature: lexicon ? lexicalSignature(text, lexicon) : []
  };
}

const differ = (a: string, b: string): number => (a === b ? 0 : 1);

export type DistanceBreakdown = {
  readonly total: number;
  readonly parts: Readonly<Record<string, number>>;
  readonly near_duplicate: boolean;
};

/**
 * Weighted distance between two concepts, 0 (identical) to 1 (unrelated).
 *
 * Colour, lighting, camera and typography contribute nothing: those tokens were
 * removed from the signature before it was built, and no feature encodes them.
 */
export function pairwiseConceptDistance(
  a: DiversityVector,
  b: DiversityVector
): DistanceBreakdown {
  const parts: Record<string, number> = {
    concept_type: differ(a.concept_type, b.concept_type) * DISTANCE_WEIGHTS.concept_type,
    metaphor_family: differ(a.metaphor_family, b.metaphor_family) * DISTANCE_WEIGHTS.metaphor_family,
    subject_strategy:
      differ(a.subject_strategy, b.subject_strategy) * DISTANCE_WEIGHTS.subject_strategy,
    narrative_strategy:
      differ(a.narrative_strategy, b.narrative_strategy) * DISTANCE_WEIGHTS.narrative_strategy,
    composition_intent:
      differ(a.composition_intent, b.composition_intent) * DISTANCE_WEIGHTS.composition_intent,
    emotional_strategy:
      differ(a.emotional_strategy, b.emotional_strategy) * DISTANCE_WEIGHTS.emotional_strategy,
    human_presence: differ(a.human_presence, b.human_presence) * DISTANCE_WEIGHTS.human_presence,
    // Ordinal: literal → abstract is a scale, so the gap is scaled too.
    abstraction_level:
      Math.abs(a.abstraction_level - b.abstraction_level) * DISTANCE_WEIGHTS.abstraction_level,
    lexical: (1 - jaccard(a.lexical_signature, b.lexical_signature)) * DISTANCE_WEIGHTS.lexical
  };

  const total = round(Object.values(parts).reduce((sum, value) => sum + value, 0));

  return {
    total,
    parts: Object.fromEntries(
      Object.entries(parts).map(([key, value]) => [key, round(value)])
    ),
    near_duplicate: total < MIN_CONCEPT_DISTANCE
  };
}

export type DuplicatePair = {
  readonly a: number;
  readonly b: number;
  readonly distance: number;
  readonly reason: string;
};

export type DiversityReport = {
  readonly distances: readonly { a: number; b: number; distance: number }[];
  readonly duplicates: readonly DuplicatePair[];
  readonly passed: boolean;
  /** Index of the concept involved in the most duplicate pairs — the one to replace. */
  readonly weakest_index: number | null;
  readonly mean_distance: number;
};

/** Which features actually separated a pair, for an explainable rejection message. */
function explainPair(breakdown: DistanceBreakdown): string {
  const contributors = Object.entries(breakdown.parts)
    .filter(([, value]) => value > 0)
    .sort(([, x], [, y]) => y - x)
    .slice(0, 3)
    .map(([key]) => key.replace(/_/g, " "));

  return contributors.length === 0
    ? "the two concepts are identical on every feature the gate measures"
    : `they differ only on ${contributors.join(", ")}, which is not enough to be a second idea`;
}

export function assessDiversity(vectors: readonly DiversityVector[]): DiversityReport {
  const distances: { a: number; b: number; distance: number }[] = [];
  const duplicates: DuplicatePair[] = [];
  const offences = new Map<number, number>();

  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      const left = vectors[i];
      const right = vectors[j];
      if (!left || !right) continue;

      const breakdown = pairwiseConceptDistance(left, right);
      distances.push({ a: i, b: j, distance: breakdown.total });

      if (breakdown.near_duplicate) {
        duplicates.push({
          a: i,
          b: j,
          distance: breakdown.total,
          reason: `concepts ${i + 1} and ${j + 1} scored ${breakdown.total} against a floor of ${MIN_CONCEPT_DISTANCE}: ${explainPair(breakdown)}`
        });
        offences.set(i, (offences.get(i) ?? 0) + 1);
        offences.set(j, (offences.get(j) ?? 0) + 1);
      }
    }
  }

  // The later concept of the worst pair is replaced, so the first statement of
  // an idea survives and its echo is the one regenerated.
  const weakest =
    [...offences.entries()].sort((a, b) =>
      b[1] === a[1] ? b[0] - a[0] : b[1] - a[1]
    )[0]?.[0] ?? null;

  const mean =
    distances.length === 0
      ? 1
      : round(distances.reduce((sum, entry) => sum + entry.distance, 0) / distances.length);

  return {
    distances,
    duplicates,
    passed: duplicates.length === 0,
    weakest_index: duplicates.length === 0 ? null : weakest,
    mean_distance: mean
  };
}
