/**
 * Constraint statements that assert an informational claim — a specific price
 * position, a luxury tier, a brand tone descriptor, a campaign message — that
 * the compiler has no concrete data for anywhere in `PromptBlocks`.
 *
 * `DesignRecipe.constraints` includes generic strategic guidance quoted from
 * the industry dataset's `communication_needs` (e.g. "state the occasion and
 * the price position clearly"). That guidance already did its job upstream —
 * it shaped DKV parameters and doctrine resolution in P1. Quoting it again
 * here, verbatim, as a literal instruction to an image generator asks the
 * generator to render or imply information (an actual price, an actual
 * message) that was never decided anywhere in the recipe or concept. That is
 * exactly the kind of invented decision this compiler must never produce, so
 * any constraint statement naming one of these unsupported concepts is
 * dropped before it reaches a renderer.
 *
 * This is a narrow, explicit list, not a heuristic: a constraint is excluded
 * only when it names one of these concepts, never for being long, generic, or
 * merely strategic in tone. A concrete fact — an actual price the brief
 * stated, an actual brand tone word from `BrandSnapshot.tone` — is never
 * filtered, because it isn't matched by these patterns; it would need to be
 * added to `PromptBlocks` as real data before it could be rendered at all.
 */
const UNSUPPORTED_CONCEPT_PATTERNS: readonly RegExp[] = [
  /price position/i,
  /luxury level/i,
  /brand tone/i,
  /campaign message/i
];

export function isUnsupportedConceptStatement(statement: string): boolean {
  return UNSUPPORTED_CONCEPT_PATTERNS.some((pattern) => pattern.test(statement));
}

export function excludeUnsupportedConcepts<T extends { readonly statement: string }>(
  items: readonly T[]
): T[] {
  return items.filter((item) => !isUnsupportedConceptStatement(item.statement));
}
