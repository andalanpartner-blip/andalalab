import type {
  GraphicDeviceCategory,
  GraphicTreatmentIntensity,
  GraphicTreatmentSpec,
  SelectedGraphicDevice
} from "../../types/schemas/graphic-treatment.schema";
import type { AudienceSpec, CommunicationObjective } from "../../types/schemas/brief.schema";
import { mentionsToken } from "../country/anti-stereotype";
import { clampRatio, round } from "../dkv/params";
import { GRAPHIC_DEVICES } from "./data";
import type { GraphicDevice, GraphicTreatmentInput } from "./types";

/**
 * The Graphic Treatment resolver (P2.5).
 *
 * This is downstream of every other decision (doctrine §14): every number it
 * reads — ornament, visual density, focal dominance, industry pressure — has
 * already been resolved by the DKV doctrine engine (engine/dkv, engine/decision)
 * before this function ever runs. Nothing here re-litigates a movement,
 * industry or audience decision; it only asks "given what was already decided,
 * which graphic devices (if any) support it, and how much".
 *
 * Everything below is deterministic arithmetic over the recipe's own resolved
 * values. No randomness, no LLM, no invented device — see
 * docs/graphic-treatment-engine.md for the full rationale.
 */

const INTENSITY_ORDER: readonly GraphicTreatmentIntensity[] = [
  "none",
  "minimal",
  "moderate",
  "expressive",
  "experimental"
];

function rankOfIntensity(level: GraphicTreatmentIntensity): number {
  return INTENSITY_ORDER.indexOf(level);
}

/** Never raises intensity — only ever pulls it down toward `cap`. */
function capIntensity(
  level: GraphicTreatmentIntensity,
  cap: GraphicTreatmentIntensity
): GraphicTreatmentIntensity {
  return rankOfIntensity(level) <= rankOfIntensity(cap) ? level : cap;
}

// --- Intensity scoring -------------------------------------------------------

/**
 * How much of the intensity score each already-resolved signal contributes.
 * Ornament leads because it is the recipe's own decorative-bias number
 * (graphic_language.ornament); density and focal room are the DKV parameters
 * that describe how much room the composition actually has for supporting
 * devices; industry allowance is the only signal computed fresh here, from
 * the industry's own pressure values (never a hand-tuned per-industry constant).
 */
const INTENSITY_WEIGHTS = {
  ornament: 0.35,
  density: 0.25,
  focalRoom: 0.2,
  industryAllowance: 0.2
} as const;

/**
 * An industry's aesthetic and emotional pressure make room for graphic
 * devices; its trust and information pressure ask for restraint (doctrine
 * §8, §10). Computed from the five pressure values every IndustryDNA file
 * already carries — no per-industry lookup table.
 */
function industryAllowance(industry: GraphicTreatmentInput["industry"]): number {
  const raw =
    0.5 +
    0.4 * industry.aesthetic_pressure +
    0.3 * industry.emotion_pressure -
    0.4 * industry.trust_pressure -
    0.3 * industry.information_pressure;
  return clampRatio(raw);
}

/** Audience midpoint at or below this reads as a youth-leaning audience (doctrine §9). */
const YOUTH_MIDPOINT_CEILING = 30;
/** Audience midpoint at or above this reads as a professional-leaning audience. */
const PROFESSIONAL_MIDPOINT_FLOOR = 40;
/** Sophistication at or above this, combined with low price sensitivity, reads as a refined/luxury-leaning audience. */
const REFINED_SOPHISTICATION_FLOOR = 0.75;
const REFINED_PRICE_SENSITIVITY_CEILING = 0.3;

function isRefinedAudience(audience: AudienceSpec): boolean {
  return (
    audience.sophistication >= REFINED_SOPHISTICATION_FLOOR &&
    audience.price_sensitivity <= REFINED_PRICE_SENSITIVITY_CEILING
  );
}

/**
 * Audience is an influence, not a stereotype (doctrine §9): a small, bounded
 * nudge on top of the industry/movement/composition signal above, never a
 * hard switch.
 */
function audienceBias(audience: AudienceSpec): number {
  const midpoint = (audience.age_range[0] + audience.age_range[1]) / 2;
  let bias = 0;
  if (midpoint <= YOUTH_MIDPOINT_CEILING) bias += 0.12;
  else if (midpoint >= PROFESSIONAL_MIDPOINT_FLOOR) bias -= 0.08;
  if (audience.attention_context === "scroll") bias += 0.05;
  if (isRefinedAudience(audience)) bias -= 0.15;
  return bias;
}

function computeIntensityScore(input: GraphicTreatmentInput): number {
  const focalRoom = 1 - input.dkv.focal_dominance;
  const base =
    INTENSITY_WEIGHTS.ornament * input.ornament +
    INTENSITY_WEIGHTS.density * input.dkv.visual_density +
    INTENSITY_WEIGHTS.focalRoom * focalRoom +
    INTENSITY_WEIGHTS.industryAllowance * industryAllowance(input.industry);
  return clampRatio(base + audienceBias(input.audience));
}

/** Score bands, in ascending ceiling order. The final band has no ceiling. */
const INTENSITY_BANDS: readonly { ceiling: number; level: GraphicTreatmentIntensity }[] = [
  { ceiling: 0.18, level: "none" },
  { ceiling: 0.38, level: "minimal" },
  { ceiling: 0.6, level: "moderate" },
  { ceiling: 0.8, level: "expressive" },
  { ceiling: Number.POSITIVE_INFINITY, level: "experimental" }
];

function bandFromScore(score: number): GraphicTreatmentIntensity {
  return (INTENSITY_BANDS.find((band) => score <= band.ceiling) ?? INTENSITY_BANDS[INTENSITY_BANDS.length - 1]!)
    .level;
}

/**
 * Communication objective always outranks decorative treatment (doctrine
 * §10, §14). Conversion- and promotion-led work needs hierarchy and product
 * clarity ahead of expressive devices; trust-led work needs restraint above
 * all. Objectives absent from this table carry no hard ceiling — the score
 * alone decides.
 */
const OBJECTIVE_INTENSITY_CEILING: Partial<Record<CommunicationObjective, GraphicTreatmentIntensity>> = {
  conversion: "moderate",
  promotion: "moderate",
  trust: "minimal"
};

/** Industry trust pressure at or above this reads as a formal/institutional constraint (doctrine §8). */
const FORMAL_TRUST_THRESHOLD = 0.8;

function resolveIntensity(input: GraphicTreatmentInput): { level: GraphicTreatmentIntensity; score: number } {
  const score = computeIntensityScore(input);
  let level = bandFromScore(score);

  const objectiveCap = OBJECTIVE_INTENSITY_CEILING[input.objective];
  if (objectiveCap) level = capIntensity(level, objectiveCap);
  if (input.industry.trust_pressure >= FORMAL_TRUST_THRESHOLD) level = capIntensity(level, "moderate");
  if (isRefinedAudience(input.audience)) level = capIntensity(level, "moderate");

  return { level, score };
}

// --- Selection counts (doctrine §15) -----------------------------------------

type SelectionTargets = {
  readonly structural: number;
  readonly expressive: number;
  /** Shared budget across image_treatment + typography_treatment — "1 image/type treatment", not one of each. */
  readonly imageOrType: number;
  readonly texture: number;
  readonly pattern: number;
  readonly layering: number;
  readonly accent: number;
  /** At expressive (not experimental) intensity, texture and pattern share one slot rather than one each. */
  readonly textureAndPatternShared: boolean;
};

const SELECTION_TARGETS: Record<GraphicTreatmentIntensity, SelectionTargets> = {
  none: {
    structural: 0,
    expressive: 0,
    imageOrType: 0,
    texture: 0,
    pattern: 0,
    layering: 0,
    accent: 0,
    textureAndPatternShared: false
  },
  minimal: {
    structural: 1,
    expressive: 0,
    imageOrType: 1,
    texture: 0,
    pattern: 0,
    layering: 0,
    accent: 0,
    textureAndPatternShared: false
  },
  moderate: {
    structural: 2,
    expressive: 1,
    imageOrType: 1,
    texture: 0,
    pattern: 0,
    layering: 0,
    accent: 1,
    textureAndPatternShared: false
  },
  expressive: {
    structural: 2,
    expressive: 2,
    imageOrType: 2,
    texture: 1,
    pattern: 1,
    layering: 1,
    accent: 1,
    textureAndPatternShared: true
  },
  experimental: {
    structural: 2,
    expressive: 3,
    imageOrType: 2,
    texture: 1,
    pattern: 1,
    layering: 2,
    accent: 2,
    textureAndPatternShared: false
  }
};

// --- Gating and scoring -------------------------------------------------------

/** Above this visual density, a texture or fine pattern would compete with an already-busy image rather than support it. */
const DENSE_IMAGERY_THRESHOLD = 0.7;
/** The minimum grid columns a device that "requires a grid" can meaningfully use. */
const MIN_GRID_COLUMNS_FOR_STRUCTURE = 3;

function mentionsBannedToken(device: GraphicDevice, bannedTokens: readonly string[]): boolean {
  const haystack = `${device.name} ${device.promptEn} ${device.promptId}`;
  return bannedTokens.some((token) => mentionsToken(haystack, token));
}

function isEligible(device: GraphicDevice, input: GraphicTreatmentInput): boolean {
  if (device.compatibleMovements.length > 0 && !device.compatibleMovements.includes(input.movement.id)) {
    return false;
  }
  if (device.compatibleIndustries.length > 0 && !device.compatibleIndustries.includes(input.industry.id)) {
    return false;
  }
  if (device.incompatibleIndustries.includes(input.industry.id)) return false;
  if (device.suitableObjectives.length > 0 && !device.suitableObjectives.includes(input.objective)) return false;
  if (device.expressiveAudienceOnly && input.industry.trust_pressure >= FORMAL_TRUST_THRESHOLD) return false;
  if (device.conflictsWithDenseCopy && input.hasDenseBodyCopy) return false;
  if (device.reduceIfDenseImagery && input.dkv.visual_density > DENSE_IMAGERY_THRESHOLD) return false;
  if (device.requiresGrid && input.layout.grid.columns < MIN_GRID_COLUMNS_FOR_STRUCTURE) return false;
  if (mentionsBannedToken(device, input.bannedTokens)) return false;
  return true;
}

function scoreDevice(
  device: GraphicDevice,
  input: GraphicTreatmentInput,
  alreadySelected: ReadonlySet<string>
): number {
  let score = 0;
  score += device.compatibleMovements.includes(input.movement.id) ? 0.35 : device.compatibleMovements.length === 0 ? 0.1 : 0;
  score += device.compatibleIndustries.includes(input.industry.id) ? 0.25 : device.compatibleIndustries.length === 0 ? 0.05 : 0;
  score += device.suitableObjectives.includes(input.objective) ? 0.2 : device.suitableObjectives.length === 0 ? 0.05 : 0;

  const bias = audienceBias(input.audience);
  const expressiveLeaning: readonly GraphicDeviceCategory[] = ["expressive", "accent", "pattern"];
  const restrainedLeaning: readonly GraphicDeviceCategory[] = ["structural", "image_treatment"];
  if (expressiveLeaning.includes(device.category)) score += Math.max(0, bias);
  if (restrainedLeaning.includes(device.category)) score += Math.max(0, -bias);

  const pairingBonus = device.pairsWith.filter((id) => alreadySelected.has(id)).length * 0.1;
  score += pairingBonus;

  return round(score);
}

type Scored = { readonly device: GraphicDevice; readonly score: number };

function rankPool(pool: readonly GraphicDevice[], input: GraphicTreatmentInput, alreadySelected: ReadonlySet<string>): Scored[] {
  return pool
    .map((device) => ({ device, score: scoreDevice(device, input, alreadySelected) }))
    .sort((a, b) => b.score - a.score || a.device.id.localeCompare(b.device.id));
}

function poolFor(category: GraphicDeviceCategory, level: GraphicTreatmentIntensity, input: GraphicTreatmentInput): GraphicDevice[] {
  return GRAPHIC_DEVICES.filter(
    (device) =>
      device.category === category &&
      rankOfIntensity(device.minIntensity) <= rankOfIntensity(level) &&
      isEligible(device, input)
  );
}

/** Resolves mutually exclusive pairs by dropping the lower-scored member of each conflicting pair (doctrine §12). */
function resolveConflicts(selected: readonly Scored[]): Scored[] {
  const dropped = new Set<string>();
  for (let i = 0; i < selected.length; i += 1) {
    for (let j = i + 1; j < selected.length; j += 1) {
      const a = selected[i]!;
      const b = selected[j]!;
      const conflicts = a.device.avoidWith.includes(b.device.id) || b.device.avoidWith.includes(a.device.id);
      if (!conflicts) continue;
      if (a.score === b.score) {
        dropped.add(a.device.id > b.device.id ? a.device.id : b.device.id);
      } else {
        dropped.add(a.score < b.score ? a.device.id : b.device.id);
      }
    }
  }
  return selected.filter((entry) => !dropped.has(entry.device.id));
}

// --- Traceability -------------------------------------------------------------

function sourceFor(input: GraphicTreatmentInput): string {
  return `movement:${input.movement.id} + industry:${input.industry.id} + objective:${input.objective}`;
}

function rationaleFor(device: GraphicDevice, input: GraphicTreatmentInput): string {
  const purposeText = device.purpose.join(", ");
  const conceptNote = input.concept ? ` Concept: "${input.concept.proposal.name}".` : "";
  return (
    `${device.name} (${device.category.replace(/_/g, " ")}) selected for ${purposeText} — ` +
    `compatible with ${input.movement.name} on a ${input.industry.name} brief for a ${input.objective} objective.${conceptNote}`
  );
}

function toSelected(device: GraphicDevice, input: GraphicTreatmentInput): SelectedGraphicDevice {
  return {
    id: device.id,
    category: device.category,
    name: device.name,
    purpose: [...device.purpose],
    prompt_en: device.promptEn,
    prompt_id: device.promptId,
    source: sourceFor(input),
    rationale: rationaleFor(device, input)
  };
}

function pick(
  category: GraphicDeviceCategory,
  count: number,
  level: GraphicTreatmentIntensity,
  input: GraphicTreatmentInput,
  alreadySelected: Set<string>
): Scored[] {
  if (count <= 0) return [];
  const ranked = rankPool(poolFor(category, level, input), input, alreadySelected);
  const chosen = ranked.slice(0, count);
  for (const entry of chosen) alreadySelected.add(entry.device.id);
  return chosen;
}

/**
 * Picks the shared image_treatment + typography_treatment budget as one
 * ranked pool, so the winner is whichever treatment actually fits best —
 * never one guaranteed pick per sub-category.
 */
function pickImageOrType(
  count: number,
  level: GraphicTreatmentIntensity,
  input: GraphicTreatmentInput,
  alreadySelected: Set<string>
): Scored[] {
  if (count <= 0) return [];
  const pool = [
    ...poolFor("image_treatment", level, input),
    ...poolFor("typography_treatment", level, input)
  ];
  const ranked = rankPool(pool, input, alreadySelected);
  const chosen = ranked.slice(0, count);
  for (const entry of chosen) alreadySelected.add(entry.device.id);
  return chosen;
}

function pickTextureAndPattern(
  targets: SelectionTargets,
  level: GraphicTreatmentIntensity,
  input: GraphicTreatmentInput,
  alreadySelected: Set<string>
): { texture: Scored[]; pattern: Scored[] } {
  if (!targets.textureAndPatternShared) {
    return {
      texture: pick("texture", targets.texture, level, input, alreadySelected),
      pattern: pick("pattern", targets.pattern, level, input, alreadySelected)
    };
  }

  const textureRanked = rankPool(poolFor("texture", level, input), input, alreadySelected);
  const patternRanked = rankPool(poolFor("pattern", level, input), input, alreadySelected);
  const bestTexture = textureRanked[0] ?? null;
  const bestPattern = patternRanked[0] ?? null;

  if (!bestTexture && !bestPattern) return { texture: [], pattern: [] };
  if (!bestPattern || (bestTexture && bestTexture.score >= bestPattern.score)) {
    alreadySelected.add(bestTexture!.device.id);
    return { texture: [bestTexture!], pattern: [] };
  }
  alreadySelected.add(bestPattern.device.id);
  return { texture: [], pattern: [bestPattern] };
}

function byCategory(selected: readonly Scored[], category: GraphicDeviceCategory): Scored[] {
  return selected.filter((entry) => entry.device.category === category);
}

/**
 * Resolve the Graphic Treatment plan for a Design Recipe.
 *
 * Pure and deterministic: identical input produces an identical plan, in the
 * same order, every time. Called once, from engine/recipe/build.ts, after
 * composition/color/typography/graphic_language have already been resolved —
 * this function only ever reads those results, never recomputes them.
 */
export function resolveGraphicTreatment(input: GraphicTreatmentInput): GraphicTreatmentSpec {
  const { level, score } = resolveIntensity(input);
  const targets = SELECTION_TARGETS[level];
  const alreadySelected = new Set<string>();

  const structural = pick("structural", targets.structural, level, input, alreadySelected);
  const expressive = pick("expressive", targets.expressive, level, input, alreadySelected);
  const imageOrType = pickImageOrType(targets.imageOrType, level, input, alreadySelected);
  const { texture, pattern } = pickTextureAndPattern(targets, level, input, alreadySelected);
  const layering = pick("layering", targets.layering, level, input, alreadySelected);
  const accent = pick("accent", targets.accent, level, input, alreadySelected);

  const full = resolveConflicts([...structural, ...expressive, ...imageOrType, ...texture, ...pattern, ...layering, ...accent]);
  const survivingIds = new Set(full.map((entry) => entry.device.id));
  const keep = (entries: readonly Scored[]) => entries.filter((entry) => survivingIds.has(entry.device.id));

  const structuralDevices = keep(structural).map((entry) => toSelected(entry.device, input));
  const expressiveDevices = keep(expressive).map((entry) => toSelected(entry.device, input));
  const imageTreatments = keep(byCategory(imageOrType, "image_treatment")).map((entry) => toSelected(entry.device, input));
  const typographyTreatments = keep(byCategory(imageOrType, "typography_treatment")).map((entry) =>
    toSelected(entry.device, input)
  );
  const textures = keep(texture).map((entry) => toSelected(entry.device, input));
  const patterns = keep(pattern).map((entry) => toSelected(entry.device, input));
  const layeringDevices = keep(layering).map((entry) => toSelected(entry.device, input));
  const accents = keep(accent).map((entry) => toSelected(entry.device, input));

  const allSelected = [
    ...structuralDevices,
    ...expressiveDevices,
    ...imageTreatments,
    ...typographyTreatments,
    ...textures,
    ...patterns,
    ...layeringDevices,
    ...accents
  ];

  const rationale = [
    `Treatment intensity resolved to ${level} (score ${round(score, 2)}) — driven by ${input.movement.name} ornament, ` +
      `${input.industry.name} industry pressure, and the ${input.objective} communication objective.`,
    ...(allSelected.length === 0
      ? [
          "No graphic devices were selected: the objective, industry and audience signals call for restraint at this intensity, so no device would have a declared purpose here."
        ]
      : allSelected.map((entry) => entry.rationale))
  ];

  return {
    intensity: level,
    structural_devices: structuralDevices,
    expressive_devices: expressiveDevices,
    image_treatments: imageTreatments,
    typography_treatments: typographyTreatments,
    textures,
    patterns,
    layering: layeringDevices,
    accents,
    rationale,
    source: sourceFor(input)
  };
}
