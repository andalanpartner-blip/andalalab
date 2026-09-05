import { describe, expect, it } from "vitest";
import { datasets } from "../fixtures/load";
import { conceptFixture } from "../fixtures/concepts/load";
import {
  buildDiversityVector,
  pairwiseConceptDistance,
  assessDiversity
} from "../../engine/concept/diversity";
import { DISTANCE_WEIGHTS, MIN_CONCEPT_DISTANCE } from "../../engine/concept/config";
import { DiversityVector } from "../../types/schemas/concept.schema";

const vec = (proposal: Parameters<typeof buildDiversityVector>[0]) =>
  buildDiversityVector(proposal, datasets);

describe("configuration lives in one place", () => {
  it("weights sum to 1", () => {
    const total = Object.values(DISTANCE_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("exposes a single tunable threshold", () => {
    expect(MIN_CONCEPT_DISTANCE).toBeGreaterThan(0);
    expect(MIN_CONCEPT_DISTANCE).toBeLessThan(1);
  });
});

describe("diversity vector", () => {
  const proposals = conceptFixture("valid-set").concepts;

  it("validates against the schema", () => {
    for (const proposal of proposals) {
      expect(DiversityVector.safeParse(vec(proposal)).success).toBe(true);
    }
  });

  it("derives the metaphor family from the text rather than trusting a label", () => {
    const architectural = vec(proposals[0]!);
    expect(architectural.metaphor_family).toBe("architecture");
  });

  it("strips styling vocabulary from the lexical signature", () => {
    const withStyling = vec({
      ...proposals[0]!,
      visual_world: `${proposals[0]!.visual_world} Beige and cream palette, softbox lighting, bold serif typography.`
    });
    for (const token of ["beige", "cream", "softbox", "lighting", "typography", "serif"]) {
      expect(withStyling.lexical_signature).not.toContain(token);
    }
  });

  it("scales abstraction as an ordinal, not a category", () => {
    expect(vec({ ...proposals[0]!, abstraction_level: "literal" }).abstraction_level).toBe(0);
    expect(vec({ ...proposals[0]!, abstraction_level: "abstract" }).abstraction_level).toBe(1);
  });
});

describe("pairwise distance", () => {
  const proposals = conceptFixture("valid-set").concepts;

  it("finds genuinely different concepts diverse", () => {
    const distance = pairwiseConceptDistance(vec(proposals[0]!), vec(proposals[1]!));
    expect(distance.total).toBeGreaterThanOrEqual(MIN_CONCEPT_DISTANCE);
    expect(distance.near_duplicate).toBe(false);
  });

  it("is zero against itself", () => {
    const distance = pairwiseConceptDistance(vec(proposals[0]!), vec(proposals[0]!));
    expect(distance.total).toBe(0);
    expect(distance.near_duplicate).toBe(true);
  });

  it("is symmetric", () => {
    const a = vec(proposals[0]!);
    const b = vec(proposals[2]!);
    expect(pairwiseConceptDistance(b, a).total).toBe(pairwiseConceptDistance(a, b).total);
  });

  it("does NOT count a repaint as a different concept", () => {
    const [first, second] = conceptFixture("near-duplicate").concepts;
    const distance = pairwiseConceptDistance(vec(first!), vec(second!));
    expect(distance.near_duplicate).toBe(true);
    expect(distance.total).toBeLessThan(MIN_CONCEPT_DISTANCE);
  });

  it("ignores colour, lighting, camera and typography entirely", () => {
    const base = proposals[0]!;
    const restyled = {
      ...base,
      visual_world:
        "Cream and beige palette with golden hour backlit lighting, 85mm lens, heavy grain texture and a bold italic serif typeface."
    };
    const distance = pairwiseConceptDistance(vec(base), vec(restyled));
    expect(distance.near_duplicate).toBe(true);
  });

  it("counts a different subject and tension as diverse", () => {
    const architectural = proposals[0]!;
    const human = proposals[1]!;
    expect(architectural.subject_strategy).not.toBe(human.subject_strategy);
    expect(pairwiseConceptDistance(vec(architectural), vec(human)).near_duplicate).toBe(false);
  });

  it("cannot be gamed by relabelling identical text", () => {
    const base = proposals[0]!;
    const relabelled = {
      ...base,
      type: "contrast" as const,
      emotional_direction: "urgent" as const,
      temporal_strategy: "aftermath" as const,
      interaction_strategy: "participatory" as const
    };
    // Labels differ, but the idea is word-for-word the same, so the lexical
    // signature holds the distance down.
    const distance = pairwiseConceptDistance(vec(base), vec(relabelled));
    expect(distance.parts.lexical).toBe(0);
    expect(distance.total).toBeLessThan(0.45);
  });
});

describe("diversity gate", () => {
  const proposals = conceptFixture("valid-set").concepts;

  it("passes a genuinely varied set", () => {
    const report = assessDiversity(proposals.map(vec));
    expect(report.passed).toBe(true);
    expect(report.duplicates).toHaveLength(0);
    expect(report.distances).toHaveLength(3);
    expect(report.mean_distance).toBeGreaterThan(MIN_CONCEPT_DISTANCE);
  });

  it("fails the near-duplicate fixture and explains why", () => {
    const report = assessDiversity(conceptFixture("near-duplicate").concepts.map(vec));
    expect(report.passed).toBe(false);
    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0]!.reason).toMatch(/floor of/);
    expect(report.weakest_index).not.toBeNull();
  });

  it("nominates the later concept of a duplicate pair for replacement", () => {
    const report = assessDiversity(conceptFixture("near-duplicate").concepts.map(vec));
    expect(report.weakest_index).toBe(1);
  });

  it("is deterministic", () => {
    const vectors = proposals.map(vec);
    expect(assessDiversity(vectors)).toEqual(assessDiversity(vectors));
  });
});
