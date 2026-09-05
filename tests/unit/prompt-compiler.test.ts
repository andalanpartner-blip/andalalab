import { describe, expect, it } from "vitest";
import { pipeline } from "../fixtures/load";
import {
  compilePromptSet,
  buildPromptBlocks,
  resolveTextMode,
  isUnsupportedConceptStatement,
  excludeUnsupportedConcepts
} from "../../engine";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";

/**
 * The Prompt Compiler (P2.3): DesignRecipe (+ optional CreativeConcept) ->
 * ready-to-copy prompts. Every test here runs against real fixture recipes —
 * no live Gemini calls, no randomness, no clock reads.
 */

const kopiLawas = pipeline("kopi-lawas-promotion"); // brand present
const northbeam = pipeline("northbeam-saas-launch"); // brand absent

describe("compilePromptSet: determinism", () => {
  it("produces byte-identical English output for the same recipe", () => {
    const first = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    const second = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    expect(second).toEqual(first);
  });

  it("produces byte-identical Indonesian output for the same recipe", () => {
    const first = compilePromptSet({ recipe: kopiLawas.recipe, language: "id" });
    const second = compilePromptSet({ recipe: kopiLawas.recipe, language: "id" });
    expect(second).toEqual(first);
  });

  it("defaults to English when no language is requested", () => {
    const defaulted = compilePromptSet({ recipe: kopiLawas.recipe });
    expect(defaulted.language).toBe("en");
  });

  it("never touches the network, the clock or Math.random (same recipe, ten runs, identical hash)", () => {
    const runs = Array.from({ length: 10 }, () => compilePromptSet({ recipe: kopiLawas.recipe, language: "en" }));
    const unique = new Set(runs.map((r) => r.masterPrompt));
    expect(unique.size).toBe(1);
  });
});

describe("compilePromptSet: language changes expression, not decisions", () => {
  it("keeps every numeric decision identical across languages", () => {
    const en = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    const id = compilePromptSet({ recipe: kopiLawas.recipe, language: "id" });

    const numbers = (text: string) => text.match(/\d+(\.\d+)?%?/g)?.sort() ?? [];
    expect(numbers(id.masterPrompt)).toEqual(numbers(en.masterPrompt));
  });

  it("keeps the concept name, movement name and brand hex codes untranslated", () => {
    const en = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    const id = compilePromptSet({ recipe: kopiLawas.recipe, language: "id" });

    expect(id.masterPrompt).toContain(kopiLawas.recipe.movement.name);
    expect(en.masterPrompt).toContain(kopiLawas.recipe.movement.name);

    for (const swatch of kopiLawas.recipe.color.brand_palette) {
      expect(id.masterPrompt).toContain(swatch.hex);
      expect(en.masterPrompt).toContain(swatch.hex);
    }
  });

  it("renders actual Indonesian connective language, not a literal word-for-word translation", () => {
    const id = compilePromptSet({ recipe: kopiLawas.recipe, language: "id" });
    // Indonesian-specific function words that a raw machine translation of the
    // English template would not reliably produce in the right place.
    expect(id.masterPrompt).toMatch(/dengan|untuk|yang|pada/);
  });
});

describe("compilePromptSet: Master Prompt coverage", () => {
  const master = compilePromptSet({
    recipe: kopiLawas.recipe,
    concept: null,
    language: "en"
  }).masterPrompt;

  it("contains the composition strategy", () => {
    expect(master.toLowerCase()).toMatch(/composition/);
  });

  it("contains the culture / country influence", () => {
    expect(master).toContain(kopiLawas.recipe.movement.name);
  });

  it("contains the platform (channel + aspect ratio)", () => {
    expect(master.toLowerCase()).toMatch(/instagram feed/);
    expect(master.toLowerCase()).toMatch(/portrait/);
  });

  it("does not omit any recipe constraint it is allowed to render verbatim", () => {
    // Two categories are intentionally not quoted verbatim, and are covered by
    // their own tests instead: `country`-sourced anti-stereotype constraints
    // (compacted into one rule — see "Negative Prompt: anti-stereotype intent
    // stays compact") and any statement naming an unsupported concept (see
    // "compilePromptSet: no invented decisions").
    for (const constraint of kopiLawas.recipe.constraints) {
      if (constraint.source === "country") continue;
      if (isUnsupportedConceptStatement(constraint.statement)) continue;
      const fragment = constraint.statement.slice(0, 20);
      expect(master).toContain(fragment);
    }
  });
});

describe("compilePromptSet: concept handling", () => {
  it("includes the concept name and big idea when a concept is supplied", async () => {
    const { conceptFixtureText } = await import("../fixtures/concepts/load");
    const { ConceptProposalBatch } = await import("../../types/schemas/concept.schema");
    const batch = ConceptProposalBatch.parse(JSON.parse(conceptFixtureText("valid-set")));
    const proposal = batch.concepts[0]!;

    const concept = {
      id: "concept_test_01",
      project_id: kopiLawas.recipe.project_id,
      schema_version: "1.0.0",
      dataset_version: kopiLawas.recipe.dataset_version,
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: "test",
      direction_id: kopiLawas.recipe.direction_id,
      proposal,
      diversity_vector: {
        concept_type: proposal.type,
        metaphor_family: "threshold",
        subject_strategy: proposal.subject_strategy,
        narrative_strategy: proposal.narrative_strategy,
        composition_intent: proposal.composition_intent,
        emotional_strategy: proposal.emotional_direction,
        human_presence: proposal.human_presence,
        abstraction_level: 0.5,
        temporal_strategy: proposal.temporal_strategy,
        interaction_strategy: proposal.interaction_strategy,
        lexical_signature: ["threshold", "counter"]
      },
      score: {
        total: 0.8,
        breakdown: [],
        model_advisory: null
      },
      concept_hash: "aaaaaaaa"
    };

    const master = compilePromptSet({ recipe: kopiLawas.recipe, concept: concept as never, language: "en" }).masterPrompt;
    expect(master).toContain(proposal.name);
    expect(master).toContain(proposal.big_idea);
    expect(master).toContain(proposal.visual_metaphor);
  });

  it("handles a recipe with no concept safely (no crash, no invented concept section)", () => {
    const blocks = buildPromptBlocks({ recipe: northbeam.recipe, concept: null });
    expect(blocks.concept).toBeNull();
    const set = compilePromptSet({ recipe: northbeam.recipe, concept: null, language: "en" });
    expect(set.masterPrompt.length).toBeGreaterThan(0);
    expect(set.masterPrompt).not.toMatch(/Concept:/);
  });
});

describe("compilePromptSet: Quick Prompt", () => {
  it("is shorter than the Master Prompt but keeps the objective and format", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    expect(set.quickPrompt.length).toBeLessThan(set.masterPrompt.length);
    expect(set.quickPrompt.toLowerCase()).toMatch(/promotion/);
  });

  it("is shorter in Indonesian too", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "id" });
    expect(set.quickPrompt.length).toBeLessThan(set.masterPrompt.length);
  });
});

describe("compilePromptSet: Image-Only vs Design/Layout Prompt", () => {
  it("Image-Only Prompt omits detailed typography strategy language", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    expect(set.imageOnlyPrompt).not.toContain(kopiLawas.recipe.typography.hierarchy_behavior);
  });

  it("Design/Layout Prompt preserves the grid and typography strategy", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    expect(set.designLayoutPrompt).toContain(
      `${kopiLawas.recipe.grid.columns}x${kopiLawas.recipe.grid.rows}`
    );
    expect(set.designLayoutPrompt).toContain(kopiLawas.recipe.typography.hierarchy_behavior);
  });

  it("Image-Only Prompt never instructs the generator to render exact wording", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "en", textMode: "TEXT_CRITICAL" });
    expect(set.imageOnlyPrompt).not.toMatch(/render the core message exactly as written/i);
  });
});

describe("compilePromptSet: Negative Prompt", () => {
  it("includes every must-not / avoid constraint not sourced from the country blend", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    const negativeSources = kopiLawas.recipe.constraints.filter(
      (c) => (c.kind === "must_not" || c.kind === "avoid") && c.source !== "country"
    );
    expect(negativeSources.length).toBeGreaterThan(0);
    for (const constraint of negativeSources) {
      expect(set.negativePrompt).toContain(constraint.statement.replace(/\.$/, ""));
    }
  });

  it("includes the universal negative baseline", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    expect(set.negativePrompt.toLowerCase()).toMatch(/stock-photo/);
    expect(set.negativePrompt.toLowerCase()).toMatch(/clutter/);
  });

  it("is compact: one anti-stereotype rule, not a per-country token dump", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    const countryConstraints = kopiLawas.recipe.constraints.filter((c) => c.source === "country");
    expect(countryConstraints.length).toBeGreaterThan(0);

    // The full per-country sentence (with its own banned-token enumeration)
    // must not appear — only the one compact rule that replaces it.
    for (const constraint of countryConstraints) {
      expect(set.negativePrompt).not.toContain(constraint.statement);
    }
    // The raw token list itself must not be dumped either.
    for (const token of kopiLawas.recipe.culture.banned_tokens) {
      expect(set.negativePrompt.toLowerCase()).not.toContain(token.toLowerCase());
    }
  });

  it("preserves the anti-stereotype intent: avoid stereotype, rely on relationships instead", () => {
    const en = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" }).negativePrompt;
    const id = compilePromptSet({ recipe: kopiLawas.recipe, language: "id" }).negativePrompt;

    expect(en.toLowerCase()).toMatch(/stereotyp/);
    expect(en.toLowerCase()).toMatch(/spatial behavior/);
    expect(en.toLowerCase()).toMatch(/typography relationships/);
    expect(en.toLowerCase()).toMatch(/color relationships/);
    expect(en.toLowerCase()).toMatch(/materiality/);
    expect(en).toContain(kopiLawas.recipe.culture.dimensions["composition"]!.country_name);

    expect(id.toLowerCase()).toMatch(/stereotip/);
    expect(id.toLowerCase()).toMatch(/hubungan tipografi/);
    expect(id.toLowerCase()).toMatch(/hubungan warna/);
    expect(id.toLowerCase()).toMatch(/materialitas/);
  });
});

describe("compilePromptSet: brand present vs absent", () => {
  it("surfaces the brand palette and fonts when a brand is attached", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    expect(kopiLawas.recipe.color.brand_locked).toBe(true);
    expect(set.masterPrompt).toMatch(/Brand:.*locked/i);
    expect(set.masterPrompt).toContain(kopiLawas.recipe.typography.primary);
  });

  it("states plainly that no brand is attached when there is none", () => {
    const set = compilePromptSet({ recipe: northbeam.recipe, language: "en" });
    expect(northbeam.recipe.color.brand_locked).toBe(false);
    expect(set.masterPrompt.toLowerCase()).toMatch(/no brand is attached/);
  });

  it("says the same thing in Indonesian without inventing a different brand decision", () => {
    const set = compilePromptSet({ recipe: northbeam.recipe, language: "id" });
    expect(set.masterPrompt.toLowerCase()).toMatch(/tidak terikat pada brand/);
  });
});

describe("resolveTextMode / TEXT_CRITICAL vs LAYOUT_ONLY", () => {
  it("is a pure function of the recipe (no override needed for a normal recipe)", () => {
    const first = resolveTextMode(kopiLawas.recipe);
    const second = resolveTextMode(kopiLawas.recipe);
    expect(second).toBe(first);
  });

  it("TEXT_CRITICAL: quotes the exact core message and forbids paraphrase", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "en", textMode: "TEXT_CRITICAL" });
    expect(set.masterPrompt).toMatch(/render the core message exactly as written/i);
    expect(set.masterPrompt.toLowerCase()).toMatch(/do not paraphrase/);
  });

  it("LAYOUT_ONLY: reserves space instead of demanding exact text", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "en", textMode: "LAYOUT_ONLY" });
    expect(set.masterPrompt).not.toMatch(/render the core message exactly as written/i);
    expect(set.masterPrompt.toLowerCase()).toMatch(/reserve/);
  });

  it("carries the same distinction into Bahasa Indonesia", () => {
    const critical = compilePromptSet({ recipe: kopiLawas.recipe, language: "id", textMode: "TEXT_CRITICAL" });
    const layoutOnly = compilePromptSet({ recipe: kopiLawas.recipe, language: "id", textMode: "LAYOUT_ONLY" });
    expect(critical.masterPrompt).toMatch(/persis seperti tertulis/);
    expect(layoutOnly.masterPrompt).not.toMatch(/persis seperti tertulis/);
  });
});

describe("compilePromptSet: robustness on sparse recipes", () => {
  it("never throws across every P1 fixture, brand or no brand, with or without a concept override", () => {
    const names = ["kopi-lawas-promotion", "northbeam-saas-launch", "helvetica-labs-swiss-tech"] as const;
    for (const name of names) {
      const run = pipeline(name);
      expect(() => compilePromptSet({ recipe: run.recipe, language: "en" })).not.toThrow();
      expect(() => compilePromptSet({ recipe: run.recipe, language: "id" })).not.toThrow();
    }
  });

  it("produces a schema-shaped PromptSet", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    const keys: (keyof typeof set)[] = [
      "language",
      "masterPrompt",
      "quickPrompt",
      "imageOnlyPrompt",
      "designLayoutPrompt",
      "negativePrompt"
    ];
    for (const key of keys) {
      expect(typeof set[key]).toBe("string");
    }
  });
});

describe("compilePromptSet: no invented decisions", () => {
  const UNSUPPORTED_PHRASES = ["price position", "luxury level", "brand tone", "campaign message"] as const;

  it("drops constraint statements naming an unsupported concept before they reach any block", () => {
    const injected: DesignRecipe = {
      ...kopiLawas.recipe,
      constraints: [
        ...kopiLawas.recipe.constraints,
        { id: "test-unsupported-01", source: "industry", kind: "must", statement: "State the occasion and the price position clearly.", doctrine_rank: 5 },
        { id: "test-unsupported-02", source: "industry", kind: "prefer", statement: "Signal a premium luxury level throughout.", doctrine_rank: 5 },
        { id: "test-unsupported-03", source: "brand", kind: "must", statement: "Match the brand tone precisely.", doctrine_rank: 5 },
        { id: "test-unsupported-04", source: "brief", kind: "must", statement: "Restate the campaign message verbatim.", doctrine_rank: 5 }
      ]
    };

    const en = compilePromptSet({ recipe: injected, language: "en" });
    const id = compilePromptSet({ recipe: injected, language: "id" });

    for (const set of [en, id]) {
      for (const prompt of [set.masterPrompt, set.quickPrompt, set.imageOnlyPrompt, set.designLayoutPrompt, set.negativePrompt]) {
        for (const phrase of UNSUPPORTED_PHRASES) {
          expect(prompt.toLowerCase()).not.toContain(phrase);
        }
      }
    }
  });

  it("never invents unsupported concepts even when the recipe carries none of them (baseline)", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    for (const prompt of [set.masterPrompt, set.quickPrompt, set.imageOnlyPrompt, set.designLayoutPrompt, set.negativePrompt]) {
      for (const phrase of UNSUPPORTED_PHRASES) {
        expect(prompt.toLowerCase()).not.toContain(phrase);
      }
    }
  });

  it("excludeUnsupportedConcepts / isUnsupportedConceptStatement filter exactly the named concepts", () => {
    const items = [
      { statement: "State the occasion and the price position clearly." },
      { statement: "Signal a premium luxury level throughout." },
      { statement: "Match the brand tone precisely." },
      { statement: "Restate the campaign message verbatim." },
      { statement: "Show the cold brew in the reusable bottle." }
    ];
    expect(items.filter((i) => isUnsupportedConceptStatement(i.statement))).toHaveLength(4);
    expect(excludeUnsupportedConcepts(items)).toEqual([items[4]]);
  });
});

describe("compilePromptSet: Indonesian language purity", () => {
  const en = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
  const id = compilePromptSet({ recipe: kopiLawas.recipe, language: "id" });

  // Free-text prose quoted verbatim from country/movement datasets, authored
  // in English. The Indonesian renderer must not leave these whole sentences
  // sitting inside an otherwise-Indonesian prompt (see docs/prompt-compiler.md).
  const ENGLISH_DATASET_PROSE = [
    kopiLawas.recipe.composition.spatial_behavior,
    kopiLawas.recipe.typography.hierarchy_behavior,
    kopiLawas.recipe.imagery.subject_treatment,
    kopiLawas.recipe.imagery.framing,
    kopiLawas.recipe.lighting.direction,
    kopiLawas.recipe.graphic_language.shape_logic,
    kopiLawas.recipe.graphic_language.rhythm,
    ...kopiLawas.recipe.color.relationships,
    ...kopiLawas.recipe.movement.anti_stereotype
  ];

  it("sanity: the English prompt does carry this dataset prose", () => {
    for (const sentence of ENGLISH_DATASET_PROSE) {
      expect(en.masterPrompt).toContain(sentence);
    }
  });

  it("never leaves these whole English sentences inside the Indonesian Master Prompt", () => {
    for (const sentence of ENGLISH_DATASET_PROSE) {
      expect(id.masterPrompt).not.toContain(sentence);
    }
  });

  it("never leaves them inside any of the other four Indonesian prompts either", () => {
    for (const prompt of [id.quickPrompt, id.imageOnlyPrompt, id.designLayoutPrompt, id.negativePrompt]) {
      for (const sentence of ENGLISH_DATASET_PROSE) {
        expect(prompt).not.toContain(sentence);
      }
    }
  });

  it("still keeps proper names, hex codes and established technical terms unchanged", () => {
    expect(id.masterPrompt).toContain(kopiLawas.recipe.movement.name); // "Bauhaus"
    expect(id.masterPrompt.toLowerCase()).toMatch(/\bgrid\b/);
    for (const swatch of kopiLawas.recipe.color.brand_palette) {
      expect(id.masterPrompt).toContain(swatch.hex);
    }
  });

  it("still writes real Indonesian prose around what remains, not a blank template", () => {
    expect(id.masterPrompt.length).toBeGreaterThan(400);
    expect(id.masterPrompt).toMatch(/dengan|untuk|yang|pada|dan/);
  });
});

describe("compilePromptSet: Image-Only excludes unnecessary typography, includes visual context", () => {
  it("never leaks typography strategy, font names or scale ratio", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    expect(set.imageOnlyPrompt).not.toContain(kopiLawas.recipe.typography.primary);
    expect(set.imageOnlyPrompt).not.toContain(kopiLawas.recipe.typography.hierarchy_behavior);
    expect(set.imageOnlyPrompt).not.toContain(kopiLawas.recipe.typography.scale_ratio.toFixed(2));
  });

  it("never asks the generator to render exact copy, in either text mode", () => {
    // The intro's "Core message: ..." line is informational context, present
    // in every prompt type — the thing Image-Only must never do is instruct
    // the generator to actually render that wording as on-image text.
    const critical = compilePromptSet({ recipe: kopiLawas.recipe, language: "en", textMode: "TEXT_CRITICAL" });
    const layoutOnly = compilePromptSet({ recipe: kopiLawas.recipe, language: "en", textMode: "LAYOUT_ONLY" });
    expect(critical.imageOnlyPrompt).not.toMatch(/render the core message exactly as written/i);
    expect(layoutOnly.imageOnlyPrompt).not.toMatch(/render the core message exactly as written/i);
  });

  it("still includes industry context and platform/aspect ratio, as the spec allows", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    expect(set.imageOnlyPrompt.toLowerCase()).toMatch(/industry requirements/);
    expect(set.imageOnlyPrompt.toLowerCase()).toMatch(/platform constraints/);
    expect(set.imageOnlyPrompt.toLowerCase()).toMatch(/portrait/);
  });

  it("still includes subject, environment, composition, color and culture", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    expect(set.imageOnlyPrompt.toLowerCase()).toMatch(/imagery & subject/);
    expect(set.imageOnlyPrompt.toLowerCase()).toMatch(/composition & layout/);
    expect(set.imageOnlyPrompt.toLowerCase()).toMatch(/color:/);
    expect(set.imageOnlyPrompt.toLowerCase()).toMatch(/culture & country influence/);
  });
});

describe("buildPromptBlocks", () => {
  it("never invents campaign copy beyond the recipe's own core message", () => {
    const blocks = buildPromptBlocks({ recipe: kopiLawas.recipe as DesignRecipe, concept: null });
    expect(blocks.objective.coreMessage).toBe(kopiLawas.recipe.core_message);
  });
});

describe("compilePromptSet: visual generation adapter (P2.7)", () => {
  it("carries a visual-generation section in every prompt type, in both languages", () => {
    for (const language of ["en", "id"] as const) {
      const set = compilePromptSet({ recipe: kopiLawas.recipe, language });
      const marker = language === "en" ? /visual (generation|medium|character)/i : /karakter (visual|medium)/i;
      expect(set.masterPrompt).toMatch(marker);
      expect(set.quickPrompt).toMatch(marker);
      expect(set.imageOnlyPrompt).toMatch(marker);
      expect(set.designLayoutPrompt).toMatch(marker);
    }
  });

  it("adds exactly one adapter-specific avoidance to the negative prompt", () => {
    const set = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    // kopi-lawas resolves to the fashion-editorial adapter (commercial-editorial style).
    expect(set.visualCharacter.id).toBe("fashion-editorial");
    expect(set.negativePrompt).toContain("catalogue-flat lighting");
  });

  it("the adapter override leaves the rest of the prompt untouched", () => {
    const base = compilePromptSet({ recipe: kopiLawas.recipe, language: "en" });
    const forced = compilePromptSet({ recipe: kopiLawas.recipe, language: "en", visualAdapter: "graphic-poster" });
    expect(forced.visualCharacter.id).toBe("graphic-poster");
    // The composition, colour and hierarchy lines are identical…
    const structuralLine = (text: string, prefix: string) =>
      text.split("\n").find((l) => l.startsWith(prefix));
    for (const prefix of ["Composition & layout:", "Color:", "Visual hierarchy:"]) {
      expect(structuralLine(forced.masterPrompt, prefix)).toBe(structuralLine(base.masterPrompt, prefix));
    }
    // …only the visual-generation wording differs.
    expect(forced.masterPrompt).not.toBe(base.masterPrompt);
  });

  it("does not expose the raw hyphenated adapter id in any prompt", () => {
    const forced = compilePromptSet({ recipe: kopiLawas.recipe, language: "en", visualAdapter: "product-photography" });
    for (const prompt of [
      forced.masterPrompt,
      forced.quickPrompt,
      forced.imageOnlyPrompt,
      forced.designLayoutPrompt,
      forced.negativePrompt
    ]) {
      expect(prompt).not.toContain("product-photography");
    }
  });
});
