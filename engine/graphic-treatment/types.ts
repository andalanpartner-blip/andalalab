import type { AudienceSpec, CommunicationObjective } from "../../types/schemas/brief.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type { DkvParams } from "../../types/schemas/dkv.schema";
import type { IndustryDNA } from "../../types/schemas/reference/industry.schema";
import type { DesignMovement } from "../../types/schemas/reference/movement.schema";
import type { LayoutSystem } from "../../types/schemas/reference/layout.schema";
import type {
  GraphicDeviceCategory,
  GraphicDevicePurpose,
  GraphicTreatmentIntensity
} from "../../types/schemas/graphic-treatment.schema";

/**
 * Engine-internal device metadata.
 *
 * This is deliberately NOT the same shape as `SelectedGraphicDevice`
 * (types/schemas/graphic-treatment.schema.ts). This record carries the
 * compatibility, gating and pairing rules the resolver needs; the recipe only
 * ever receives the trimmed, already-decided result. Keeping the two shapes
 * separate is the same reasoning behind DesignMovement vs. the recipe's
 * MovementSpec.
 */
export type GraphicDevice = {
  readonly id: string;
  readonly category: GraphicDeviceCategory;
  readonly name: string;
  /** A device MUST declare a purpose. "Looks cool" is not a valid value (doctrine §20). */
  readonly purpose: readonly GraphicDevicePurpose[];
  /** Movement ids this device suits. Empty = compatible with every movement (a structural or textural device with no stylistic opinion). */
  readonly compatibleMovements: readonly string[];
  /** Industry ids this device suits. Empty = no industry restriction. */
  readonly compatibleIndustries: readonly string[];
  /** Industry ids this device must never be used for, regardless of `compatibleIndustries`. */
  readonly incompatibleIndustries: readonly string[];
  /** Objective ids this device suits. Empty = no objective restriction. */
  readonly suitableObjectives: readonly string[];
  /** Minimum treatment intensity this device may appear at. */
  readonly minIntensity: GraphicTreatmentIntensity;
  /** Gate: excluded once the industry's trust pressure crosses FORMAL_TRUST_THRESHOLD — the generic "conflicts with luxury / formal institutional work" rule (doctrine §12). */
  readonly expressiveAudienceOnly: boolean;
  /** Gate: excluded when the layout's required zones carry dense body copy. */
  readonly conflictsWithDenseCopy: boolean;
  /** Gate: reduced (excluded) when the recipe's own visual density is already high. */
  readonly reduceIfDenseImagery: boolean;
  /** Gate: only usable on a layout whose grid actually has enough columns to carry it. */
  readonly requiresGrid: boolean;
  /** Device ids this one coordinates with. A small scoring bonus when both are already selected. */
  readonly pairsWith: readonly string[];
  /** Device ids this one conflicts with. At most one of a conflicting pair survives. */
  readonly avoidWith: readonly string[];
  /** Documents why a device that risks reading as a cultural cliché is scoped the way it is (doctrine §11). Null when the device carries no such risk. */
  readonly culturalNote: string | null;
  readonly promptEn: string;
  readonly promptId: string;
};

export type GraphicTreatmentInput = {
  readonly objective: CommunicationObjective;
  readonly audience: AudienceSpec;
  readonly industry: IndustryDNA;
  readonly movement: DesignMovement;
  readonly layout: LayoutSystem;
  readonly dkv: DkvParams;
  /** The recipe's own resolved graphic_language.ornament — already a country/movement blend. Reused, never recomputed. */
  readonly ornament: number;
  /** Whether the layout carries a required, high-priority body-copy zone (dense information load). */
  readonly hasDenseBodyCopy: boolean;
  /** The final banned-token list for this recipe's country blend (contract.banned_tokens). */
  readonly bannedTokens: readonly string[];
  readonly concept?: CreativeConcept | null;
};
