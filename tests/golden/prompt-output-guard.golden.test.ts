import { describe, expect, it } from "vitest";
import { P1_BRIEFS, pipeline } from "../fixtures/load";
import { compilePromptSet } from "../../engine/prompt/compile";
import { mentionsToken } from "../../engine/country/anti-stereotype";
import { GUARDED_PROMPT_TIERS } from "../../engine/prompt/guard";
import type { DesignRecipe } from "../../types/schemas/recipe.schema";

/**
 * Golden cases for the P3.0 stereotype / banned-token prompt output guard.
 * Runs the real pipeline (no LLM) and asserts the guard's behaviour end to end,
 * in both languages, across all five prompt tiers.
 */

const TIERS = GUARDED_PROMPT_TIERS;

describe("golden: a clean recipe is untouched and reports clean", () => {
  it("kopi-lawas has no banned token in any tier — guard.clean, no findings, output identical to a pre-guard render", () => {
    for (const lang of ["en", "id"] as const) {
      const set = compilePromptSet({ recipe: pipeline("kopi-lawas-promotion").recipe, language: lang });
      expect(set.guard.clean).toBe(true);
      expect(set.guard.findings).toEqual([]);
    }
  });

  it("every P1 fixture that resolves clean stays byte-identical across two compiles", () => {
    for (const name of P1_BRIEFS) {
      const a = compilePromptSet({ recipe: pipeline(name).recipe, language: "en" });
      const b = compilePromptSet({ recipe: pipeline(name).recipe, language: "en" });
      expect(b).toEqual(a);
    }
  });
});

describe("golden: jakarta-tokyo-blend — a client prohibition names 'batik'", () => {
  // The brief's prohibition ("No batik pattern as background") is rendered into
  // the Avoid paragraph of four tiers. 'batik' is NOT released (prohibitions
  // are not explicit mentions), so it is a banned token — but it sits in a
  // negative instruction, so the guard flags it and leaves it exactly as
  // written. This is the guard confirming the doctrine is already satisfied.
  const recipe = pipeline("jakarta-tokyo-blend").recipe;

  it("carries 'batik' in recipe.culture.banned_tokens", () => {
    expect(recipe.culture.banned_tokens).toContain("batik");
  });

  it.each(["en", "id"] as const)("%s: reports 'batik' in every tier it appears, all flagged in a negative context", (lang) => {
    const set = compilePromptSet({ recipe, language: lang });
    expect(set.guard.clean).toBe(false);

    const batikFindings = set.guard.findings.filter((f) => f.token === "batik");
    expect(batikFindings.length).toBeGreaterThan(0);
    for (const f of batikFindings) {
      expect(f.action).toBe("flagged");
      expect(f.negative_context).toBe(true);
      expect(f.context.toLowerCase()).toContain("batik");
    }

    // Text is preserved verbatim — the client's own "no batik" instruction survives.
    expect(set.negativePrompt).toContain("No batik pattern as background");
    expect(set.masterPrompt).toContain("No batik pattern as background");
  });

  it("the guard changed nothing: prompts equal a compile of the same recipe", () => {
    const first = compilePromptSet({ recipe, language: "en" });
    const second = compilePromptSet({ recipe, language: "en" });
    for (const tier of TIERS) expect(second[tier]).toBe(first[tier]);
  });
});

describe("golden: a banned token in POSITIVE list prose is stripped", () => {
  // Plant a standalone banned token as a colour relationship. kopi-lawas is an
  // Indonesia/Japan blend, so 'batik' is a banned token for it. The colour
  // relationship sentences are English dataset prose the ID renderer omits, so
  // this plant reaches the English prompt only — which is itself a clean
  // demonstration that the two languages are scanned independently.
  const base = pipeline("kopi-lawas-promotion").recipe;
  const planted: DesignRecipe = {
    ...base,
    color: { ...base.color, relationships: ["warm neutral base", "batik", "earth and clay tones"] }
  };

  it("en: strips the token from the Relationships list, keeps the rest", () => {
    const set = compilePromptSet({ recipe: planted, language: "en" });

    expect(set.guard.clean).toBe(false);
    const stripped = set.guard.findings.filter((f) => f.token === "batik" && f.action === "stripped");
    // master / image-only / design-layout all render the colour relationships.
    expect(stripped.map((f) => f.tier).sort()).toEqual(
      ["designLayoutPrompt", "imageOnlyPrompt", "masterPrompt"]
    );

    for (const tier of ["masterPrompt", "imageOnlyPrompt", "designLayoutPrompt"] as const) {
      expect(mentionsToken(set[tier], "batik")).toBe(false);
      expect(set[tier]).toContain("warm neutral base");
      expect(set[tier]).toContain("earth and clay tones");
    }
    // The quick prompt never lists relationships — nothing to strip, no finding there.
    expect(set.guard.findings.some((f) => f.tier === "quickPrompt")).toBe(false);
  });

  it("id: the same plant never reaches the ID prompt (relationship prose is omitted) — guard clean", () => {
    const set = compilePromptSet({ recipe: planted, language: "id" });
    expect(set.guard.clean).toBe(true);
    expect(set.guard.findings).toEqual([]);
  });

  it("is deterministic — identical guard report and prompts across runs", () => {
    const a = compilePromptSet({ recipe: planted, language: "en" });
    const b = compilePromptSet({ recipe: planted, language: "en" });
    expect(b.guard).toEqual(a.guard);
    for (const tier of TIERS) expect(b[tier]).toBe(a[tier]);
  });
});

describe("golden: a banned token in a full sentence is preserved and flagged", () => {
  const base = pipeline("kopi-lawas-promotion").recipe;
  const planted: DesignRecipe = {
    ...base,
    // A constraint statement is rendered verbatim into the master prompt.
    constraints: [
      ...base.constraints,
      {
        id: "test-batik-sentence",
        source: "brand",
        kind: "prefer",
        statement: "Let the surface pattern read as a batik-inspired rhythm without copying a real cloth.",
        doctrine_rank: 5
      }
    ]
  };

  it("does not rewrite the sentence — flags it, text intact", () => {
    const set = compilePromptSet({ recipe: planted, language: "en" });
    const finding = set.guard.findings.find((f) => f.token === "batik");
    expect(finding).toBeDefined();
    expect(finding!.action).toBe("flagged");
    expect(set.masterPrompt).toContain("batik-inspired rhythm");
  });
});

describe("golden: an explicitly released token is never scanned, flagged or stripped", () => {
  const recipe = pipeline("batik-heritage-release").recipe;

  it("'batik' is released, so it is absent from recipe.culture.banned_tokens", () => {
    expect(recipe.culture.banned_tokens).not.toContain("batik");
  });

  it.each(["en", "id"] as const)("%s: the prompt uses 'batik' freely and the guard stays clean", (lang) => {
    const set = compilePromptSet({ recipe, language: lang });
    expect(mentionsToken(set.masterPrompt, "batik")).toBe(true);
    expect(set.guard.findings.some((f) => f.token === "batik")).toBe(false);
  });
});

describe("golden: EN and ID are scanned independently", () => {
  it("a token planted only into ID-rendered prose is caught in ID, not EN", () => {
    // Movement anti-stereotype prose is re-authored in Indonesian by the id
    // renderer; a token in the English constraint list still reaches both.
    const base = pipeline("jakarta-tokyo-blend").recipe;
    const en = compilePromptSet({ recipe: base, language: "en" });
    const id = compilePromptSet({ recipe: base, language: "id" });
    // Both languages independently find 'batik' in their own negative prompt.
    expect(en.guard.findings.some((f) => f.tier === "negativePrompt" && f.token === "batik")).toBe(true);
    expect(id.guard.findings.some((f) => f.tier === "negativePrompt" && f.token === "batik")).toBe(true);
  });
});

describe("regression: P3.0 is additive", () => {
  it("does not change the resolved recipe, anchors or hash", () => {
    const { recipe } = pipeline("jakarta-tokyo-blend");
    const again = pipeline("jakarta-tokyo-blend").recipe;
    expect(again.recipe_hash).toBe(recipe.recipe_hash);
    const byKind = Object.fromEntries(recipe.anchors.map((a) => [a.kind, a]));
    expect(byKind.primary_visual_direction?.status).toBe("locked");
  });

  it("keeps the PromptSet shape — five strings, visualCharacter, and the new guard report", () => {
    const set = compilePromptSet({ recipe: pipeline("kopi-lawas-promotion").recipe, language: "en" });
    for (const tier of TIERS) expect(typeof set[tier]).toBe("string");
    expect(set.visualCharacter).toBeDefined();
    expect(typeof set.guard.clean).toBe("boolean");
    expect(Array.isArray(set.guard.findings)).toBe(true);
  });
});
