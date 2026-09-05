import type { DesignContract, ImmutableAnchor } from "../types/schemas/contract.schema";

/**
 * Contract-level invariants and helpers.
 *
 * The contract is immutable by construction. Freezing is not paranoia: the same
 * object is handed to the direction engine, the concept engine, the prompt
 * compiler and the critic, and a single accidental mutation anywhere would
 * silently invalidate every artifact downstream of it.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.getOwnPropertyNames(value).forEach((key) => {
    deepFreeze((value as Record<string, unknown>)[key]);
  });
  return Object.freeze(value);
}

export function findAnchor(
  contract: DesignContract,
  kind: ImmutableAnchor["kind"]
): ImmutableAnchor | null {
  return contract.anchors.find((anchor) => anchor.kind === kind) ?? null;
}

/**
 * Would a proposed change touch a locked anchor?
 *
 * Used by the correction engine in P6. It returns the anchor rather than a
 * boolean because the answer the user needs is "this would change the concept",
 * not "denied".
 */
export function violatedAnchors(
  contract: DesignContract,
  changedKinds: readonly ImmutableAnchor["kind"][]
): readonly ImmutableAnchor[] {
  return contract.anchors.filter(
    (anchor) => anchor.status === "locked" && changedKinds.includes(anchor.kind)
  );
}

export function isFullyLocked(contract: DesignContract): boolean {
  return contract.anchors.every((anchor) => anchor.status === "locked");
}
