import type { ImmutableAnchor } from "../../types/schemas/contract.schema";
import { AnchorViolationError } from "../../domain/errors";

/**
 * Immutable anchors across the recipe stage (P1 spec §10).
 *
 * The contract locks brand, objective and core message. The primary visual
 * direction cannot be locked until a direction exists, so the recipe locks it
 * here. Concept stays pending until P2.
 *
 * assertAnchorsIntact is deliberately a throwing function. An anchor violation
 * is not a warning to be logged and stepped over — it means a correction has
 * quietly changed what the work is, which is the exact drift the whole
 * mechanism exists to prevent.
 */

export const PRIMARY_DIRECTION_ANCHOR = "primary_visual_direction";
export const CONCEPT_ANCHOR = "concept";

/** Lock the primary visual direction once a direction has been chosen. */
export function lockDirectionAnchor(
  anchors: readonly ImmutableAnchor[],
  value: string
): ImmutableAnchor[] {
  return anchors.map((anchor) =>
    anchor.kind === PRIMARY_DIRECTION_ANCHOR
      ? {
          ...anchor,
          value,
          status: "locked" as const,
          rationale:
            "Locked at the recipe stage. Correction patches may adjust spacing, scale, crop and lighting; changing the movement, layout or composition strategy is a new direction, not a correction."
        }
      : anchor
  );
}

/** Differences between two anchor sets, as human-readable strings. */
export function anchorViolations(
  before: readonly ImmutableAnchor[],
  after: readonly ImmutableAnchor[]
): string[] {
  const violations: string[] = [];
  const afterByKind = new Map(after.map((anchor) => [anchor.kind, anchor]));

  for (const anchor of before) {
    if (anchor.status !== "locked") continue;
    const next = afterByKind.get(anchor.kind);

    if (!next) {
      violations.push(`anchor "${anchor.kind}" was removed (was "${anchor.value}")`);
      continue;
    }
    if (next.value !== anchor.value) {
      violations.push(
        `anchor "${anchor.kind}" changed from "${anchor.value}" to "${next.value}"`
      );
    }
    if (next.status !== "locked") {
      violations.push(`anchor "${anchor.kind}" was unlocked (status became "${next.status}")`);
    }
  }

  return violations;
}

/** Throws AnchorViolationError if any locked anchor moved. */
export function assertAnchorsIntact(
  before: readonly ImmutableAnchor[],
  after: readonly ImmutableAnchor[]
): void {
  const violations = anchorViolations(before, after);
  if (violations.length > 0) throw new AnchorViolationError(violations);
}

/**
 * Lock the concept anchor once a concept has been selected (P2.2).
 *
 * The value is `<concept id>@<concept hash>`. The hash is what gives the anchor
 * teeth: swapping in a different concept with the same id, or editing the idea
 * in place, both change the hash and both trip assertAnchorsIntact. An id alone
 * would let the idea be rewritten underneath the anchor without anyone noticing.
 *
 * This uses the same anchor mechanism as every other anchor. There is no
 * parallel system for concepts.
 */
export function lockConceptAnchor(
  anchors: readonly ImmutableAnchor[],
  conceptId: string,
  conceptHash: string
): ImmutableAnchor[] {
  return anchors.map((anchor) =>
    anchor.kind === CONCEPT_ANCHOR
      ? {
          ...anchor,
          value: `${conceptId}@${conceptHash}`,
          status: "locked" as const,
          rationale:
            "Locked when the concept was selected. Correction patches may adjust how the idea is executed; replacing the idea itself is a new project stage, not a correction, and must go through an explicit revision."
        }
      : anchor
  );
}
