import {
  NEGATIVE_BASELINE_KEYS,
  type ConstraintInfo,
  type GraphicDeviceBlockEntry,
  type PromptBlocks,
  type PromptSet
} from "../types";
import { TEXT_BEARING_ZONES } from "../text-mode";
import { NEGATIVE_REALISM_BLOCK } from "../../photographic-character/data";
import { VISUAL_ADAPTER_LABEL, visualAdapterSummary } from "../visual-adapter/data";
import { ensureSentence, joinAnd, pct } from "./shared";
import * as V from "./vocabulary";

function aspectRatioLabel(id: string): string {
  return V.ASPECT_RATIO[id as keyof typeof V.ASPECT_RATIO]?.en ?? V.humanizeSlug(id);
}

function zoneLabel(zone: string): string {
  return V.ZONE[zone as keyof typeof V.ZONE]?.en ?? V.humanizeSlug(zone);
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

function formatIntro(blocks: PromptBlocks): string {
  const { format, objective } = blocks;
  const channel = V.CHANNEL[format.channel as keyof typeof V.CHANNEL]?.en ?? V.humanizeSlug(format.channel);
  const objectiveText = V.OBJECTIVE[objective.objective as keyof typeof V.OBJECTIVE]?.en ?? V.humanizeSlug(objective.objective);
  const lines = [`Create a purely visual ${aspectRatioLabel(format.aspectRatioId)} ${channel} visual for ${objectiveText}.`];
  if (objective.coreMessage.trim().length > 0) {
    lines.push(`Core message: "${objective.coreMessage.trim()}".`);
  }
  return lines.join(" ");
}

function formatConcept(blocks: PromptBlocks): string | null {
  const { concept } = blocks;
  if (!concept) return null;
  const lines = [
    `Concept: ${concept.name} — ${concept.bigIdea}`,
    `Visual metaphor: ${concept.visualMetaphor}`,
    `Creative tension: ${concept.creativeTension}`
  ];
  return lines.join("\n");
}

function formatComposition(blocks: PromptBlocks): string {
  const { composition } = blocks;
  const strategy = V.COMPOSITION_STRATEGY[composition.strategy as keyof typeof V.COMPOSITION_STRATEGY]?.en
    ?? V.humanizeSlug(composition.strategy);
  const balance = V.BALANCE[composition.balance as keyof typeof V.BALANCE]?.en ?? composition.balance;
  const flow = V.FLOW[composition.flow as keyof typeof V.FLOW]?.en ?? V.humanizeSlug(composition.flow);
  const { grid } = composition;
  return (
    `Composition & layout: ${strategy}, ${balance} balance, following ${flow} reading flow across a ` +
    `${grid.columns}x${grid.rows} grid with ${pct(grid.gutterRatio)} gutters and ${pct(grid.marginRatio)} margins ` +
    `(${pct(grid.modularity)} modularity). ${ensureSentence(composition.spatialBehavior)} ` +
    `Visual density sits at ${pct(composition.density)}, whitespace at ${pct(composition.whitespace)}.`
  );
}

function formatHierarchy(blocks: PromptBlocks): string {
  const { hierarchy } = blocks;
  const order = hierarchy.readingOrder.map(zoneLabel).join(" → ");
  return (
    `Visual hierarchy: reading order moves ${order}, with hierarchy strength ${pct(hierarchy.strength)} ` +
    `and focal dominance ${pct(hierarchy.focalDominance)}.`
  );
}

function formatTypography(blocks: PromptBlocks, opts: { omitDetail: boolean }): string {
  const { typography, objective, hierarchy } = blocks;
  const requiredTextZones = hierarchy.levels
    .filter((l) => l.required && TEXT_BEARING_ZONES.has(l.zone))
    .map((l) => zoneLabel(l.zone));
  const textZones = requiredTextZones.length > 0 ? requiredTextZones : [zoneLabel("headline")];

  if (opts.omitDetail) {
    return typography.textMode === "TEXT_CRITICAL"
      ? `Typography: leave the ${joinAnd(textZones, "and")} zones clean and uncluttered — do not render any text in this pass; wording will be composited separately.`
      : `Typography: reserve clear, uncluttered space in the ${joinAnd(textZones, "and")} zones — do not render placeholder or final text in this pass.`;
  }

  const strategy = V.TYPOGRAPHY_STRATEGY[typography.strategy as keyof typeof V.TYPOGRAPHY_STRATEGY]?.en
    ?? V.humanizeSlug(typography.strategy);
  const caseBias = V.CASE_BIAS[typography.caseBias as keyof typeof V.CASE_BIAS]?.en ?? typography.caseBias;
  const weightBias = V.WEIGHT_BIAS[typography.weightBias as keyof typeof V.WEIGHT_BIAS]?.en ?? typography.weightBias;
  const fontLine = typography.secondary
    ? `${typography.primary} paired with ${typography.secondary}`
    : typography.primary;

  const base =
    `Typography: ${strategy}, ${caseBias}, ${weightBias} weight, set in ${fontLine} ` +
    `(scale ratio ${typography.scaleRatio.toFixed(2)}). ${ensureSentence(typography.hierarchyBehavior)}`;

  const textInstruction =
    typography.textMode === "TEXT_CRITICAL"
      ? ` Render the core message exactly as written — "${objective.coreMessage.trim()}" — inside the ${zoneLabel(
          textZones[0] ?? "headline"
        )} zone; do not paraphrase, translate or invent additional copy.`
      : ` Preserve the ${joinAnd(textZones, "and")} zones as clear typographic space for messaging to be finalized in a later pass, without rendering final campaign copy now.`;

  return base + textInstruction;
}

function formatColor(blocks: PromptBlocks): string {
  const { color } = blocks;
  const strategy = V.COLOR_STRATEGY[color.strategy as keyof typeof V.COLOR_STRATEGY]?.en ?? V.humanizeSlug(color.strategy);
  const lines = [
    `Color: ${strategy}, ${color.paletteSize}-colour palette, saturation ${pct(color.saturation)}, ` +
      `contrast ${pct(color.contrast)}, complexity ${pct(color.complexity)}. Relationships: ${color.relationships.join(", ")}.`
  ];
  if (color.brandPalette.length > 0) {
    const swatches = color.brandPalette.map((p) => `${p.name} (${p.hex}, ${p.role})`).join(", ");
    lines.push(`Brand palette locked: ${swatches}.`);
  }
  return lines.join(" ");
}

function formatImagery(blocks: PromptBlocks): string {
  const { subject, environment, camera, lighting, materiality } = blocks;
  const nonPhotographic = !blocks.photographicCharacter.finish.isPhotographic;
  const realismPhrase = camera.realism >= 0.6 ? "photographic, high-realism rendering" : "stylised, illustrative rendering";
  const subjectExtra = [
    subject.strategy ? `rendered with ${V.SUBJECT_STRATEGY[subject.strategy as keyof typeof V.SUBJECT_STRATEGY]?.en ?? V.humanizeSlug(subject.strategy)}` : null,
    subject.humanPresence ? (V.HUMAN_PRESENCE[subject.humanPresence as keyof typeof V.HUMAN_PRESENCE]?.en ?? V.humanizeSlug(subject.humanPresence)) : null
  ].filter((part): part is string => Boolean(part));

  const subjectExtraSentence = subjectExtra.length > 0 ? ` ${capitalize(subjectExtra.join(", "))}.` : "";

  const lines = [
    `Imagery & subject: ${ensureSentence(subject.treatment)}${subjectExtraSentence}`,
    `Environment: ${ensureSentence(environment.framing)}${environment.visualWorld ? ` Setting: ${ensureSentence(environment.visualWorld)}` : ""}`,
    nonPhotographic
      ? `Rendering treatment: stylised, non-photographic graphic rendering (realism ${pct(camera.realism)}).`
      : `Camera treatment: ${realismPhrase} (realism ${pct(camera.realism)}).`,
    `Lighting: ${ensureSentence(lighting.direction)} Lighting contrast ${pct(lighting.contrast)}.`,
    `Materiality: ${materiality.surfaces.join(", ")}, texture level ${pct(materiality.texture)}.`
  ];
  return lines.join("\n");
}

/**
 * The Photographic Character section (P2.6). Every value is an already-resolved
 * enum id turned into natural language via the bilingual `PHOTO_*` tables — no
 * raw enum id, and no generic filler ("ultra realistic 8K", "award-winning").
 */
function formatPhotographicCharacter(blocks: PromptBlocks, opts: { detail: "full" | "brief" }): string {
  const p = blocks.photographicCharacter;
  const style = V.PHOTO_STYLE[p.style as keyof typeof V.PHOTO_STYLE]?.en ?? V.humanizeSlug(p.style);
  const realismTarget =
    V.PHOTO_REALISM_TARGET[p.realismTarget as keyof typeof V.PHOTO_REALISM_TARGET]?.en ?? V.humanizeSlug(p.realismTarget);
  const imperfection =
    V.PHOTO_IMPERFECTION[p.imperfectionLevel as keyof typeof V.PHOTO_IMPERFECTION]?.en ?? p.imperfectionLevel;

  // A non-photographic recipe (graphic-poster / illustration, realism target
  // `graphic-non-photographic`) must not emit camera, lens, depth-of-field or
  // skin/optics instructions — the same rule `formatPhotographicFinish` follows.
  if (!p.finish.isPhotographic) {
    return `Rendering character: ${style} — a flat, non-photographic graphic rendering. Shapes, hard edges and controlled colour carry the image; photographic optical realism is not used.`;
  }

  if (opts.detail === "brief") {
    return (
      `Photographic character: believable ${style} at ${realismTarget}, allowing ${imperfection} real-world imperfection ` +
      `(diagnostic artificiality risk ${p.artificialityRisk.score}/100, ${p.artificialityRisk.band}).`
    );
  }

  const emphasis = (value: string): string =>
    V.PHOTO_REALISM_EMPHASIS[value as keyof typeof V.PHOTO_REALISM_EMPHASIS]?.en ?? value;
  const camera = V.PHOTO_CAMERA[p.cameraLanguage as keyof typeof V.PHOTO_CAMERA]?.en ?? V.humanizeSlug(p.cameraLanguage);
  const lens = V.PHOTO_LENS[p.lensCharacter as keyof typeof V.PHOTO_LENS]?.en ?? V.humanizeSlug(p.lensCharacter);
  const dof = V.PHOTO_DOF[p.depthOfField as keyof typeof V.PHOTO_DOF]?.en ?? V.humanizeSlug(p.depthOfField);
  const focus = V.PHOTO_FOCUS[p.focusBehavior as keyof typeof V.PHOTO_FOCUS]?.en ?? V.humanizeSlug(p.focusBehavior);
  const perspective =
    V.PHOTO_PERSPECTIVE[p.perspectiveBehavior as keyof typeof V.PHOTO_PERSPECTIVE]?.en ?? V.humanizeSlug(p.perspectiveBehavior);
  const lighting = V.PHOTO_LIGHTING[p.lightingBehavior as keyof typeof V.PHOTO_LIGHTING]?.en ?? V.humanizeSlug(p.lightingBehavior);
  const lightDir = V.PHOTO_LIGHT_DIR[p.lightDirection as keyof typeof V.PHOTO_LIGHT_DIR]?.en ?? V.humanizeSlug(p.lightDirection);
  const highlight = V.PHOTO_HIGHLIGHT[p.highlightRolloff as keyof typeof V.PHOTO_HIGHLIGHT]?.en ?? V.humanizeSlug(p.highlightRolloff);
  const shadow = V.PHOTO_SHADOW[p.shadowBehavior as keyof typeof V.PHOTO_SHADOW]?.en ?? V.humanizeSlug(p.shadowBehavior);
  const colorResponse =
    V.PHOTO_COLOR_RESPONSE[p.colorResponse as keyof typeof V.PHOTO_COLOR_RESPONSE]?.en ?? V.humanizeSlug(p.colorResponse);
  const whiteBalance =
    V.PHOTO_WHITE_BALANCE[p.whiteBalance as keyof typeof V.PHOTO_WHITE_BALANCE]?.en ?? V.humanizeSlug(p.whiteBalance);
  const dynamicRange =
    V.PHOTO_DYNAMIC_RANGE[p.dynamicRange as keyof typeof V.PHOTO_DYNAMIC_RANGE]?.en ?? V.humanizeSlug(p.dynamicRange);
  const texture = V.PHOTO_TEXTURE[p.textureCharacter as keyof typeof V.PHOTO_TEXTURE]?.en ?? V.humanizeSlug(p.textureCharacter);
  const motion = V.PHOTO_MOTION[p.motionRealism as keyof typeof V.PHOTO_MOTION]?.en ?? V.humanizeSlug(p.motionRealism);

  const realismParts: string[] = [];
  if (p.skinRealism !== "not-applicable") {
    realismParts.push(
      `keep skin ${emphasis(p.skinRealism)} with subtle facial asymmetry, hair ${emphasis(p.hairRealism)} and hands ${emphasis(
        p.handRealism
      )}`
    );
  } else if (p.handRealism !== "not-applicable") {
    realismParts.push(`keep any visible hands ${emphasis(p.handRealism)}`);
  }
  if (p.fabricRealism !== "not-applicable") realismParts.push(`render fabric ${emphasis(p.fabricRealism)}`);
  realismParts.push(`keep materials ${emphasis(p.materialRealism)} and the environment ${emphasis(p.environmentalRealism)}`);

  const prefer = p.constraints.filter((c) => c.kind === "prefer").map((c) => c.statement);
  const avoid = p.constraints.filter((c) => c.kind === "avoid").map((c) => c.statement);

  const lines = [
    `Photographic character: render believable ${style} at ${realismTarget}.`,
    `Camera: ${camera} with ${lens} and ${dof} — ${focus}, ${perspective}.`,
    `Light: ${lighting} from ${lightDir}, ${shadow}, ${highlight}, and ${dynamicRange}.`,
    `Colour: ${colorResponse} at ${whiteBalance}.`,
    `Realism: ${realismParts.join("; ")}. Texture reads as ${texture}; motion is ${motion}; allow ${imperfection} real-world imperfection.`,
    `Prefer ${prefer.join("; ")}.`,
    `Avoid ${avoid.join("; ")}.`
  ];
  return lines.join("\n");
}

function photographicCharacterNegatives(): string[] {
  return [NEGATIVE_REALISM_BLOCK.en];
}

/**
 * The Photographic Finish section (P2.9). Named style / colour / lighting /
 * artificiality tokens, rendered through the bilingual `FINISH_*` /
 * `COLOR_CHARACTER` / `LIGHTING_CHARACTER` tables.
 *
 * For a non-photographic medium (graphic-poster / illustration) this renders a
 * colour-character line ONLY — never camera, lens, skin, bokeh or photographic
 * lighting vocabulary.
 */
function formatPhotographicFinish(blocks: PromptBlocks, opts: { detail: "full" | "brief" }): string {
  const f = blocks.photographicCharacter.finish;
  const colorChar = V.COLOR_CHARACTER[f.colorCharacter as keyof typeof V.COLOR_CHARACTER]?.en ?? V.humanizeSlug(f.colorCharacter);

  if (!f.isPhotographic) {
    return `Colour finish — ${colorChar}: hold the recipe palette flat, clean and controlled, following the graphic recipe.`;
  }

  const style = V.FINISH_STYLE[f.style as keyof typeof V.FINISH_STYLE]?.en ?? V.humanizeSlug(f.style);
  const level = V.ARTIFICIALITY_LEVEL[f.artificiality.level as keyof typeof V.ARTIFICIALITY_LEVEL]?.en ?? f.artificiality.level;
  const lighting = f.lightingCharacter
    ? V.LIGHTING_CHARACTER[f.lightingCharacter as keyof typeof V.LIGHTING_CHARACTER]?.en ?? V.humanizeSlug(f.lightingCharacter)
    : null;

  if (opts.detail === "brief") {
    return (
      `Photographic finish: ${style}, ${colorChar} colour${lighting ? `, ${lighting}` : ""}, ` +
      `artificiality ${level} (${f.artificiality.score}/100).`
    );
  }

  const cv = f.colorVocabulary;
  const wb = V.PHOTO_WHITE_BALANCE[cv.whiteBalance as keyof typeof V.PHOTO_WHITE_BALANCE]?.en ?? V.humanizeSlug(cv.whiteBalance);
  const sat = V.COLOR_SATURATION_RESTRAINT[cv.saturationRestraint as keyof typeof V.COLOR_SATURATION_RESTRAINT]?.en ?? cv.saturationRestraint;
  const con = V.COLOR_CONTRAST_CHARACTER[cv.contrastCharacter as keyof typeof V.COLOR_CONTRAST_CHARACTER]?.en ?? cv.contrastCharacter;
  const hl = V.PHOTO_HIGHLIGHT[cv.highlightRolloff as keyof typeof V.PHOTO_HIGHLIGHT]?.en ?? V.humanizeSlug(cv.highlightRolloff);
  const sd = V.SHADOW_DENSITY[cv.shadowDensity as keyof typeof V.SHADOW_DENSITY]?.en ?? cv.shadowDensity;
  const sep = V.COLOR_SEPARATION[cv.colorSeparation as keyof typeof V.COLOR_SEPARATION]?.en ?? cv.colorSeparation;
  const guidance = V.ARTIFICIALITY_GUIDANCE[f.artificiality.level as keyof typeof V.ARTIFICIALITY_GUIDANCE]?.en ?? "";
  const notes = f.realismNotes.map((k) => V.REALISM_NOTE[k as keyof typeof V.REALISM_NOTE]?.en ?? V.humanizeSlug(k));

  const lines = [
    `Photographic finish — style ${style}.`,
    `Colour character: ${colorChar} — ${wb}, ${sat}, ${con}, ${hl}, ${sd}, ${sep}.`,
    ...(lighting ? [`Lighting character: ${lighting}.`] : []),
    `Artificiality: ${level} · ${f.artificiality.score}/100 — ${guidance}.`,
    ...(notes.length > 0 ? [`Realism notes: ${notes.join("; ")}.`] : [])
  ];
  return lines.join("\n");
}

/**
 * The Visual Generation Adapter section (P2.7). Translates the resolved
 * adapter's compact phrasing into natural language. The raw adapter id is
 * never printed — only the human-facing label. For graphic-poster and
 * illustration the adapter vocabulary carries no photographic skin/optics/lens
 * language, so this section does not either.
 */
function formatVisualGeneration(
  blocks: PromptBlocks,
  opts: { tier: "master" | "quick" | "image" | "layout" }
): string {
  const vg = blocks.visualGeneration;
  const v = vg.rendering;
  // The human-facing label, never the raw hyphenated id.
  const label = VISUAL_ADAPTER_LABEL[vg.adapterId]?.en ?? V.humanizeSlug(vg.adapterId);

  if (opts.tier === "quick") {
    return `Visual character — ${label}: ${v.camera_language.en}; ${v.realism_language.en}.`;
  }

  if (opts.tier === "layout") {
    return (
      `Visual medium character — ${label}: ${v.composition_language.en}. ` +
      `${ensureSentence(capitalize(v.rendering_language.en))}`
    );
  }

  const lines = [
    `Visual generation character — ${label}:`,
    `Viewpoint: ${v.camera_language.en}.`,
    `Light: ${v.lighting_language.en}.`,
    `Surfaces & materials: ${v.surface_or_material_language.en}.`,
    ...(opts.tier === "master" ? [`Composition character: ${v.composition_language.en}.`] : []),
    `Rendering: ${v.realism_language.en}; ${v.rendering_language.en}.`,
    `Motion: ${v.motion_language.en}.`,
    ...(opts.tier === "master" ? [`Avoid ${v.avoid_language.en}.`] : [])
  ];
  return lines.join("\n");
}

function visualGenerationNegatives(blocks: PromptBlocks): string[] {
  return [blocks.visualGeneration.rendering.avoid_language.en];
}

function formatGraphicElements(blocks: PromptBlocks): string {
  const { graphicElements } = blocks;
  return (
    `Graphic language: ${ensureSentence(graphicElements.shapeLogic)} Rhythm: ${ensureSentence(
      graphicElements.rhythm
    )} Ornament level ${pct(graphicElements.ornament)}.`
  );
}

/**
 * Every device is already natural-language production instruction
 * (`prompt_en` on the recipe, authored in engine/graphic-treatment/data.ts) —
 * this never dumps a raw device id (doctrine §18).
 */
function formatGraphicTreatment(blocks: PromptBlocks, opts: { visualOnly: boolean }): string | null {
  const gt = blocks.graphicTreatment;
  const groups: { label: string; devices: readonly GraphicDeviceBlockEntry[] }[] = [
    { label: V.GRAPHIC_DEVICE_CATEGORY.structural.en, devices: gt.structuralDevices },
    { label: V.GRAPHIC_DEVICE_CATEGORY.expressive.en, devices: gt.expressiveDevices },
    { label: V.GRAPHIC_DEVICE_CATEGORY.image_treatment.en, devices: gt.imageTreatments },
    ...(opts.visualOnly
      ? []
      : [{ label: V.GRAPHIC_DEVICE_CATEGORY.typography_treatment.en, devices: gt.typographyTreatments }]),
    { label: V.GRAPHIC_DEVICE_CATEGORY.texture.en, devices: gt.textures },
    { label: V.GRAPHIC_DEVICE_CATEGORY.pattern.en, devices: gt.patterns },
    { label: V.GRAPHIC_DEVICE_CATEGORY.layering.en, devices: gt.layering },
    { label: V.GRAPHIC_DEVICE_CATEGORY.accent.en, devices: gt.accents }
  ].filter((group) => group.devices.length > 0);

  if (groups.length === 0) return null;

  const intensityLabel =
    V.GRAPHIC_TREATMENT_INTENSITY[gt.intensity as keyof typeof V.GRAPHIC_TREATMENT_INTENSITY]?.en ?? gt.intensity;
  const lines = groups.map((group) => `${group.label}: ${group.devices.map((d) => d.promptEn).join(" ")}`);
  return `Graphic treatment (${intensityLabel}):\n${lines.join("\n")}`;
}

/** Only relevant when the plan actually left something out or when nothing was selected at all. */
function graphicTreatmentNegatives(blocks: PromptBlocks): string[] {
  const gt = blocks.graphicTreatment;
  const total =
    gt.structuralDevices.length +
    gt.expressiveDevices.length +
    gt.imageTreatments.length +
    gt.typographyTreatments.length +
    gt.textures.length +
    gt.patterns.length +
    gt.layering.length +
    gt.accents.length;
  if (total === 0) return ["random or unmotivated graphic decoration"];
  if (gt.intensity === "expressive" || gt.intensity === "experimental") {
    return ["uncontrolled collage or competing graphic accents beyond the graphic devices specified above"];
  }
  return [];
}

function formatCulture(blocks: PromptBlocks): string {
  const { culture } = blocks;
  const dims = culture.dimensions
    .map((d) => `${d.dimension} led by ${d.countryName}${d.contested ? " (contested)" : ""}`)
    .join("; ");
  return (
    `Culture & country influence: ${dims}. Grounded in ${culture.movementName} principles: ` +
    `${culture.corePrinciples.join(", ")}. Anti-stereotype guardrails: ${culture.antiStereotype.join(" ")}`
  );
}

/** Unique demonyms for every country carrying a dimension, in stable order. */
function culturalInfluenceNames(blocks: PromptBlocks): string[] {
  const names = new Set(blocks.culture.dimensions.map((d) => V.demonym(d.countryId, d.countryName, "en")));
  return [...names].sort();
}

/**
 * One compact rule instead of a per-country dump of every banned token —
 * the anti-stereotype intent is preserved, the repeated token lists are not.
 */
function buildAntiStereotypeLine(blocks: PromptBlocks): string | null {
  const names = culturalInfluenceNames(blocks);
  if (names.length === 0) return null;
  return (
    `Avoid stereotypical ${joinAnd(names, "or")} visual shorthand; express cultural influence through ` +
    `spatial behavior, typography relationships, color relationships, and materiality.`
  );
}

function formatConstraintGroup(title: string, constraints: readonly ConstraintInfo[]): string | null {
  if (constraints.length === 0) return null;
  return `${title}:\n${constraints.map((c) => `- ${ensureSentence(c.statement)}`).join("\n")}`;
}

function formatIndustry(blocks: PromptBlocks): string | null {
  return formatConstraintGroup("Industry requirements", blocks.industry.constraints);
}

function formatBrand(blocks: PromptBlocks): string {
  const { brand } = blocks;
  if (!brand.present) {
    return "Brand: no brand is attached to this project — use a generic, unbranded visual identity.";
  }
  const fontLine = brand.secondaryFont ? `${brand.primaryFont} with ${brand.secondaryFont}` : brand.primaryFont;
  const palette = brand.palette.map((p) => `${p.name} (${p.hex})`).join(", ");
  const rules = brand.constraints.length > 0
    ? `\n${brand.constraints.map((c) => `- ${ensureSentence(c.statement)}`).join("\n")}`
    : "";
  return `Brand: locked to typography ${fontLine} and palette ${palette}. Brand rules:${rules || " none beyond the palette and typography."}`;
}

function formatPlatform(blocks: PromptBlocks): string {
  const { platform } = blocks;
  const channel = V.CHANNEL[platform.channel as keyof typeof V.CHANNEL]?.en ?? V.humanizeSlug(platform.channel);
  const viewing = V.VIEWING_CONTEXT[platform.viewingContext as keyof typeof V.VIEWING_CONTEXT]?.en ?? V.humanizeSlug(platform.viewingContext);
  const lines = [
    `Platform constraints: ${channel}, ${aspectRatioLabel(platform.aspectRatioId)}, viewed at ${viewing}. ` +
      `Localised on-image text is ${platform.localisedText ? "expected" : "not required"}.`
  ];
  if (platform.constraints.length > 0) {
    lines.push(platform.constraints.map((c) => `- ${ensureSentence(c.statement)}`).join("\n"));
  }
  return lines.join("\n");
}

function formatQuality(blocks: PromptBlocks): string {
  const items = blocks.quality.requirements.map((key) => V.QUALITY_REQUIREMENT[key].en);
  return `Quality requirements: ${joinAnd(items, "and")}.`;
}

/**
 * Positive requirements only. `must_not`/`avoid` constraints are not dropped —
 * they, plus the universal baseline, are consolidated into one trailing
 * Avoid paragraph (`buildNegativePrompt`) instead of a second, duplicate
 * bullet list right above it.
 */
function formatConstraintsAppendix(blocks: PromptBlocks): string[] {
  const { constraints } = blocks;
  const sections: string[] = [];
  const must = formatConstraintGroup("Requirements (must)", constraints.must);
  const preferred = formatConstraintGroup("Preferences", constraints.prefer);
  for (const section of [must, preferred]) {
    if (section) sections.push(section);
  }
  return sections;
}

function buildNegativePrompt(blocks: PromptBlocks): string {
  const { constraints, format, textMode, objective } = blocks;
  const items: string[] = [];

  items.push(...NEGATIVE_BASELINE_KEYS.map((key) => V.NEGATIVE_BASELINE[key].en));
  items.push(`incorrect aspect ratio (must be ${aspectRatioLabel(format.aspectRatioId)})`);

  const antiStereotype = buildAntiStereotypeLine(blocks);
  if (antiStereotype) items.push(antiStereotype);

  items.push(...graphicTreatmentNegatives(blocks));
  items.push(...photographicCharacterNegatives());
  items.push(...visualGenerationNegatives(blocks));

  // Country-sourced must-not statements repeat the same anti-stereotype
  // guardrail (one full sentence per country in the blend, each with its own
  // banned-token list) that `antiStereotype` above already states once,
  // compactly. Every other source (brief, brand, industry, platform,
  // visual_type) is a distinct, specific negative and stays.
  const nonCultureMustNot = constraints.mustNot.filter((c) => c.source !== "country");
  const nonCultureAvoid = constraints.avoid.filter((c) => c.source !== "country");
  for (const c of [...nonCultureMustNot, ...nonCultureAvoid]) {
    items.push(ensureSentence(c.statement).replace(/\.$/, ""));
  }

  items.push(
    textMode === "TEXT_CRITICAL"
      ? `altered, misspelled or invented wording of the core message ("${objective.coreMessage.trim()}")`
      : "rendered placeholder or lorem-ipsum text in the reserved copy zones"
  );

  return `Avoid: ${items.join("; ")}.`;
}

export function renderEnglish(blocks: PromptBlocks): Omit<PromptSet, "language" | "guard"> {
  const conceptSection = formatConcept(blocks);

  const masterSections = [
    formatIntro(blocks),
    conceptSection,
    formatComposition(blocks),
    formatHierarchy(blocks),
    formatTypography(blocks, { omitDetail: false }),
    formatColor(blocks),
    formatImagery(blocks),
    formatPhotographicCharacter(blocks, { detail: "full" }),
    formatPhotographicFinish(blocks, { detail: "full" }),
    formatVisualGeneration(blocks, { tier: "master" }),
    formatGraphicElements(blocks),
    formatGraphicTreatment(blocks, { visualOnly: false }),
    formatCulture(blocks),
    formatIndustry(blocks),
    formatBrand(blocks),
    formatPlatform(blocks),
    formatQuality(blocks),
    ...formatConstraintsAppendix(blocks),
    buildNegativePrompt(blocks)
  ].filter((section): section is string => Boolean(section));

  const masterPrompt = masterSections.join("\n\n");

  const designLayoutSections = [
    formatIntro(blocks),
    conceptSection,
    formatComposition(blocks),
    formatHierarchy(blocks),
    formatTypography(blocks, { omitDetail: false }),
    formatColor(blocks),
    formatGraphicElements(blocks),
    formatGraphicTreatment(blocks, { visualOnly: false }),
    formatPhotographicCharacter(blocks, { detail: "brief" }),
    formatPhotographicFinish(blocks, { detail: "brief" }),
    formatVisualGeneration(blocks, { tier: "layout" }),
    formatBrand(blocks),
    formatPlatform(blocks),
    formatQuality(blocks),
    ...formatConstraintsAppendix(blocks),
    buildNegativePrompt(blocks)
  ].filter((section): section is string => Boolean(section));

  const imageOnlySections = [
    formatIntro(blocks),
    conceptSection,
    formatComposition(blocks),
    formatHierarchy(blocks),
    formatTypography(blocks, { omitDetail: true }),
    formatColor(blocks),
    formatImagery(blocks),
    formatPhotographicCharacter(blocks, { detail: "full" }),
    formatPhotographicFinish(blocks, { detail: "full" }),
    formatVisualGeneration(blocks, { tier: "image" }),
    formatGraphicElements(blocks),
    formatGraphicTreatment(blocks, { visualOnly: true }),
    formatCulture(blocks),
    formatIndustry(blocks),
    formatPlatform(blocks),
    formatQuality(blocks),
    buildNegativePrompt(blocks)
  ].filter((section): section is string => Boolean(section));

  const objectiveText = V.OBJECTIVE[blocks.objective.objective as keyof typeof V.OBJECTIVE]?.en ?? V.humanizeSlug(blocks.objective.objective);
  const compositionStrategy = V.COMPOSITION_STRATEGY[blocks.composition.strategy as keyof typeof V.COMPOSITION_STRATEGY]?.en
    ?? V.humanizeSlug(blocks.composition.strategy);
  const colorStrategy = V.COLOR_STRATEGY[blocks.color.strategy as keyof typeof V.COLOR_STRATEGY]?.en ?? V.humanizeSlug(blocks.color.strategy);
  const topMust = blocks.constraints.must.slice(0, 2).map((c) => ensureSentence(c.statement));

  const quickLines = [
    `${aspectRatioLabel(blocks.format.aspectRatioId)} ${V.CHANNEL[blocks.format.channel as keyof typeof V.CHANNEL]?.en ?? blocks.format.channel} visual for ${objectiveText}${
      blocks.concept ? ` — ${blocks.concept.name}: ${blocks.concept.bigIdea}` : ""
    }`,
    `${compositionStrategy}, ${colorStrategy}, ${
      V.TYPOGRAPHY_STRATEGY[blocks.typography.strategy as keyof typeof V.TYPOGRAPHY_STRATEGY]?.en ?? blocks.typography.strategy
    }.`,
    formatVisualGeneration(blocks, { tier: "quick" }),
    ...(topMust.length > 0 ? [`Must: ${topMust.join(" ")}`] : []),
    `Avoid: ${V.NEGATIVE_BASELINE.generic_stock_photo.en}, ${V.NEGATIVE_BASELINE.clutter.en}, ${V.NEGATIVE_BASELINE.weak_hierarchy.en}.`
  ];

  const adapterId = blocks.visualGeneration.adapterId;
  const adapterLabel = VISUAL_ADAPTER_LABEL[adapterId]?.en ?? V.humanizeSlug(adapterId);
  const realismTargetLabel = capitalize(
    V.PHOTO_REALISM_TARGET[blocks.visualGeneration.realismTarget as keyof typeof V.PHOTO_REALISM_TARGET]?.en
      ?? V.humanizeSlug(blocks.visualGeneration.realismTarget)
  );

  return {
    masterPrompt,
    quickPrompt: quickLines.join(" "),
    imageOnlyPrompt: imageOnlySections.join("\n\n"),
    designLayoutPrompt: designLayoutSections.join("\n\n"),
    negativePrompt: buildNegativePrompt(blocks),
    visualCharacter: {
      id: adapterId,
      label: `${adapterLabel} · ${realismTargetLabel}`,
      description: visualAdapterSummary(adapterId, "en")
    }
  };
}
