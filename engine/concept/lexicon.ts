import type { DatasetRegistry } from "../../types/datasets";
import type { ConceptLexicon } from "../../types/schemas/reference/lexicon.schema";

/** The lexicon id every concept function reads. */
export const CONCEPT_LEXICON_ID = "concept-language";

export function conceptLexicon(datasets: DatasetRegistry): ConceptLexicon | null {
  return datasets.lexicons.get(CONCEPT_LEXICON_ID) ?? null;
}

/** Lowercase word tokens, punctuation stripped, Unicode-aware for Indonesian. */
export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/** Tokens that carry meaning: not function words, not one or two letters. */
export function contentWords(text: string, lexicon: ConceptLexicon): string[] {
  const stop = new Set(lexicon.stopwords);
  return tokenise(text).filter((token) => token.length > 2 && !stop.has(token));
}

/**
 * The comparison signature.
 *
 * Styling vocabulary is removed before anything is compared, which is what
 * makes "beige background" and "cream background" collapse into the same
 * signature. A repaint is not a concept.
 */
export function lexicalSignature(text: string, lexicon: ConceptLexicon): string[] {
  const styling = new Set(lexicon.styling_words);
  const vague = new Set(lexicon.vague_words);
  return [
    ...new Set(
      contentWords(text, lexicon).filter((token) => !styling.has(token) && !vague.has(token))
    )
  ].sort();
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 1 : shared / union;
}

/** Which metaphor family a text belongs to, by keyword weight. Ties break alphabetically. */
export function deriveMetaphorFamily(text: string, lexicon: ConceptLexicon): string {
  const tokens = new Set(tokenise(text));
  const scores = Object.entries(lexicon.metaphor_families)
    .map(([family, keywords]) => ({
      family,
      hits: keywords.filter((keyword) => tokens.has(keyword.toLowerCase())).length
    }))
    .sort((a, b) => (b.hits === a.hits ? a.family.localeCompare(b.family) : b.hits - a.hits));

  const best = scores[0];
  return best && best.hits > 0 ? best.family : "unclassified";
}
