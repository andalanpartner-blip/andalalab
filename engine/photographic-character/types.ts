import type { AudienceSpec, CommunicationObjective } from "../../types/schemas/brief.schema";
import type { CreativeConcept } from "../../types/schemas/concept.schema";
import type { DkvParams } from "../../types/schemas/dkv.schema";
import type { GraphicTreatmentIntensity } from "../../types/schemas/graphic-treatment.schema";
import type { IndustryDNA } from "../../types/schemas/reference/industry.schema";
import type { DesignMovement } from "../../types/schemas/reference/movement.schema";
import type { VisualType } from "../../types/schemas/reference/visual-type.schema";

/**
 * The input to the Photographic Character resolver (P2.6).
 *
 * Everything here is ALREADY RESOLVED by an earlier layer. The resolver reads
 * these values and derives an optical/material description from them — it never
 * recomputes an industry, movement, colour or lighting decision, and it never
 * receives a country id. Country influence only reaches this layer indirectly,
 * through recipe dimensions the country blend already shaped (imagery realism,
 * lighting bias, materiality texture, colour saturation).
 */
export type PhotographicCharacterInput = {
  readonly objective: CommunicationObjective;
  readonly audience: AudienceSpec;
  readonly industry: IndustryDNA;
  readonly visualType: VisualType;
  readonly movement: DesignMovement;

  /** recipe.imagery.realism — the already-blended realism bias. */
  readonly imageryRealism: number;
  /** recipe.imagery.framing — quoted dataset prose, scanned only for banned tokens. */
  readonly framing: string;
  /** recipe.lighting.contrast (== dkv.contrast). */
  readonly lightingContrast: number;
  /** recipe.lighting.direction — quoted dataset prose. */
  readonly lightingDirectionText: string;

  readonly colorStrategy: string;
  /** recipe.color.saturation — country/movement blend, reused. */
  readonly colorSaturation: number;
  /** recipe.color.contrast (== dkv.contrast). */
  readonly colorContrast: number;
  /** recipe.color.complexity (== dkv.color_complexity). */
  readonly colorComplexity: number;

  /** recipe.materiality.texture. */
  readonly materialityTexture: number;
  /** recipe.materiality.surfaces. */
  readonly materialitySurfaces: readonly string[];

  readonly compositionStrategy: string;
  readonly graphicTreatmentIntensity: GraphicTreatmentIntensity;

  readonly dkv: DkvParams;
  /** contract.banned_tokens — the resolved country-blend stereotype guard. */
  readonly bannedTokens: readonly string[];

  readonly concept?: CreativeConcept | null;
};

/** What the composition is physically about — the single most load-bearing signal. */
export type SubjectKind = "human" | "product" | "environment" | "type" | "mixed";
