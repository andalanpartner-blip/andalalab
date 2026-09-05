import { describe, expect, it } from "vitest";
import { guardPromptSet, GUARDED_PROMPT_TIERS } from "../../engine/prompt/guard";

/**
 * The P3.0 stereotype / banned-token prompt output guard. Pure string logic —
 * no recipe, no LLM, no clock. `compilePromptSet` integration lives in
 * tests/golden/prompt-output-guard.golden.test.ts.
 */

const EMPTY_TIERS = Object.fromEntries(GUARDED_PROMPT_TIERS.map((t) => [t, ""])) as Record<
  (typeof GUARDED_PROMPT_TIERS)[number],
  string
>;

const withMaster = (masterPrompt: string) => ({ ...EMPTY_TIERS, masterPrompt });

describe("guardPromptSet: clean input", () => {
  it("reports clean when the banned list is empty", () => {
    const { report, set } = guardPromptSet(withMaster("A prompt mentioning batik freely."), []);
    expect(report.clean).toBe(true);
    expect(report.findings).toEqual([]);
    expect(set.masterPrompt).toBe("A prompt mentioning batik freely.");
  });

  it("reports clean when no banned token is present", () => {
    const { report } = guardPromptSet(withMaster("Warm neutrals, controlled contrast, believable light."), [
      "batik",
      "cherry blossom"
    ]);
    expect(report.clean).toBe(true);
  });

  it("passes non-guarded fields (e.g. visualCharacter) straight through", () => {
    const input = { ...withMaster("clean"), visualCharacter: { id: "photorealistic", label: "X", description: "Y" } };
    const { set } = guardPromptSet(input, ["batik"]);
    expect(set.visualCharacter).toEqual(input.visualCharacter);
  });
});

describe("guardPromptSet: boundary correctness (reuses mentionsToken)", () => {
  it("does not match a token inside a longer word", () => {
    const { report } = guardPromptSet(withMaster("A prebatik-era study of prebatikking surfaces."), ["batik"]);
    expect(report.clean).toBe(true);
  });

  it("matches a whole-word token case-insensitively", () => {
    const { report } = guardPromptSet(withMaster("Composition: BATIK, warm tones, earth."), ["batik"]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.token).toBe("batik");
  });

  it("matches a multi-word token only when contiguous", () => {
    const split = guardPromptSet(withMaster("cherry and blossom motifs"), ["cherry blossom"]);
    expect(split.report.clean).toBe(true);
    const joined = guardPromptSet(withMaster("Environment: cherry blossom, soft light, paper."), ["cherry blossom"]);
    expect(joined.report.findings).toHaveLength(1);
  });
});

describe("guardPromptSet: strip a standalone positive list item", () => {
  it("removes a token that is a whole comma-list item, keeping the list grammatical", () => {
    const { set, report } = guardPromptSet(
      withMaster("Colour: warm tones, batik, earth and clay, deep greens."),
      ["batik"]
    );
    expect(set.masterPrompt).toBe("Colour: warm tones, earth and clay, deep greens.");
    expect(report.findings).toEqual([
      { token: "batik", tier: "masterPrompt", action: "stripped", negative_context: false, context: "batik" }
    ]);
  });

  it("removes a first list item (eats the trailing delimiter)", () => {
    const { set } = guardPromptSet(withMaster("Relationships: batik, warm base, earthy clay."), ["batik"]);
    expect(set.masterPrompt).toBe("Relationships: warm base, earthy clay.");
  });

  it("removes a final list item and keeps the sentence's terminal period", () => {
    const { set } = guardPromptSet(withMaster("Relationships: warm base, earthy clay, batik."), ["batik"]);
    expect(set.masterPrompt).toBe("Relationships: warm base, earthy clay.");
  });

  it("removes a semicolon-delimited item", () => {
    const { set } = guardPromptSet(withMaster("Prefer soft light; batik; restrained retouching."), ["batik"]);
    expect(set.masterPrompt).toBe("Prefer soft light; restrained retouching.");
  });

  it("finds the list even when it opens mid-line after a colon", () => {
    const { set } = guardPromptSet(
      withMaster("Colour: a vernacular palette, saturation 52%. Relationships: batik, warm base, clay."),
      ["batik"]
    );
    expect(set.masterPrompt).toBe(
      "Colour: a vernacular palette, saturation 52%. Relationships: warm base, clay."
    );
  });
});

describe("guardPromptSet: flag (never rewrite) everything else", () => {
  it("does not strip a multi-word phrase — flags it, text unchanged", () => {
    const text = "Environment: framed by traditional batik motifs, soft daylight, paper.";
    const { set, report } = guardPromptSet(withMaster(text), ["batik"]);
    expect(set.masterPrompt).toBe(text);
    expect(report.findings[0]).toMatchObject({ action: "flagged", negative_context: false });
    expect(report.findings[0]!.context).toContain("batik");
  });

  it("does not strip a token embedded in a sentence — flags it, text unchanged", () => {
    const text = "The frame leans on a batik border to signal place.";
    const { set, report } = guardPromptSet(withMaster(text), ["batik"]);
    expect(set.masterPrompt).toBe(text);
    expect(report.findings[0]!.action).toBe("flagged");
  });

  it("does not strip when the item is the line's only segment", () => {
    const text = "batik";
    const { set, report } = guardPromptSet(withMaster(text), ["batik"]);
    expect(set.masterPrompt).toBe(text);
    expect(report.findings[0]!.action).toBe("flagged");
  });
});

describe("guardPromptSet: negative context is preserved, always", () => {
  it("flags and preserves a token inside an 'Avoid:' line", () => {
    const text = "Avoid: generic stock photos, No batik pattern as background, cluttered layouts.";
    const { set, report } = guardPromptSet(withMaster(text), ["batik"]);
    expect(set.masterPrompt).toBe(text);
    expect(report.findings[0]).toMatchObject({ action: "flagged", negative_context: true });
  });

  it("treats the whole Negative Prompt tier as a negative context", () => {
    const input = { ...EMPTY_TIERS, negativePrompt: "Avoid: batik, weak hierarchy." };
    const { set, report } = guardPromptSet(input, ["batik"]);
    // Even though 'batik' is a standalone list item here, it is NOT stripped.
    expect(set.negativePrompt).toBe("Avoid: batik, weak hierarchy.");
    expect(report.findings).toEqual([
      { token: "batik", tier: "negativePrompt", action: "flagged", negative_context: true, context: "batik" }
    ]);
  });

  it("recognises a segment-level negative cue ('No X', 'Never X', 'Tanpa X', 'Hindari X')", () => {
    for (const seg of ["No batik here", "Never batik", "Tanpa motif batik", "Hindari batik"]) {
      const { set, report } = guardPromptSet(withMaster(`Prefer clean forms, ${seg}, restrained colour.`), ["batik"]);
      expect(set.masterPrompt).toContain(seg);
      expect(report.findings[0]!.negative_context).toBe(true);
      expect(report.findings[0]!.action).toBe("flagged");
    }
  });
});

describe("guardPromptSet: determinism & multi-tier / multi-token", () => {
  it("is byte-identical across repeated calls", () => {
    const input = {
      ...EMPTY_TIERS,
      masterPrompt: "Colour: warm, batik, clay. Avoid: No cherry blossom border.",
      imageOnlyPrompt: "Environment: a batik-lined room.",
      negativePrompt: "Avoid: batik, cherry blossom, clutter."
    };
    const a = guardPromptSet(input, ["batik", "cherry blossom"]);
    const b = guardPromptSet(input, ["cherry blossom", "batik"]); // order must not matter
    expect(b).toEqual(a);
  });

  it("sorts findings by token, then tier order, then context", () => {
    const input = {
      ...EMPTY_TIERS,
      masterPrompt: "Colour: warm, batik, clay.",
      negativePrompt: "Avoid: cherry blossom, batik."
    };
    const { report } = guardPromptSet(input, ["batik", "cherry blossom"]);
    expect(report.findings.map((f) => `${f.token}:${f.tier}`)).toEqual([
      "batik:masterPrompt",
      "batik:negativePrompt",
      "cherry blossom:negativePrompt"
    ]);
  });

  it("de-duplicates and trims the banned list", () => {
    const { report } = guardPromptSet(withMaster("warm, batik, clay"), ["batik", " batik ", "batik", ""]);
    expect(report.findings.filter((f) => f.tier === "masterPrompt")).toHaveLength(1);
  });
});
