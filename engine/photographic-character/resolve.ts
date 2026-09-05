import type {
  ArtificialityRisk,
  CameraLanguage,
  ColorResponse,
  DepthOfField,
  DynamicRange,
  FocusBehavior,
  HighlightRolloff,
  ImperfectionLevel,
  LensCharacter,
  LightDirection,
  LightingBehavior,
  MotionRealism,
  PerspectiveBehavior,
  PhotographicCharacterSpec,
  PhotographicConstraint,
  PhotographicStyle,
  RealismEmphasis,
  RealismTarget,
  ShadowBehavior,
  TextureCharacter,
  WhiteBalance
} from "../../types/schemas/photographic-character.schema";
import type { AudienceSpec } from "../../types/schemas/brief.schema";
import type { PhotographicFinishSpec } from "../../types/schemas/photographic-finish.schema";
import { mentionsToken } from "../country/anti-stereotype";
import { resolvePhotographicFinish } from "./finish";
import {
  ENVIRONMENT_REALISM_DOCTRINE,
  HUMAN_REALISM_DOCTRINE,
  IMPLIED_HUMAN_REALISM_DOCTRINE,
  PRODUCT_REALISM_DOCTRINE,
  UNIVERSAL_REALISM_DOCTRINE
} from "./data";
import type { PhotographicCharacterInput, SubjectKind } from "./types";

/**
 * The Photographic Character resolver (P2.6).
 *
 * Additive, deterministic, no LLM. It runs inside buildDesignRecipe AFTER
 * imagery, lighting, colour, materiality and graphic treatment are already
 * resolved, and it only ever reads those results. Nothing here re-litigates a
 * movement, industry, audience or country decision; it asks a narrower
 * question — "given what was already decided, how should this frame behave
 * optically and materially so it reads as a real photograph".
 *
 * Every branch below is explicit arithmetic or a small rule table over the
 * recipe's own resolved values. No randomness, no clock, no network — see
 * docs/photographic-character-engine.md.
 */

// --- Audience helpers (mirrors engine/graphic-treatment/resolve.ts) ---------

const REFINED_SOPHISTICATION_FLOOR = 0.75;
const REFINED_PRICE_SENSITIVITY_CEILING = 0.3;

function isRefinedAudience(audience: AudienceSpec): boolean {
  return (
    audience.sophistication >= REFINED_SOPHISTICATION_FLOOR &&
    audience.price_sensitivity <= REFINED_PRICE_SENSITIVITY_CEILING
  );
}

// --- Subject resolution ----------------------------------------------------

const SUBJECT_BY_STRATEGY: Record<string, SubjectKind> = {
  "person-as-subject": "human",
  "product-as-subject": "product",
  "place-as-subject": "environment",
  "typography-as-subject": "type",
  "absence-as-subject": "type",
  "material-as-subject": "product",
  "process-as-subject": "mixed"
};

/** Fallback subject when no concept exists yet — from the industry's own DNA. */
const SUBJECT_BY_INDUSTRY: Record<string, SubjectKind> = {
  fashion: "human",
  "beauty-skincare": "human",
  hospitality: "environment",
  property: "environment",
  fnb: "product",
  "technology-saas": "product"
};

type ResolvedSubject = {
  readonly kind: SubjectKind;
  /** none | implied | partial | central | crowd */
  readonly humanPresence: string;
  readonly abstraction: string;
};

function resolveSubject(input: PhotographicCharacterInput): ResolvedSubject {
  const concept = input.concept ?? null;
  if (concept) {
    const kind = SUBJECT_BY_STRATEGY[concept.proposal.subject_strategy] ?? "product";
    return {
      kind,
      humanPresence: concept.proposal.human_presence,
      abstraction: concept.proposal.abstraction_level
    };
  }

  const kind = SUBJECT_BY_INDUSTRY[input.industry.id] ?? "product";
  const humanPresence = kind === "human" ? "central" : input.industry.id === "fnb" ? "implied" : "none";
  return { kind, humanPresence, abstraction: "literal" };
}

const HUMAN_IN_FRAME = new Set(["partial", "central", "crowd"]);

// --- Photographic style (§2) ---------------------------------------------

/**
 * A small coherent rule system, first match wins. Optical/treatment overrides
 * are checked before the industry table so a low-realism or heavily-treated
 * recipe is never forced into a photoreal style it cannot support.
 */
function resolveStyle(input: PhotographicCharacterInput, subject: ResolvedSubject): PhotographicStyle {
  const realism = input.imageryRealism;
  const treated = input.graphicTreatmentIntensity === "expressive" || input.graphicTreatmentIntensity === "experimental";
  const abstract = subject.abstraction === "abstract" || subject.abstraction === "symbolic";

  if (realism < 0.4) return "graphic-photographic";
  if (abstract && realism < 0.7) return "surreal-photographic";
  if (treated) return "mixed-media-photographic";
  if (input.movement.id === "brutalism" && input.objective !== "trust") return "raw-documentary";

  const industry = input.industry.id;
  const objective = input.objective;

  if (industry === "fashion") {
    return subject.kind === "human" || objective === "brand-building" || objective === "awareness"
      ? "fashion-editorial"
      : "natural-editorial";
  }
  if (industry === "property") {
    return objective === "trust" ? "documentary" : "natural-editorial";
  }
  if (industry === "technology-saas") {
    return subject.kind === "product" ? "product-studio" : "clean-commercial";
  }
  if (industry === "beauty-skincare") {
    return subject.kind === "human" ? "commercial-editorial" : "product-studio";
  }
  if (industry === "fnb") {
    if (subject.kind === "human") return "commercial-editorial";
    return objective === "promotion" || objective === "conversion" ? "commercial-editorial" : "lifestyle";
  }
  if (industry === "hospitality") {
    if (objective === "trust") return "documentary";
    if (objective === "awareness" || objective === "promotion") return "lifestyle";
    return "cinematic-natural";
  }

  if (objective === "trust" || objective === "education") return "documentary";
  if (subject.kind === "product") return "clean-commercial";
  return "natural-editorial";
}

// --- Realism target -----------------------------------------------------

const COMMERCIAL_STYLES = new Set<PhotographicStyle>([
  "product-studio",
  "clean-commercial",
  "commercial-editorial"
]);

function resolveRealismTarget(style: PhotographicStyle, realism: number): RealismTarget {
  if (style === "graphic-photographic") return "graphic-non-photographic";
  if (style === "surreal-photographic" || style === "mixed-media-photographic") return "stylised-photographic";
  if (realism < 0.4) return "stylised-photographic";
  if (COMMERCIAL_STYLES.has(style)) return "photoreal-refined";
  return "photoreal-natural";
}

// --- Camera / lens / depth (§3–§5) --------------------------------------

function resolveCamera(
  style: PhotographicStyle,
  subject: ResolvedSubject,
  input: PhotographicCharacterInput
): CameraLanguage {
  if (style === "product-studio") return input.industry.id === "beauty-skincare" ? "medium-format-clean" : "studio-commercial";
  if (style === "clean-commercial") return "studio-commercial";
  if (style === "documentary" || style === "raw-documentary") return "close-range-documentary";
  if (style === "cinematic-natural") return "environmental-wide";
  if (subject.kind === "environment") return "environmental-wide";
  if (style === "fashion-editorial" || style === "commercial-editorial") return "full-frame-editorial";
  if (style === "graphic-photographic" || style === "surreal-photographic" || style === "mixed-media-photographic") {
    return "full-frame-editorial";
  }
  return "full-frame-natural";
}

function resolveLens(style: PhotographicStyle, subject: ResolvedSubject): LensCharacter {
  if (subject.kind === "environment") return "35mm-environmental";
  if (subject.kind === "type") return "50mm-natural-perspective";
  if (subject.kind === "human") {
    if (style === "fashion-editorial" || subject.humanPresence === "central") return "85mm-portrait-compression";
    return "50mm-natural-perspective";
  }
  if (subject.kind === "product") {
    if (style === "product-studio" || style === "commercial-editorial") return "100mm-macro-product";
    return "50mm-natural-perspective";
  }
  if (style === "cinematic-natural" || style === "mixed-media-photographic") return "wide-editorial-perspective";
  return "50mm-natural-perspective";
}

function resolveDepthOfField(
  style: PhotographicStyle,
  subject: ResolvedSubject,
  input: PhotographicCharacterInput
): DepthOfField {
  let depth: DepthOfField;
  if (input.industry.id === "technology-saas") depth = "deep-natural";
  else if (style === "documentary" || style === "raw-documentary") depth = "deep-natural";
  else if (subject.kind === "environment") depth = "deep-natural";
  else if (subject.kind === "human" && (style === "fashion-editorial" || subject.humanPresence === "central")) {
    depth = "shallow-optical";
  } else if (style === "commercial-editorial" && subject.kind === "product") depth = "selective-focus";
  else if (style === "product-studio") depth = "moderate-optical";
  else if (style === "lifestyle") depth = "moderate-optical";
  else depth = "moderate-optical";

  // A composition that has already resolved to a weak focal point should not
  // then claim aggressive optical separation — reuse the resolved DKV value.
  if ((depth === "shallow-optical" || depth === "selective-focus") && input.dkv.focal_dominance < 0.4) {
    depth = "moderate-optical";
  }
  return depth;
}

function focusFromDepth(depth: DepthOfField): FocusBehavior {
  switch (depth) {
    case "deep-natural":
      return "sharp-throughout";
    case "moderate-optical":
      return "subject-critical-focus";
    case "shallow-optical":
    case "selective-focus":
      return "plane-of-focus-selective";
  }
}

function perspectiveFromLens(lens: LensCharacter, input: PhotographicCharacterInput): PerspectiveBehavior {
  if (input.industry.id === "property") return "corrected-architectural";
  switch (lens) {
    case "85mm-portrait-compression":
      return "strong-compression";
    case "100mm-macro-product":
      return "mild-compression";
    case "35mm-environmental":
    case "wide-editorial-perspective":
      return "wide-expansive";
    case "50mm-natural-perspective":
      return "natural-perspective";
  }
}

// --- Lighting (§6) -----------------------------------------------------

function resolveLighting(
  style: PhotographicStyle,
  input: PhotographicCharacterInput
): LightingBehavior {
  const industry = input.industry.id;
  const contrast = input.lightingContrast;

  if (style === "product-studio" || style === "clean-commercial") return "controlled-studio";
  if (industry === "fnb") return "soft-directional";
  if (industry === "property") return contrast <= 0.45 ? "overcast-natural" : "window-light";
  if (style === "documentary" || style === "raw-documentary") return "available-daylight";
  if (style === "lifestyle") return contrast >= 0.7 ? "hard-sun" : "available-daylight";
  if (style === "fashion-editorial") return contrast <= 0.55 ? "window-light" : "soft-directional";
  if (style === "commercial-editorial") return "soft-directional";
  if (style === "cinematic-natural") return "dusk-natural";
  if (industry === "hospitality") return "practical-light";
  if (style === "surreal-photographic" || style === "mixed-media-photographic") return "mixed-natural";
  return "window-light";
}

function directionFromLighting(lighting: LightingBehavior): LightDirection {
  switch (lighting) {
    case "controlled-studio":
    case "soft-directional":
    case "mixed-natural":
      return "three-quarter";
    case "window-light":
    case "practical-light":
      return "side-directional";
    case "available-daylight":
      return "ambient-wrap";
    case "overcast-natural":
      return "ambient-wrap";
    case "hard-sun":
      return "back-rim";
    case "dusk-natural":
      return "back-rim";
  }
}

function resolveHighlightRolloff(
  colorResponse: ColorResponse,
  style: PhotographicStyle,
  dynamicRange: DynamicRange
): HighlightRolloff {
  if (colorResponse === "soft-film" || colorResponse === "muted-documentary") return "filmic";
  if (style === "product-studio" || style === "clean-commercial" || colorResponse === "high-fidelity-product") {
    return "crisp";
  }
  if (dynamicRange === "high-contrast") return "crisp";
  if (dynamicRange === "restrained") return "gentle";
  return "natural";
}

function resolveShadowBehavior(
  lighting: LightingBehavior,
  input: PhotographicCharacterInput
): ShadowBehavior {
  const contrast = input.lightingContrast;
  if (lighting === "controlled-studio" || lighting === "soft-directional") return "defined-directional";
  if (lighting === "overcast-natural") return "soft-diffused";
  if (lighting === "hard-sun") return "deep-contrasty";
  if (input.industry.id === "fnb") return "defined-directional";
  if (contrast >= 0.7) return "deep-contrasty";
  if (contrast <= 0.4) return "soft-diffused";
  return "natural-density";
}

// --- Colour (§7) -----------------------------------------------------

function resolveColorResponse(
  style: PhotographicStyle,
  input: PhotographicCharacterInput
): ColorResponse {
  if (style === "documentary" || style === "raw-documentary") return "muted-documentary";
  if (style === "cinematic-natural") return "soft-film";

  if (style === "product-studio") {
    return input.industry.id === "technology-saas" ? "restrained-commercial" : "high-fidelity-product";
  }
  if (style === "clean-commercial") return "restrained-commercial";
  if (style === "commercial-editorial") {
    return input.industry.id === "fnb" ? "warm-natural" : "restrained-commercial";
  }
  if (style === "lifestyle") return "warm-natural";
  if (style === "fashion-editorial") return input.colorSaturation >= 0.6 ? "bold-editorial" : "editorial-neutral";

  if (input.colorStrategy === "high-chroma-vernacular") return "bold-editorial";

  if (input.colorStrategy === "monochrome-structural" || input.colorStrategy === "restrained-neutral") {
    return "editorial-neutral";
  }
  return "neutral-natural";
}

function resolveWhiteBalance(colorResponse: ColorResponse, lighting: LightingBehavior): WhiteBalance {
  if (colorResponse === "warm-natural" || colorResponse === "soft-film") return "warm-ambient";
  if (lighting === "mixed-natural" || lighting === "practical-light") return "mixed-corrected";
  if (
    (lighting === "available-daylight" || lighting === "overcast-natural") &&
    colorResponse !== "high-fidelity-product"
  ) {
    return "cool-daylight";
  }
  return "neutral";
}

function resolveDynamicRange(style: PhotographicStyle, input: PhotographicCharacterInput): DynamicRange {
  const contrast = input.lightingContrast;
  if (style === "product-studio" || style === "clean-commercial") return "restrained";
  if (style === "documentary" || style === "raw-documentary") return "natural";
  if (contrast >= 0.78 && (style === "cinematic-natural" || style === "lifestyle")) return "high-contrast";
  if (contrast >= 0.72) return "extended";
  if (contrast <= 0.4) return "restrained";
  return "natural";
}

// --- Surface realism (§8) --------------------------------------------

function humanRealism(subject: ResolvedSubject, target: RealismTarget): RealismEmphasis {
  if (!HUMAN_IN_FRAME.has(subject.humanPresence)) return "not-applicable";
  if (target === "graphic-non-photographic" || target === "stylised-photographic") return "stylised";
  return "detailed-naturalistic";
}

function handRealism(subject: ResolvedSubject, target: RealismTarget): RealismEmphasis {
  if (subject.humanPresence === "implied") return "detailed-naturalistic";
  return humanRealism(subject, target);
}

function fabricRealism(subject: ResolvedSubject, input: PhotographicCharacterInput): RealismEmphasis {
  if (input.industry.id === "fashion") return "detailed-naturalistic";
  if (subject.kind === "human" || input.industry.id === "hospitality") return "naturalistic";
  return "not-applicable";
}

function materialRealism(style: PhotographicStyle, target: RealismTarget): RealismEmphasis {
  if (target === "graphic-non-photographic" || target === "stylised-photographic") return "stylised";
  if (COMMERCIAL_STYLES.has(style)) return "detailed-naturalistic";
  return "naturalistic";
}

function environmentalRealism(
  style: PhotographicStyle,
  subject: ResolvedSubject,
  target: RealismTarget
): RealismEmphasis {
  if (target === "graphic-non-photographic") return "stylised";
  if (subject.kind === "environment") return "detailed-naturalistic";
  if (style === "documentary" || style === "lifestyle" || style === "cinematic-natural" || style === "raw-documentary") {
    return "detailed-naturalistic";
  }
  return "naturalistic";
}

// --- Texture / motion / imperfection (§11) --------------------------

function resolveTextureCharacter(
  style: PhotographicStyle,
  imperfection: ImperfectionLevel,
  input: PhotographicCharacterInput
): TextureCharacter {
  if (imperfection === "none") return "clean";
  if (style === "product-studio" || style === "clean-commercial") return "clean";
  if (input.materialityTexture >= 0.65) return "tactile-pronounced";
  if (input.materialityTexture >= 0.4) return "natural-texture";
  return "subtle-grain";
}

function resolveMotionRealism(
  style: PhotographicStyle,
  input: PhotographicCharacterInput
): MotionRealism {
  const concept = input.concept ?? null;
  if (concept) {
    switch (concept.proposal.temporal_strategy) {
      case "aftermath":
      case "timeless":
        return "static";
      case "ritual-repetition":
        return "natural-motion";
      case "instant":
      case "anticipation":
        return "subtle-implied-motion";
    }
  }
  if (style === "documentary" || style === "raw-documentary") return "natural-motion";
  if (
    (input.objective === "promotion" || input.objective === "awareness") &&
    (input.industry.id === "fnb" || input.industry.id === "fashion")
  ) {
    return "subtle-implied-motion";
  }
  return "static";
}

/** Default is "subtle" or "natural" — never "none" (§11). */
function resolveImperfectionLevel(
  style: PhotographicStyle,
  input: PhotographicCharacterInput
): ImperfectionLevel {
  // Industry restraint outranks style flavour: property and technology-saas
  // both read layout instability as risk, so they never carry loud imperfection.
  if (input.industry.id === "technology-saas" || input.industry.id === "property") {
    return style === "raw-documentary" ? "natural" : "subtle";
  }
  if (style === "raw-documentary") return isRefinedAudience(input.audience) ? "natural" : "expressive";
  if (style === "documentary") return "natural";
  if (style === "product-studio" || style === "clean-commercial" || style === "commercial-editorial") return "subtle";
  if (style === "graphic-photographic" || style === "surreal-photographic" || style === "mixed-media-photographic") {
    return "subtle";
  }
  if (
    style === "fashion-editorial" ||
    style === "natural-editorial" ||
    style === "lifestyle" ||
    style === "cinematic-natural"
  ) {
    return "natural";
  }
  return "subtle";
}

// --- Artificiality risk (§9) ----------------------------------------

type Contribution = { readonly points: number; readonly reason: string };

function assessArtificialityRisk(args: {
  readonly depthOfField: DepthOfField;
  readonly dynamicRange: DynamicRange;
  readonly highlightRolloff: HighlightRolloff;
  readonly lighting: LightingBehavior;
  readonly colorResponse: ColorResponse;
  readonly shadowBehavior: ShadowBehavior;
  readonly perspective: PerspectiveBehavior;
  readonly imperfection: ImperfectionLevel;
  readonly materialRealism: RealismEmphasis;
  readonly style: PhotographicStyle;
  readonly lens: LensCharacter;
  readonly subject: ResolvedSubject;
  readonly input: PhotographicCharacterInput;
}): ArtificialityRisk {
  const { input, subject, style } = args;
  const BASELINE = 22;
  const raisers: Contribution[] = [];
  const lowerers: Contribution[] = [];

  // --- raisers -------------------------------------------------------
  if (args.depthOfField === "shallow-optical" || args.depthOfField === "selective-focus") {
    raisers.push({ points: 8, reason: "aggressive shallow depth of field" });
  }
  if (args.dynamicRange === "high-contrast") raisers.push({ points: 10, reason: "high-contrast / HDR tendency" });
  else if (args.dynamicRange === "extended") raisers.push({ points: 4, reason: "extended dynamic range" });

  if (input.colorSaturation >= 0.75) {
    raisers.push({ points: 8, reason: "high colour saturation" });
    if (args.lighting === "controlled-studio") {
      raisers.push({ points: 5, reason: "high saturation combined with fully controlled lighting" });
    }
  }
  if (args.highlightRolloff === "crisp" && style !== "product-studio" && style !== "clean-commercial") {
    raisers.push({ points: 5, reason: "crisp highlight rolloff / excessive sharpness risk" });
  }
  if (input.compositionStrategy === "centred-frontal" && input.dkv.focal_dominance >= 0.75) {
    raisers.push({ points: 6, reason: "extreme symmetry with a single dominant focal point" });
  }
  if (input.graphicTreatmentIntensity === "experimental") {
    raisers.push({ points: 6, reason: "experimental graphic treatment layered over the photograph" });
  } else if (input.graphicTreatmentIntensity === "expressive") {
    raisers.push({ points: 3, reason: "expressive graphic treatment layered over the photograph" });
  }
  if (
    style === "commercial-editorial" &&
    subject.humanPresence === "central" &&
    input.imageryRealism >= 0.8
  ) {
    raisers.push({ points: 6, reason: "high-realism commercial portrait invites over-retouching" });
  }
  if (
    args.lens === "85mm-portrait-compression" &&
    args.depthOfField === "shallow-optical" &&
    subject.humanPresence === "central"
  ) {
    raisers.push({ points: 4, reason: "portrait compression with shallow depth risks synthetic bokeh" });
  }
  if (args.perspective === "wide-expansive" && subject.kind === "human") {
    raisers.push({ points: 5, reason: "wide-expansive perspective on a human subject" });
  }
  if (input.lightingContrast >= 0.8) raisers.push({ points: 5, reason: "very high lighting contrast" });
  if (input.imageryRealism >= 0.9) raisers.push({ points: 4, reason: "near-maximal realism bias reads as overly perfect" });

  // --- lowerers -----------------------------------------------------
  if (args.imperfection === "expressive") lowerers.push({ points: 12, reason: "expressive controlled imperfection" });
  else if (args.imperfection === "natural") lowerers.push({ points: 8, reason: "natural controlled imperfection" });
  else if (args.imperfection === "subtle") lowerers.push({ points: 4, reason: "subtle controlled imperfection" });
  else lowerers.push({ points: -6, reason: "no controlled imperfection at all" });

  if (args.depthOfField === "deep-natural" || args.depthOfField === "moderate-optical") {
    lowerers.push({ points: 5, reason: "realistic optical depth" });
  }
  if (
    args.lighting === "available-daylight" ||
    args.lighting === "window-light" ||
    args.lighting === "overcast-natural" ||
    args.lighting === "mixed-natural" ||
    args.lighting === "practical-light"
  ) {
    lowerers.push({ points: 6, reason: "plausible available-light source" });
  }
  if (
    args.colorResponse === "neutral-natural" ||
    args.colorResponse === "warm-natural" ||
    args.colorResponse === "muted-documentary" ||
    args.colorResponse === "editorial-neutral" ||
    args.colorResponse === "restrained-commercial"
  ) {
    lowerers.push({ points: 5, reason: "natural, restrained colour response" });
  }
  if (args.dynamicRange === "restrained" || args.dynamicRange === "natural") {
    lowerers.push({ points: 5, reason: "restrained contrast" });
  }
  if (args.shadowBehavior === "natural-density" || args.shadowBehavior === "soft-diffused") {
    lowerers.push({ points: 3, reason: "believable shadow density" });
  }
  if (
    style === "documentary" ||
    style === "raw-documentary" ||
    style === "natural-editorial" ||
    style === "lifestyle"
  ) {
    lowerers.push({ points: 6, reason: "a documentary / natural-editorial style with coherent perspective" });
  }
  if (args.materialRealism === "detailed-naturalistic") {
    lowerers.push({ points: 3, reason: "detailed, believable material behaviour" });
  }

  const rawRaise = raisers.reduce((total, c) => total + c.points, 0);
  const rawLower = lowerers.reduce((total, c) => total + c.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(BASELINE + rawRaise - rawLower)));

  const band: ArtificialityRisk["band"] =
    score < 25 ? "low" : score < 50 ? "moderate" : score < 75 ? "elevated" : "high";

  const factors = [
    ...raisers.filter((c) => c.points > 0).sort((a, b) => b.points - a.points).map((c) => `+${c.points} ${c.reason}`),
    ...lowerers
      .filter((c) => c.points > 0)
      .sort((a, b) => b.points - a.points)
      .map((c) => `-${c.points} ${c.reason}`)
  ];

  return { score, band, factors: factors.length > 0 ? factors : ["baseline photographic character only"] };
}

// --- Realism doctrine assembly (§8) --------------------------------

function realismDoctrine(subject: ResolvedSubject): PhotographicConstraint[] {
  const blocks: PhotographicConstraint[] = [...UNIVERSAL_REALISM_DOCTRINE];

  if (HUMAN_IN_FRAME.has(subject.humanPresence)) blocks.push(...HUMAN_REALISM_DOCTRINE);
  else if (subject.humanPresence === "implied") blocks.push(...IMPLIED_HUMAN_REALISM_DOCTRINE);

  if (subject.kind === "product" || subject.kind === "mixed") blocks.push(...PRODUCT_REALISM_DOCTRINE);
  if (subject.kind === "environment" || subject.kind === "mixed") blocks.push(...ENVIRONMENT_REALISM_DOCTRINE);

  return blocks;
}

// --- Banned-token safety -----------------------------------------

/**
 * Photographic Character selects from a closed enum taxonomy, so a banned
 * token can only ever reach the output through the two quoted dataset strings
 * this layer reads (framing, lighting direction). If either mentions a token
 * from the resolved country blend, the doctrine adds an explicit avoid line
 * rather than silently passing the phrase through.
 */
function bannedTokenNotes(input: PhotographicCharacterInput): PhotographicConstraint[] {
  const haystack = `${input.framing} ${input.lightingDirectionText}`;
  const hit = input.bannedTokens.some((token) => mentionsToken(haystack, token));
  return hit
    ? [
        {
          kind: "avoid" as const,
          statement:
            "any literal cultural motif, prop or costume implied by the source imagery notes — express place through light, materials and spatial behaviour only"
        }
      ]
    : [];
}

// --- Public entry point ------------------------------------------

const STYLE_LABEL: Record<PhotographicStyle, string> = {
  "natural-editorial": "natural editorial photography",
  "commercial-editorial": "commercial editorial photography",
  documentary: "documentary photography",
  lifestyle: "lifestyle photography",
  "fashion-editorial": "fashion editorial photography",
  "product-studio": "controlled product photography",
  "cinematic-natural": "cinematic natural photography",
  "graphic-photographic": "photography used as a graphic element",
  "raw-documentary": "raw documentary photography",
  "clean-commercial": "clean commercial photography",
  "surreal-photographic": "surreal photographic imagery",
  "mixed-media-photographic": "mixed-media photographic imagery"
};

/**
 * Resolve the Photographic Character layer for a Design Recipe.
 *
 * Pure and deterministic: identical input produces an identical spec, in the
 * same field order, every time. Called once from engine/recipe/build.ts after
 * imagery, lighting, colour, materiality and graphic treatment are resolved.
 */
export function resolvePhotographicCharacter(
  input: PhotographicCharacterInput
): PhotographicCharacterSpec & { finish: PhotographicFinishSpec } {
  const subject = resolveSubject(input);

  const style = resolveStyle(input, subject);
  const realismTarget = resolveRealismTarget(style, input.imageryRealism);

  const cameraLanguage = resolveCamera(style, subject, input);
  const lensCharacter = resolveLens(style, subject);
  const depthOfField = resolveDepthOfField(style, subject, input);
  const focusBehavior = focusFromDepth(depthOfField);
  const perspectiveBehavior = perspectiveFromLens(lensCharacter, input);

  const lightingBehavior = resolveLighting(style, input);
  const lightDirection = directionFromLighting(lightingBehavior);
  const dynamicRange = resolveDynamicRange(style, input);
  const colorResponse = resolveColorResponse(style, input);
  const highlightRolloff = resolveHighlightRolloff(colorResponse, style, dynamicRange);
  const shadowBehavior = resolveShadowBehavior(lightingBehavior, input);
  const whiteBalance = resolveWhiteBalance(colorResponse, lightingBehavior);

  const skinRealism = humanRealism(subject, realismTarget);
  const faceRealism = humanRealism(subject, realismTarget);
  const hairRealism = humanRealism(subject, realismTarget);
  const handRealismValue = handRealism(subject, realismTarget);
  const fabricRealismValue = fabricRealism(subject, input);
  const materialRealismValue = materialRealism(style, realismTarget);
  const environmentalRealismValue = environmentalRealism(style, subject, realismTarget);

  const imperfectionLevel = resolveImperfectionLevel(style, input);
  const textureCharacter = resolveTextureCharacter(style, imperfectionLevel, input);
  const motionRealism = resolveMotionRealism(style, input);

  const artificialityRisk = assessArtificialityRisk({
    depthOfField,
    dynamicRange,
    highlightRolloff,
    lighting: lightingBehavior,
    colorResponse,
    shadowBehavior,
    perspective: perspectiveBehavior,
    imperfection: imperfectionLevel,
    materialRealism: materialRealismValue,
    style,
    lens: lensCharacter,
    subject,
    input
  });

  const constraints = [...realismDoctrine(subject), ...bannedTokenNotes(input)];

  // P2.9 — the additive Photographic Finish layer. Reads only values resolved
  // above plus a handful of recipe signals; makes no new decision.
  const finish = resolvePhotographicFinish({
    photographicStyle: style,
    realismTarget,
    colorResponse,
    whiteBalance,
    lightingBehavior,
    artificialityRisk,
    skinRealism,
    industryId: input.industry.id,
    colorStrategy: input.colorStrategy,
    colorSaturation: input.colorSaturation,
    refinedAudience: isRefinedAudience(input.audience),
    abstractionLevel: subject.abstraction
  });

  const subjectPhrase =
    subject.kind === "human"
      ? "a human subject"
      : subject.kind === "product"
        ? "a product subject"
        : subject.kind === "environment"
          ? "an environmental subject"
          : subject.kind === "type"
            ? "a typographic subject"
            : "a mixed subject";

  const rationale = [
    `Photographic character resolved to ${STYLE_LABEL[style]} (${realismTarget}) for a ${input.objective} ${input.industry.name} brief with ${subjectPhrase}.`,
    `Camera language ${cameraLanguage} with a ${lensCharacter} lens and ${depthOfField} depth (${focusBehavior}, ${perspectiveBehavior}), derived from the resolved subject strategy and ${input.compositionStrategy} composition.`,
    `Lighting reads as ${lightingBehavior} from ${lightDirection} with ${shadowBehavior} shadows and ${highlightRolloff} highlights — consistent with the recipe's lighting contrast of ${Math.round(
      input.lightingContrast * 100
    )}%.`,
    `Colour response ${colorResponse} at ${whiteBalance} white balance and ${dynamicRange} dynamic range, preserving the recipe's palette relationships.`,
    `Imperfection level ${imperfectionLevel}; artificiality risk ${artificialityRisk.score}/100 (${artificialityRisk.band}) — diagnostic only, it does not change any Design Recipe value.`
  ];

  return {
    photographic_style: style,
    realism_target: realismTarget,

    camera_language: cameraLanguage,
    lens_character: lensCharacter,
    depth_of_field: depthOfField,
    focus_behavior: focusBehavior,
    perspective_behavior: perspectiveBehavior,

    lighting_behavior: lightingBehavior,
    light_direction: lightDirection,
    highlight_rolloff: highlightRolloff,
    shadow_behavior: shadowBehavior,

    color_response: colorResponse,
    white_balance: whiteBalance,
    dynamic_range: dynamicRange,

    skin_realism: skinRealism,
    face_realism: faceRealism,
    hair_realism: hairRealism,
    hand_realism: handRealismValue,
    fabric_realism: fabricRealismValue,
    material_realism: materialRealismValue,
    environmental_realism: environmentalRealismValue,

    texture_character: textureCharacter,
    motion_realism: motionRealism,
    imperfection_level: imperfectionLevel,

    artificiality_risk: artificialityRisk,

    constraints,
    rationale,
    source: `industry:${input.industry.id} + objective:${input.objective} + visual_type:${input.visualType.id} + style:${style}`,

    finish
  };
}
