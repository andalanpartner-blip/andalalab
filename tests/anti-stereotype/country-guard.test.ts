import { describe, expect, it } from "vitest";
import { loadDatasets } from "../../data/loader";
import { collectBannedTokens, mentionsToken, positiveFieldText } from "../../engine/country/anti-stereotype";
import { buildDesignContract } from "../../engine/contract/build";
import { clock, loadBrief, newIds } from "../fixtures/load";

/**
 * The anti-stereotype regression suite.
 *
 * Doctrine §5 says country influence must never become a motif engine. That is
 * a claim about output, so it needs a test that fails the build rather than a
 * paragraph in a prompt. Three levels are checked here:
 *
 *   1. every country declares a guard list at all;
 *   2. no country contradicts its own guard list;
 *   3. the guard reaches the contract, and is released only when the brief
 *      explicitly asks for the token.
 *
 * Level 1 and 2 apply automatically to any country added later. Level 3's
 * expectation table below covers the four MVP countries; a new country needs an
 * entry here only to get the extra scrutiny, never to load or validate.
 */
const registry = loadDatasets();

const MUST_DECLARE: Record<string, readonly string[]> = {
  indonesia: ["batik", "wayang", "borobudur"],
  japan: ["cherry blossom", "geisha", "mount fuji"],
  switzerland: ["swiss flag", "alps", "matterhorn"],
  "united-states": ["stars and stripes", "bald eagle", "cowboy"]
};

describe("country stereotype guards", () => {
  it("declares at least five guarded tokens per country", () => {
    for (const country of registry.countries.values()) {
      expect(country.avoid_stereotypes.length, country.id).toBeGreaterThanOrEqual(5);
    }
  });

  it("never uses a guarded token in the country's own descriptive fields", () => {
    for (const country of registry.countries.values()) {
      const positive = positiveFieldText(country);
      for (const entry of country.avoid_stereotypes) {
        expect(
          mentionsToken(positive, entry.token),
          `countries/${country.id} declares "${entry.token}" as a stereotype but uses it in its own descriptive fields`
        ).toBe(false);
      }
    }
  });

  it("declares the well-known shortcut for each MVP country", () => {
    for (const [countryId, expected] of Object.entries(MUST_DECLARE)) {
      const country = registry.countries.get(countryId);
      expect(country, countryId).toBeDefined();
      const declared = country!.avoid_stereotypes.map((entry) => entry.token);
      for (const token of expected) {
        expect(declared, `countries/${countryId} must guard "${token}"`).toContain(token);
      }
    }
  });

  it("explains what to do instead, not just what to avoid", () => {
    for (const country of registry.countries.values()) {
      for (const entry of country.avoid_stereotypes) {
        expect(entry.instead.length, `${country.id}/${entry.token}`).toBeGreaterThan(30);
        expect(entry.why.length, `${country.id}/${entry.token}`).toBeGreaterThan(30);
      }
    }
  });
});

describe("token matching", () => {
  it("matches on whole tokens, not substrings", () => {
    expect(mentionsToken("a batik pattern", "batik")).toBe(true);
    expect(mentionsToken("BATIK", "batik")).toBe(true);
    expect(mentionsToken("batiked surface", "batik")).toBe(false);
    expect(mentionsToken("prebatik", "batik")).toBe(false);
    expect(mentionsToken("under the alps today", "alps")).toBe(true);
    expect(mentionsToken("scalps", "alps")).toBe(false);
  });

  it("handles multi-word tokens", () => {
    expect(mentionsToken("a cherry blossom border", "cherry blossom")).toBe(true);
    expect(mentionsToken("cherry and blossom", "cherry blossom")).toBe(false);
  });
});

describe("guard release", () => {
  const indonesia = registry.countries.get("indonesia")!;

  it("bans every declared token by default", () => {
    const report = collectBannedTokens([{ country: indonesia, weight: 1 }], []);
    expect(report.banned).toContain("batik");
    expect(report.released).toHaveLength(0);
  });

  it("releases a token the brief explicitly asks for, and records why", () => {
    const report = collectBannedTokens(
      [{ country: indonesia, weight: 1 }],
      ["The client is a batik house and the fabric is the product"]
    );
    expect(report.banned).not.toContain("batik");
    expect(report.released.map((entry) => entry.token)).toContain("batik");
    expect(report.released[0]?.reason).toMatch(/explicitly requested/);
  });
});

describe("guards reach the contract", () => {
  it("carries banned tokens and a country constraint onto the built contract", () => {
    const result = buildDesignContract({
      projectId: "proj_test",
      brief: loadBrief("hardstone-property-trust"),
      brand: null,
      datasets: registry,
      clock,
      ids: newIds()
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.banned_tokens).toContain("batik");
    expect(result.value.banned_tokens).toContain("cherry blossom");

    const countryConstraints = result.value.constraints.filter(
      (constraint) => constraint.source === "country"
    );
    expect(countryConstraints).toHaveLength(2);
    for (const constraint of countryConstraints) {
      expect(constraint.kind).toBe("must_not");
      expect(constraint.statement).toMatch(/spatial behaviour/);
    }
  });

  it("does not ban a token the brief mandates", () => {
    const brief = loadBrief("hardstone-property-trust");
    const withMandate = {
      ...brief,
      mandatories: [...brief.mandatories, "Feature the batik workshop on the ground floor"]
    };

    const result = buildDesignContract({
      projectId: "proj_test",
      brief: withMandate,
      brand: null,
      datasets: registry,
      clock,
      ids: newIds()
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.banned_tokens).not.toContain("batik");
    expect(
      result.value.constraints.some((constraint) => constraint.id.startsWith("country-override"))
    ).toBe(true);
  });
});
