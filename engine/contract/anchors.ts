import type { ImmutableAnchor } from "../../types/schemas/contract.schema";
import type { BrandSnapshot } from "../../types/schemas/brand.schema";
import type { NormalizedBrief } from "../../types/schemas/brief.schema";

/**
 * Immutable anchors (doctrine §17).
 *
 * Anchors are the mechanism that stops a design drifting across correction
 * loops. Three can be fixed the moment the contract is built. Two cannot —
 * the concept and the primary visual direction do not exist yet — so they are
 * carried as `pending` and locked at the recipe stage in P1.
 *
 * A correction patch that would change a locked anchor is not silently
 * rejected: it escalates to human review, because the need for it usually
 * means the concept itself is wrong, not the execution.
 */
export function deriveAnchors(brief: NormalizedBrief, brand: BrandSnapshot | null): ImmutableAnchor[] {
  const anchors: ImmutableAnchor[] = [
    {
      kind: "objective",
      value: brief.objective,
      status: "locked",
      locked_at_stage: "contract",
      rationale:
        "The communication objective is doctrine rank 1. Every later decision is judged against it, so it cannot move without invalidating the work that followed it."
    },
    {
      kind: "core_message",
      value: brief.core_message,
      status: "locked",
      locked_at_stage: "contract",
      rationale:
        "The single thing the audience must take away. Corrections may change how it is said and never what is said."
    }
  ];

  if (brand) {
    anchors.push({
      kind: "brand",
      value: brand.brand_id,
      status: "locked",
      locked_at_stage: "contract",
      rationale:
        "Brand identity outranks country influence, movement and trend. It is snapshotted at contract time so the project stays readable even after the brand record changes."
    });
  }

  anchors.push(
    {
      kind: "concept",
      value: "",
      status: "pending",
      locked_at_stage: "concept",
      rationale:
        "Locked when the user approves a creative concept. Until then there is nothing to protect from drift."
    },
    {
      kind: "primary_visual_direction",
      value: "",
      status: "pending",
      locked_at_stage: "recipe",
      rationale:
        "Locked when the Design Recipe is built, so correction patches can adjust spacing, scale, crop and lighting without changing the direction itself."
    }
  );

  return anchors;
}

export function lockedAnchors(anchors: readonly ImmutableAnchor[]): readonly ImmutableAnchor[] {
  return anchors.filter((anchor) => anchor.status === "locked");
}
