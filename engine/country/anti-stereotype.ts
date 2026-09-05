import type { CountryDNA } from "../../types/schemas/reference/country.schema";
import type { ResolvedCountry } from "./blend";

/**
 * Doctrine §5, made operational.
 *
 * Country influence must never collapse into a motif. Instructing a language
 * model not to reach for the obvious symbol is not enough — the model's priors
 * are stronger than the instruction — so every country declares the tokens that
 * must be filtered out of generated prompts, and P3 applies this list as a
 * post-compile filter on the prompt string rather than as a polite request.
 *
 * This is a default, not a censor. If the brief explicitly asks for a token
 * ("we are a heritage textile brand"), the author has overridden the default
 * knowingly and the token is released — and the override is recorded on the
 * contract so it is visible rather than silent.
 */
export type BannedTokenReport = {
  readonly banned: readonly string[];
  readonly released: readonly { token: string; reason: string }[];
};

const WORD_BOUNDARY = /[a-z0-9]/i;

/** Case-insensitive whole-token match, tolerant of multi-word tokens. */
export function mentionsToken(haystack: string, token: string): boolean {
  const text = haystack.toLowerCase();
  const needle = token.toLowerCase();
  let from = 0;

  for (;;) {
    const index = text.indexOf(needle, from);
    if (index === -1) return false;
    const before = index === 0 ? "" : text[index - 1] ?? "";
    const afterIndex = index + needle.length;
    const after = afterIndex >= text.length ? "" : text[afterIndex] ?? "";
    if (!WORD_BOUNDARY.test(before) && !WORD_BOUNDARY.test(after)) return true;
    from = index + 1;
  }
}

export function collectBannedTokens(
  resolved: readonly ResolvedCountry[],
  explicitMentions: readonly string[]
): BannedTokenReport {
  const banned = new Set<string>();
  const released: { token: string; reason: string }[] = [];

  for (const { country } of resolved) {
    for (const entry of country.avoid_stereotypes) {
      const requested = explicitMentions.find((mention) => mentionsToken(mention, entry.token));
      if (requested) {
        released.push({
          token: entry.token,
          reason: `explicitly requested by the brief: "${requested}"`
        });
        continue;
      }
      banned.add(entry.token);
    }
  }

  return {
    banned: [...banned].sort(),
    released: released.sort((a, b) => a.token.localeCompare(b.token))
  };
}

/**
 * Every positive field of a country file, flattened.
 *
 * Used by the anti-stereotype test suite: a token a country declares as a
 * stereotype must never appear in that same country's own descriptive fields.
 * An author who writes "batik-inspired" into `visual_traits` while also listing
 * it as forbidden has produced a file that argues with itself, and the build
 * should say so.
 */
export function positiveFieldText(country: CountryDNA): string {
  const { avoid_stereotypes: _ignored, ...positive } = country;
  return JSON.stringify(positive);
}
