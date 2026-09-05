import { describe, expect, it } from "vitest";
import { datasets, pipeline } from "../fixtures/load";
import { conceptFixture } from "../fixtures/concepts/load";
import { validateConcept, measureSpecificity } from "../../engine/concept/validate";
import { conceptLexicon } from "../../engine/concept/lexicon";

const { contract, direction } = pipeline("kopi-lawas-promotion");
const lexicon = conceptLexicon(datasets)!;
const validate = (proposal: Parameters<typeof validateConcept>[0]) =>
  validateConcept(proposal, contract, direction, datasets);

describe("the lexicon is loaded as versioned data", () => {
  it("is present in the registry", () => {
    expect(lexicon).not.toBeNull();
    expect(lexicon.banned_phrases.length).toBeGreaterThanOrEqual(8);
    expect(lexicon.styling_words).toContain("beige");
    expect(lexicon.styling_words).toContain("typography");
  });
});

describe("valid concepts pass", () => {
  it.each(conceptFixture("valid-set").concepts.map((c, i) => [i, c] as const))(
    "concept %i is accepted",
    (_index, proposal) => {
      const result = validate(proposal);
      expect(result.issues.filter((i) => i.severity !== "minor")).toEqual([]);
      expect(result.passed).toBe(true);
      expect(result.specificity).toBeGreaterThan(0.5);
    }
  );
});

describe("generic concept rejection", () => {
  const generic = conceptFixture("generic-response").concepts;

  it("rejects every concept in the generic fixture", () => {
    for (const proposal of generic) {
      expect(validate(proposal).passed).toBe(false);
    }
  });

  it("names the banned phrase and offers a fix", () => {
    const issues = validate(generic[0]!).issues;
    const generics = issues.filter((i) => i.code === "GENERIC_LANGUAGE");
    expect(generics.length).toBeGreaterThan(0);
    expect(generics[0]!.message).toMatch(/modern premium|clean and elegant|premium lifestyle/i);
    expect(generics[0]!.fix.length).toBeGreaterThan(20);
  });

  it("also fails them on specificity, not only on phrase matching", () => {
    const issues = validate(generic[1]!).issues;
    expect(issues.some((i) => i.code === "INSUFFICIENT_SPECIFICITY")).toBe(true);
  });
});

describe("specificity is measured by ratio, not length", () => {
  const valid = conceptFixture("valid-set").concepts[0]!;

  it("fails long generic prose", () => {
    const padded = {
      ...valid,
      big_idea:
        "A modern and beautiful campaign that feels premium and elegant, with a stylish and sophisticated mood that is visually appealing and eye-catching, delivering a sleek and modern aesthetic that is engaging and attractive to a wide audience who appreciate beautiful modern premium design.",
      creative_tension: "Modern yet elegant, premium yet simple, stylish yet clean.",
      visual_metaphor: "A beautiful and elegant premium scene.",
      why: "Because it looks amazing and premium and modern.",
      visual_world: "A stunning gorgeous atmosphere with a luxury premium feel."
    };
    const result = validate(padded);
    expect(result.passed).toBe(false);
    expect(result.specificity).toBeLessThan(0.5);
  });

  it("scores a concrete concept above a padded one of similar length", () => {
    const concrete = measureSpecificity(valid, lexicon);
    const padded = measureSpecificity(
      {
        ...valid,
        big_idea: "Modern premium elegant beautiful stylish sleek aesthetic appealing design work.",
        visual_metaphor: "Beautiful elegant premium modern stylish visual.",
        visual_world: "Premium elegant modern beautiful stylish atmosphere.",
        why: "It is beautiful and premium and modern and elegant.",
        creative_tension: "Modern yet elegant."
      },
      lexicon
    );
    expect(concrete.score).toBeGreaterThan(padded.score);
    expect(padded.vagueness_ratio).toBeGreaterThan(concrete.vagueness_ratio);
  });

  it("rejects a concept made mostly of styling vocabulary", () => {
    const styling = {
      ...valid,
      big_idea:
        "Use large bold serif typography in beige and cream with soft backlit lighting and a shallow depth of field.",
      creative_tension: "Warm beige palette against cool grey shadow and high contrast grain.",
      visual_metaphor: "A 50mm closeup with golden hour lighting and a gradient background.",
      why: "The palette and typography will read well at small sizes with strong contrast.",
      visual_world: "Muted saturated tones, soft vignette, textured grain backdrop, bokeh highlight."
    };
    const result = validate(styling);
    expect(result.passed).toBe(false);
    expect(
      result.issues.some((i) => i.message.toLowerCase().includes("styling vocabulary"))
    ).toBe(true);
  });
});

describe("constraint compliance", () => {
  const valid = conceptFixture("valid-set").concepts[0]!;

  it("rejects a concept that reassigns the movement", () => {
    const selected = direction.candidates.find(
      (c) => c.candidate.candidate_id === direction.selected_candidate_id
    )!;
    const other = selected.candidate.movement_id === "brutalism" ? "minimalism" : "brutalism";
    const result = validate({
      ...valid,
      visual_world: `${valid.visual_world} Rendered in a strict ${other} treatment throughout.`
    });
    expect(result.issues.some((i) => i.code === "CONSTRAINT_VIOLATION")).toBe(true);
    expect(result.passed).toBe(false);
  });
});

describe("cultural safety", () => {
  it("rejects the stereotype fixture and explains what to do instead", () => {
    const stereotype = conceptFixture("cultural-stereotype").concepts[0]!;
    const result = validate(stereotype);
    expect(result.passed).toBe(false);

    const cultural = result.issues.filter(
      (i) => i.code === "CULTURAL_STEREOTYPE" || i.code === "INVENTED_CULTURAL_CLAIM"
    );
    expect(cultural.length).toBeGreaterThan(0);
    // The fix comes from the country file's own "instead" guidance.
    expect(cultural[0]!.fix.length).toBeGreaterThan(20);
    expect(cultural[0]!.reason.length).toBeGreaterThan(20);
  });

  it("rejects country-equals-a-look shortcuts", () => {
    const valid = conceptFixture("valid-set").concepts[0]!;
    const result = validate({
      ...valid,
      visual_world: `${valid.visual_world} Overall a typical japanese look with ethnic pattern detail.`
    });
    expect(result.issues.some((i) => i.code === "CULTURAL_STEREOTYPE")).toBe(true);
  });

  it("accepts cultural influence expressed as spatial and material behaviour", () => {
    const valid = conceptFixture("valid-set").concepts[0]!;
    const result = validate({
      ...valid,
      visual_world:
        "Early morning in a narrow Solo storefront, teak counter edge, restrained spacing and a reduction of props that borrows Japanese material discipline without any motif."
    });
    expect(result.passed).toBe(true);
  });
});
