import type { CountryDNA } from "../../types/schemas/reference/country.schema";
import type { DesignMovement } from "../../types/schemas/reference/movement.schema";
import type { IndustryDNA } from "../../types/schemas/reference/industry.schema";
import type { LayoutSystem } from "../../types/schemas/reference/layout.schema";
import type {
  ColorStrategy,
  CompositionStrategy,
  TypographyStrategy
} from "../../types/schemas/direction.schema";
import { clampRatio, round } from "../dkv/params";

/**
 * Derived strategies.
 *
 * Colour, composition and typography strategies are FUNCTIONS of the movement,
 * layout, country and industry — not independent candidate axes. Enumerating
 * them would multiply the search space without adding information and would
 * let the scorer select a palette that contradicts the movement that produced
 * it. Deriving them keeps the candidate space at movements × layouts and keeps
 * every strategy internally coherent by construction.
 *
 * Every threshold below is named and documented. None of them is tuned to make
 * a particular fixture pass.
 */

/** Weighting of the three chroma inputs. Movement leads because it owns palette logic. */
const CHROMA_WEIGHTS = { movement: 0.45, country: 0.35, industry: 0.2 } as const;

/** Industry may exceed its own colour ceiling by this much before strategy demotion. */
const CHROMA_CEILING_SLACK = 0.15;

/** Chroma thresholds separating the five colour strategies. */
const CHROMA_BANDS = { restrained: 0.3, single: 0.45, duotone: 0.62 } as const;

export function deriveColorStrategy(
  movement: DesignMovement,
  countrySaturation: number,
  industry: IndustryDNA
): { strategy: ColorStrategy; chroma: number } {
  const raw =
    CHROMA_WEIGHTS.movement * movement.color.saturation_bias +
    CHROMA_WEIGHTS.country * countrySaturation +
    CHROMA_WEIGHTS.industry * industry.emotion_pressure;

  const chroma = round(
    clampRatio(Math.min(raw, industry.dkv_ceiling.color_complexity + CHROMA_CEILING_SLACK))
  );

  if (movement.color.palette_size <= 2) return { strategy: "monochrome-structural", chroma };
  if (chroma < CHROMA_BANDS.restrained) return { strategy: "restrained-neutral", chroma };
  if (chroma < CHROMA_BANDS.single) return { strategy: "single-accent", chroma };
  if (chroma < CHROMA_BANDS.duotone) return { strategy: "duotone-editorial", chroma };
  return { strategy: "high-chroma-vernacular", chroma };
}

/** A layout whose image or hero zone claims this much is image-led by definition. */
const IMAGE_LED_SHARE = 0.6;
/** At or above this modularity a movement is grid-governed rather than composed by eye. */
const MODULAR_THRESHOLD = 0.8;

export function deriveCompositionStrategy(
  movement: DesignMovement,
  layout: LayoutSystem,
  compositionCountry: CountryDNA | null
): CompositionStrategy {
  const imageShare = layout.zones
    .filter((zone) => zone.id === "image" || zone.id === "hero")
    .reduce((total, zone) => total + zone.area_share, 0);

  if (imageShare >= IMAGE_LED_SHARE) return "full-bleed-focal";
  if (movement.grid.modularity >= MODULAR_THRESHOLD) return "modular-grid";
  if (compositionCountry?.composition.symmetry === "asymmetric") return "asymmetric-editorial";
  if (layout.flow === "centre-out") return "centred-frontal";
  return "stacked-vertical";
}

/** Scale ratios run 1..4; normalise before mixing with an area share. */
const SCALE_MIN = 1;
const SCALE_MAX = 4;
/** Above this blended display pressure the type carries the surface. */
const DISPLAY_PRESSURE = 0.4;
/** At or above this modularity the type serves a system rather than expresses. */
const SYSTEMATIC_THRESHOLD = 0.85;

export function deriveTypographyStrategy(
  movement: DesignMovement,
  layout: LayoutSystem,
  typographyCountry: CountryDNA | null
): TypographyStrategy {
  const headlineShare = layout.zones
    .filter((zone) => zone.id === "headline")
    .reduce((total, zone) => total + zone.area_share, 0);

  const normalisedScale =
    (movement.typography.scale_ratio - SCALE_MIN) / (SCALE_MAX - SCALE_MIN);
  const displayPressure = 0.5 * normalisedScale + 0.5 * headlineShare;

  if (displayPressure >= DISPLAY_PRESSURE) return "display-dominant";
  if (movement.grid.modularity >= SYSTEMATIC_THRESHOLD) return "neutral-system";
  const weight = typographyCountry?.typography.weight_bias;
  if (weight === "bold" || weight === "mixed") return "editorial-contrast";
  return "structural-mono";
}
