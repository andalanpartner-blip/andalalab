import { describe, expect, it } from "vitest";
import {
  ConceptProposal,
  ConceptProposalBatch,
  ConceptType,
  CreativeConcept
} from "../../types/schemas/concept.schema";
import { conceptFixture, conceptFixtureText } from "../fixtures/concepts/load";

describe("concept schema", () => {
  const valid = conceptFixture("valid-set").concepts[0]!;

  it("accepts a well-formed proposal", () => {
    expect(ConceptProposal.safeParse(valid).success).toBe(true);
  });

  it("is strict: an unexpected key is rejected, not ignored", () => {
    const withExtras = { ...valid, dkv: { contrast: 0.9 }, layout_id: "typographic" };
    const parsed = ConceptProposal.safeParse(withExtras);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
    }
  });

  it("rejects a concept type the model invented", () => {
    const parsed = ConceptProposal.safeParse({ ...valid, type: "coffee_moment" });
    expect(parsed.success).toBe(false);
  });

  it("closes the concept type vocabulary at the architecture's twelve", () => {
    expect(ConceptType.options).toHaveLength(12);
    expect(ConceptType.options).toContain("cultural_reinterpretation");
    expect(ConceptType.options).not.toContain("moodboard");
  });

  it("rejects an invented enum on a strategy field", () => {
    expect(ConceptProposal.safeParse({ ...valid, human_presence: "several" }).success).toBe(false);
    expect(ConceptProposal.safeParse({ ...valid, abstraction_level: "very abstract" }).success).toBe(
      false
    );
  });

  it("requires the five conceptual fields to be substantive", () => {
    for (const field of ["big_idea", "creative_tension", "visual_metaphor", "why", "visual_world"]) {
      const parsed = ConceptProposal.safeParse({ ...valid, [field]: "nice" });
      expect(parsed.success, `${field} should reject a one-word value`).toBe(false);
    }
  });

  it("treats self_score as optional advisory metadata", () => {
    expect(ConceptProposal.safeParse({ ...valid, self_score: 0.99 }).success).toBe(true);
    expect(ConceptProposal.safeParse({ ...valid, self_score: 1.5 }).success).toBe(false);
  });

  it("parses a whole batch and caps it at five", () => {
    expect(ConceptProposalBatch.safeParse(JSON.parse(conceptFixtureText("valid-set"))).success).toBe(
      true
    );
    const tooMany = { concepts: Array.from({ length: 6 }, () => valid) };
    expect(ConceptProposalBatch.safeParse(tooMany).success).toBe(false);
  });

  it("requires a CreativeConcept to carry an engine-computed score and vector", () => {
    const parsed = CreativeConcept.safeParse({ proposal: valid });
    expect(parsed.success).toBe(false);
  });
});
