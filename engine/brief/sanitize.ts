import type { BriefExtraction } from "./extraction";

/**
 * Post-validation hygiene.
 *
 * Zod proved the shape is right. It cannot prove the content is sane: a model
 * will happily return a mandatory nobody asked for, a URL with a tracking
 * parameter, or the same prohibition three times. None of that is a schema
 * error, and all of it would reach the contract unchallenged.
 */

const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();

/** Trim, collapse whitespace, drop empties, dedupe — order preserved. */
export function cleanList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const cleaned = collapse(raw);
    if (cleaned.length === 0) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }
  return output;
}

/** Strip common tracking parameters and fragments; leave non-URLs untouched. */
export function normaliseReference(value: string): string {
  const cleaned = collapse(value);
  if (!/^https?:\/\//i.test(cleaned)) return cleaned;
  try {
    const url = new URL(cleaned);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|igshid|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return cleaned;
  }
}

/** Words too common to count as evidence that a phrase came from the brief. */
const STOPWORDS = new Set([
  "dan", "yang", "untuk", "di", "ke", "dari", "dengan", "atau", "ini", "itu",
  "the", "and", "for", "with", "from", "this", "that", "our", "your", "a", "an"
]);

const tokenise = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));

/**
 * How much of a phrase actually appears in the source brief.
 *
 * A mandatory the client never wrote is the most damaging thing an interpreter
 * can produce: it becomes a hard constraint the whole engine then obeys. This
 * cannot catch every fabrication, but it catches the confident ones.
 */
export function sourceOverlap(phrase: string, rawBrief: string): number {
  const tokens = tokenise(phrase);
  if (tokens.length === 0) return 1;
  const source = new Set(tokenise(rawBrief));
  const hits = tokens.filter((token) => source.has(token)).length;
  return hits / tokens.length;
}

/** Below this share of shared words, a phrase is reported as possibly invented. */
export const INVENTION_THRESHOLD = 0.34;
/** Phrases shorter than this are too small for overlap to mean anything. */
export const MIN_TOKENS_TO_CHECK = 3;

export type SanitizeResult = {
  readonly extraction: BriefExtraction;
  readonly warnings: string[];
};

export function sanitizeExtraction(
  extraction: BriefExtraction,
  rawBrief: string
): SanitizeResult {
  const warnings: string[] = [];

  const checkInvention = (values: readonly string[], label: string): string[] => {
    const cleaned = cleanList(values);
    for (const value of cleaned) {
      if (tokenise(value).length < MIN_TOKENS_TO_CHECK) continue;
      const overlap = sourceOverlap(value, rawBrief);
      if (overlap < INVENTION_THRESHOLD) {
        warnings.push(
          `Possible invention in ${label}: "${value}" shares ${Math.round(
            overlap * 100
          )}% of its words with the brief. Confirm with the client before treating it as a requirement.`
        );
      }
    }
    return cleaned;
  };

  const audience = extraction.audience;
  const ageMin = audience.age_min.value;
  const ageMax = audience.age_max.value;
  let fixedMin = ageMin;
  let fixedMax = ageMax;

  if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
    fixedMin = ageMax;
    fixedMax = ageMin;
    warnings.push(
      `Audience age range arrived reversed (${ageMin}–${ageMax}) and was swapped.`
    );
  }

  // Country weights are the client's intent; renormalising is arithmetic, not
  // interpretation, so it is done here rather than sent back to the model.
  const countryTotal = extraction.countries.reduce((sum, entry) => sum + entry.weight, 0);
  const countries =
    countryTotal > 0
      ? extraction.countries.map((entry) => ({
          ...entry,
          weight: Math.round((entry.weight / countryTotal) * 10_000) / 10_000
        }))
      : extraction.countries;

  if (countryTotal > 0 && Math.abs(countryTotal - 1) > 0.001) {
    warnings.push(
      `Country weights summed to ${countryTotal.toFixed(2)} and were normalised to 1.`
    );
  }

  const duplicateCountries = countries.length !== new Set(countries.map((c) => c.id)).size;
  if (duplicateCountries) {
    warnings.push("The same country was listed more than once; duplicates were merged.");
  }

  const mergedCountries = [...countries]
    .reduce<typeof countries>((accumulator, entry) => {
      const existing = accumulator.find((item) => item.id === entry.id);
      if (existing) {
        return accumulator.map((item) =>
          item.id === entry.id
            ? { ...item, weight: Math.round((item.weight + entry.weight) * 10_000) / 10_000 }
            : item
        );
      }
      return [...accumulator, entry];
    }, [])
    .sort((a, b) => (b.weight === a.weight ? a.id.localeCompare(b.id) : b.weight - a.weight));

  for (const note of extraction.contradictions) {
    warnings.push(`Brief contradiction reported by the interpreter: ${note}`);
  }

  return {
    extraction: {
      ...extraction,
      audience: {
        ...audience,
        description: {
          ...audience.description,
          value: audience.description.value ? collapse(audience.description.value) : null
        },
        age_min: { ...audience.age_min, value: fixedMin },
        age_max: { ...audience.age_max, value: fixedMax },
        cultural_context: cleanList(audience.cultural_context)
      },
      core_message: {
        ...extraction.core_message,
        value: extraction.core_message.value ? collapse(extraction.core_message.value) : null
      },
      countries: mergedCountries,
      deliverables: cleanList(extraction.deliverables),
      mandatories: checkInvention(extraction.mandatories, "mandatories"),
      prohibitions: checkInvention(extraction.prohibitions, "prohibitions"),
      style_notes: cleanList(extraction.style_notes),
      visual_references: cleanList(extraction.visual_references).map(normaliseReference),
      contradictions: cleanList(extraction.contradictions)
    },
    warnings
  };
}
