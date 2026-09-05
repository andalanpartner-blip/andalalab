/** Stable machine-readable codes. The UI maps these to messages, never to strings. */
export const CONTRACT_ERROR_CODES = [
  "brief_invalid",
  "unknown_industry",
  "unknown_visual_type",
  "unknown_country",
  "unknown_movement",
  "unknown_layout",
  "unknown_aspect_ratio",
  "layout_not_supported_by_visual_type",
  "brand_required",
  "brand_mismatch",
  "contract_invalid"
] as const;

export type ContractErrorCode = (typeof CONTRACT_ERROR_CODES)[number];

export type ContractIssue = {
  readonly code: ContractErrorCode;
  readonly path: string;
  readonly message: string;
};

export const issue = (code: ContractErrorCode, path: string, message: string): ContractIssue => ({
  code,
  path,
  message
});

/** Direction and recipe failures. Same shape, separate vocabulary. */
export const DIRECTION_ERROR_CODES = [
  "no_candidates",
  "no_viable_candidate",
  "direction_invalid",
  "recipe_invalid",
  "anchor_violation",
  "missing_reference"
] as const;

export type DirectionErrorCode = (typeof DIRECTION_ERROR_CODES)[number];

export type DirectionIssue = {
  readonly code: DirectionErrorCode;
  readonly path: string;
  readonly message: string;
};

export const directionIssue = (
  code: DirectionErrorCode,
  path: string,
  message: string
): DirectionIssue => ({ code, path, message });

/** Thrown by assertAnchorsIntact. Anchors are not advisory. */
export class AnchorViolationError extends Error {
  public readonly violations: readonly string[];
  constructor(violations: readonly string[]) {
    super(`Immutable anchor violated:\n  - ${violations.join("\n  - ")}`);
    this.name = "AnchorViolationError";
    this.violations = violations;
  }
}
