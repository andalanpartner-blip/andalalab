import type { DesignRecipe } from "../../types/schemas/recipe.schema";
import type { RecipeDiff } from "../recipe/diff";
import type { CorrectionOutcome } from "../../types/schemas/correction.schema";

/**
 * Classify a recipe diff as `adjustment` / `redesign` / `noop` (P6).
 *
 * Pure and deterministic — a predicate over a `RecipeDiff`, no engine calls.
 *
 * A change to any of these paths is a REDESIGN, not a correction: it changes
 * what the work IS, which the immutable anchors exist to prevent. The bounded
 * P6 patch surface cannot target them, so this is a belt-and-suspenders guard
 * — it also catches a hand-crafted or future patch that tried.
 */
export const STRUCTURAL_PREFIXES: readonly string[] = [
  "objective",
  "core_message",
  "concept_ref",
  "movement.id",
  "movement.name",
  "composition.strategy",
  "typography.strategy",
  "grid.columns",
  "grid.rows",
  "hierarchy.reading_order",
  "hierarchy.levels",
  "culture.dimensions",
  "culture.blend",
  "platform.channel",
  "platform.aspect_ratio_id"
];

function isStructural(path: string): boolean {
  return STRUCTURAL_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}.`));
}

/** Paths that change on every derived recipe by construction — never real signal. */
const LINEAGE_PATHS = new Set(["contract_id", "derived_from"]);
const isSignal = (path: string): boolean => !LINEAGE_PATHS.has(path);

export type DiffClassification = {
  readonly outcome: CorrectionOutcome;
  /** Paths that make this a redesign — empty unless `outcome === "redesign"`. */
  readonly structural_changes: readonly string[];
};

export function classifyRecipeDiff(
  diff: RecipeDiff,
  _before: DesignRecipe,
  _after: DesignRecipe
): DiffClassification {
  const signalChanges = diff.changed.filter((change) => isSignal(change.path));
  const signalAddedRemoved = [...diff.added, ...diff.removed].filter(isSignal);

  if (diff.identical || (signalChanges.length === 0 && signalAddedRemoved.length === 0 && diff.anchor_violations.length === 0)) {
    return { outcome: "noop", structural_changes: [] };
  }

  const structural = new Set<string>();
  for (const change of signalChanges) {
    if (isStructural(change.path)) structural.add(change.path);
  }
  for (const path of signalAddedRemoved) {
    if (isStructural(path)) structural.add(path);
  }

  if (diff.anchor_violations.length > 0 || structural.size > 0) {
    return {
      outcome: "redesign",
      structural_changes: [
        ...structural,
        ...diff.anchor_violations.map((violation) => `anchor: ${violation}`)
      ].sort()
    };
  }

  return { outcome: "adjustment", structural_changes: [] };
}
