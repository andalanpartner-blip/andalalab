import type {
  ArtificialityRisk,
  ColorResponse,
  LightingBehavior,
  PhotographicStyle,
  RealismEmphasis,
  RealismTarget,
  WhiteBalance
} from "../../types/schemas/photographic-character.schema";
import type {
  ArtificialityLevel,
  ColorCharacter,
  LightingCharacter,
  PhotographicFinishSpec,
  PhotographicFinishStyle,
  RealismNoteKey
} from "../../types/schemas/photographic-finish.schema";
import { COLOR_CHARACTER_VOCABULARY } from "./finish-data";

/**
 * The Photographic Finish resolver (P2.9).
 *
 * Additive and deterministic. It runs at the tail of
 * `resolvePhotographicCharacter`, reads only values that layer has ALREADY
 * resolved (plus a few recipe signals passed alongside), and consolidates four
 * axes into named, traceable tokens:
 *
 *   style · colour character · lighting character · artificiality control
 *
 * It never re-decides a style, colour, lighting, industry, movement or country
 * value; it never calls an LLM. Non-photographic media (graphic-poster /
 * illustration) get a colour character only — no lighting character, no realism
 * notes — so the compiler cannot leak photographic vocabulary into them.
 */

export type PhotographicFinishArgs = {
  /** The style `resolvePhotographicCharacter` already resolved. */
  readonly photographicStyle: PhotographicStyle;
  readonly realismTarget: RealismTarget;
  readonly colorResponse: ColorResponse;
  readonly whiteBalance: WhiteBalance;
  readonly lightingBehavior: LightingBehavior;
  readonly artificialityRisk: ArtificialityRisk;
  /** "not-applicable" ⇒ no human figure in frame. */
  readonly skinRealism: RealismEmphasis;

  // --- recipe signals, lifted verbatim (never recomputed) ---
  readonly industryId: string;
  readonly colorStrategy: string;
  readonly colorSaturation: number;
  readonly refinedAudience: boolean;
  /** concept.proposal.abstraction_level, or "literal" when no concept exists. */
  readonly abstractionLevel: string;
};

/**
 * §1 — base style family. Mirrors `STYLE_TO_ADAPTER` in
 * engine/prompt/visual-adapter/resolve.ts, refined by two P2.9 distinctions:
 * documentary is its own family, and `commercial-editorial` splits by whether a
 * person is in frame.
 */
const STYLE_TO_FINISH: Record<PhotographicStyle, PhotographicFinishStyle> = {
  "natural-editorial": "photorealistic",
  "commercial-editorial": "product-photography",
  documentary: "documentary",
  "raw-documentary": "documentary",
  lifestyle: "photorealistic",
  "fashion-editorial": "fashion-editorial",
  "product-studio": "product-photography",
  "clean-commercial": "product-photography",
  "cinematic-natural": "cinematic",
  "graphic-photographic": "graphic-poster",
  "mixed-media-photographic": "graphic-poster",
  "surreal-photographic": "cinematic"
};

const ABSTRACT = new Set(["abstract", "symbolic"]);

function resolveStyle(args: PhotographicFinishArgs): {
  value: PhotographicFinishStyle;
  rationale: string;
  sourceSignals: string[];
} {
  const base = STYLE_TO_FINISH[args.photographicStyle];
  const signals = [`photographic_character.photographic_style:${args.photographicStyle}`];

  // A graphic, non-photographic frame driven by an abstract/symbolic concept is
  // a deliberate illustration, not a poster (mirrors the P2.7 adapter refinement).
  if (
    base === "graphic-poster" &&
    args.realismTarget === "graphic-non-photographic" &&
    ABSTRACT.has(args.abstractionLevel)
  ) {
    return {
      value: "illustration",
      rationale: `Graphic, non-photographic style "${args.photographicStyle}" with an ${args.abstractionLevel} concept resolves to the illustration finish family.`,
      sourceSignals: [
        ...signals,
        `photographic_character.realism_target:${args.realismTarget}`,
        `concept.abstraction_level:${args.abstractionLevel}`
      ]
    };
  }

  // commercial-editorial splits: a person in frame is fashion-editorial finish,
  // a product hero is product-photography finish.
  if (args.photographicStyle === "commercial-editorial" && args.skinRealism !== "not-applicable") {
    return {
      value: "fashion-editorial",
      rationale: `Commercial-editorial style with a human subject in frame resolves to the fashion-editorial finish family.`,
      sourceSignals: [...signals, `photographic_character.skin_realism:${args.skinRealism}`]
    };
  }

  return {
    value: base,
    rationale: `Photographic style "${args.photographicStyle}" resolves to the ${base} finish family.`,
    sourceSignals: signals
  };
}

/**
 * §2 — colour character. Read off the already-resolved colour response, white
 * balance and colour strategy; saturation and audience refinement only break
 * ties. Never inspects the brief or a country id.
 */
function resolveColorCharacter(args: PhotographicFinishArgs): {
  value: ColorCharacter;
  rationale: string;
  sourceSignals: string[];
} {
  const { colorResponse, whiteBalance, colorStrategy, colorSaturation, refinedAudience, industryId } =
    args;
  const signals = [
    `photographic_character.color_response:${colorResponse}`,
    `photographic_character.white_balance:${whiteBalance}`,
    `color.strategy:${colorStrategy}`,
    `color.saturation:${colorSaturation.toFixed(2)}`
  ];
  const done = (value: ColorCharacter, why: string) => ({ value, rationale: why, sourceSignals: signals });

  // The photographic colour RESPONSE is the primary signal. The colour STRATEGY
  // (a palette decision) only fixes monochrome or breaks the neutral tie.
  if (colorStrategy === "monochrome-structural") {
    return done("monochrome", "A structural monochrome colour strategy fixes the finish to a monochrome colour character.");
  }
  if (colorResponse === "bold-editorial") {
    return done("high-chroma-commercial", "A bold-editorial colour response resolves to a high-chroma commercial colour character.");
  }

  // Soft pastel: a refined beauty / fashion audience with genuinely low saturation
  // and a restrained, non-warm colour response.
  const pastelResponse =
    colorResponse === "restrained-commercial" ||
    colorResponse === "editorial-neutral" ||
    colorResponse === "neutral-natural";
  if (
    refinedAudience &&
    colorSaturation <= 0.3 &&
    (industryId === "beauty-skincare" || industryId === "fashion") &&
    pastelResponse
  ) {
    return done(
      "soft-pastel",
      `A restrained ${colorResponse} colour response for a refined ${industryId} audience at very low saturation resolves to a soft-pastel colour character.`
    );
  }

  if (colorResponse === "warm-natural") {
    return done("natural-warm", "A warm, natural colour response resolves to a natural-warm colour character.");
  }
  if (colorResponse === "soft-film" || colorResponse === "muted-documentary") {
    return done("muted-film", `A ${colorResponse} colour response resolves to a muted-film colour character.`);
  }
  if (colorResponse === "high-fidelity-product") {
    return colorSaturation >= 0.6
      ? done("high-chroma-commercial", "High-fidelity product colour at elevated saturation reads as a high-chroma commercial colour character.")
      : done("restrained-commercial", "High-fidelity product colour at restrained saturation reads as a restrained commercial colour character.");
  }
  if (colorResponse === "restrained-commercial") {
    return done("restrained-commercial", "A restrained commercial colour response carries straight through to a restrained commercial colour character.");
  }
  if (colorResponse === "editorial-neutral") {
    return done("editorial-neutral", "An editorial-neutral colour response carries straight through to an editorial-neutral colour character.");
  }

  // colorResponse === "neutral-natural"
  if (colorStrategy === "high-chroma-vernacular") {
    return done("high-chroma-commercial", "A neutral colour response driven by a high-chroma vernacular palette resolves to a high-chroma commercial colour character.");
  }
  if (whiteBalance === "cool-daylight") {
    return done("natural-cool", "A neutral colour response under a cool-daylight white balance resolves to a natural-cool colour character.");
  }
  if (whiteBalance === "warm-ambient") {
    return done("natural-warm", "A neutral colour response under a warm-ambient white balance resolves to a natural-warm colour character.");
  }
  return done("natural-neutral", "A neutral colour response at a neutral white balance resolves to a natural-neutral colour character.");
}

/** §3 — lighting character. Null for a non-photographic medium. */
function resolveLightingCharacter(args: PhotographicFinishArgs): {
  value: LightingCharacter;
  rationale: string;
  sourceSignals: string[];
} {
  const { lightingBehavior, photographicStyle } = args;
  const signals = [`photographic_character.lighting_behavior:${lightingBehavior}`];
  const cinematicStyle = photographicStyle === "cinematic-natural" || photographicStyle === "surreal-photographic";
  const documentaryStyle = photographicStyle === "documentary" || photographicStyle === "raw-documentary";

  let value: LightingCharacter;
  switch (lightingBehavior) {
    case "window-light":
      value = "soft-window";
      break;
    case "controlled-studio":
      value = "controlled-studio";
      break;
    case "hard-sun":
      value = "hard-sun";
      break;
    case "overcast-natural":
      value = "diffuse-daylight";
      break;
    case "available-daylight":
      value = documentaryStyle ? "documentary-ambient" : "diffuse-daylight";
      break;
    case "mixed-natural":
    case "practical-light":
      value = "ambient-interior";
      break;
    case "dusk-natural":
      value = "cinematic-shaped";
      break;
    case "soft-directional":
      value = cinematicStyle ? "cinematic-shaped" : "directional-daylight";
      break;
  }

  return {
    value,
    rationale: `Lighting behaviour "${lightingBehavior}" resolves to a ${value} lighting character.`,
    sourceSignals: signals
  };
}

/** §4 — artificiality control. Reuses the P2.6 score verbatim; only bands it. */
function resolveArtificiality(risk: ArtificialityRisk): {
  value: ArtificialityLevel;
  rationale: string;
  sourceSignals: string[];
} {
  const value: ArtificialityLevel = risk.score < 30 ? "low" : risk.score < 60 ? "medium" : "high";
  const guidance =
    value === "low"
      ? "the finish should read as strongly natural, un-retouched photography"
      : value === "medium"
        ? "controlled photographic polish is acceptable; synthetic perfection is not"
        : "a deliberately stylised or synthetic finish is expected";
  return {
    value,
    rationale: `Artificiality control ${value} (score ${risk.score}/100, ${risk.band} band) — ${guidance}.`,
    sourceSignals: [
      `photographic_character.artificiality_risk.score:${risk.score}`,
      `photographic_character.artificiality_risk.band:${risk.band}`
    ]
  };
}

/** §11 — keyed realism notes. Empty for a non-photographic medium. */
function resolveRealismNotes(
  isPhotographic: boolean,
  level: ArtificialityLevel,
  skinRealism: RealismEmphasis
): RealismNoteKey[] {
  if (!isPhotographic) return [];
  if (level === "high") return ["stylised-but-coherent"];

  const notes: RealismNoteKey[] = ["highlight-rolloff", "controlled-sharpening", "restrained-retouching", "material-response"];
  if (skinRealism !== "not-applicable") {
    notes.push("skin-and-face", "hair-and-hands");
  }
  return notes;
}

export function resolvePhotographicFinish(args: PhotographicFinishArgs): PhotographicFinishSpec {
  const style = resolveStyle(args);
  const isPhotographic = style.value !== "graphic-poster" && style.value !== "illustration";

  const colorCharacter = resolveColorCharacter(args);
  const artificiality = resolveArtificiality(args.artificialityRisk);

  const lighting = isPhotographic
    ? (() => {
        const l = resolveLightingCharacter(args);
        return {
          value: l.value,
          rationale: l.rationale,
          source_signals: l.sourceSignals
        };
      })()
    : null;

  return {
    is_photographic: isPhotographic,
    style: {
      value: style.value,
      rationale: style.rationale,
      source_signals: style.sourceSignals
    },
    color_character: {
      value: colorCharacter.value,
      rationale: colorCharacter.rationale,
      source_signals: colorCharacter.sourceSignals
    },
    lighting_character: lighting,
    artificiality: {
      value: artificiality.value,
      score: args.artificialityRisk.score,
      band: args.artificialityRisk.band,
      rationale: artificiality.rationale,
      source_signals: artificiality.sourceSignals
    },
    color_vocabulary: COLOR_CHARACTER_VOCABULARY[colorCharacter.value],
    realism_notes: resolveRealismNotes(isPhotographic, artificiality.value, args.skinRealism)
  };
}
