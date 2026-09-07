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

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

function aspectRatioLabel(id: string): string {
  return V.ASPECT_RATIO[id as keyof typeof V.ASPECT_RATIO]?.id ?? V.humanizeSlug(id);
}

function zoneLabel(zone: string): string {
  return V.ZONE[zone as keyof typeof V.ZONE]?.id ?? V.humanizeSlug(zone);
}

function formatIntro(blocks: PromptBlocks): string {
  const { format, objective } = blocks;
  const channel = V.CHANNEL[format.channel as keyof typeof V.CHANNEL]?.id ?? V.humanizeSlug(format.channel);
  const objectiveText = V.OBJECTIVE[objective.objective as keyof typeof V.OBJECTIVE]?.id ?? V.humanizeSlug(objective.objective);
  const lines = [`Buat sebuah visual ${aspectRatioLabel(format.aspectRatioId)} untuk ${channel}, untuk keperluan ${objectiveText}.`];
  if (objective.coreMessage.trim().length > 0) {
    lines.push(`Pesan utama: "${objective.coreMessage.trim()}".`);
  }
  return lines.join(" ");
}

function formatConcept(blocks: PromptBlocks): string | null {
  const { concept } = blocks;
  if (!concept) return null;
  const lines = [
    `Konsep: ${concept.name} — ${concept.bigIdea}`,
    `Metafora visual: ${concept.visualMetaphor}`,
    `Tegangan kreatif (creative tension): ${concept.creativeTension}`
  ];
  return lines.join("\n");
}

function formatComposition(blocks: PromptBlocks): string {
  const { composition } = blocks;
  const strategy = V.COMPOSITION_STRATEGY[composition.strategy as keyof typeof V.COMPOSITION_STRATEGY]?.id
    ?? V.humanizeSlug(composition.strategy);
  const balance = V.BALANCE[composition.balance as keyof typeof V.BALANCE]?.id ?? composition.balance;
  const flow = V.FLOW[composition.flow as keyof typeof V.FLOW]?.id ?? V.humanizeSlug(composition.flow);
  const { grid } = composition;
  return (
    `Komposisi & layout: gunakan ${strategy} dengan keseimbangan ${balance}, alur baca ${flow}, ` +
    `di atas grid ${grid.columns}x${grid.rows} dengan gutter ${pct(grid.gutterRatio)} dan margin ${pct(grid.marginRatio)} ` +
    `(modularitas ${pct(grid.modularity)}). ` +
    `Kepadatan visual berada di ${pct(composition.density)}, whitespace di ${pct(composition.whitespace)}.`
  );
}

function formatHierarchy(blocks: PromptBlocks): string {
  const { hierarchy } = blocks;
  const order = hierarchy.readingOrder.map(zoneLabel).join(" → ");
  return (
    `Hierarki visual: urutan baca bergerak dari ${order}, dengan kekuatan hierarki ${pct(hierarchy.strength)} ` +
    `dan dominasi fokus ${pct(hierarchy.focalDominance)}.`
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
      ? `Tipografi: biarkan zona ${joinAnd(textZones, "dan")} bersih tanpa teks pada tahap ini — teks akan disusun pada proses terpisah.`
      : `Tipografi: sisakan ruang bersih dan rapi pada zona ${joinAnd(textZones, "dan")} — jangan render teks placeholder maupun teks final pada tahap ini.`;
  }

  const strategy = V.TYPOGRAPHY_STRATEGY[typography.strategy as keyof typeof V.TYPOGRAPHY_STRATEGY]?.id
    ?? V.humanizeSlug(typography.strategy);
  const caseBias = V.CASE_BIAS[typography.caseBias as keyof typeof V.CASE_BIAS]?.id ?? typography.caseBias;
  const weightBias = V.WEIGHT_BIAS[typography.weightBias as keyof typeof V.WEIGHT_BIAS]?.id ?? typography.weightBias;
  const fontLine = typography.secondary
    ? `${typography.primary} dipadukan dengan ${typography.secondary}`
    : typography.primary;

  const base =
    `Tipografi: ${strategy}, ${caseBias}, ketebalan ${weightBias}, menggunakan ${fontLine} ` +
    `(scale ratio ${typography.scaleRatio.toFixed(2)}).`;

  const textInstruction =
    typography.textMode === "TEXT_CRITICAL"
      ? ` Render pesan utama persis seperti tertulis — "${objective.coreMessage.trim()}" — di dalam zona ${zoneLabel(
          textZones[0] ?? "headline"
        )}; jangan diparafrase, diterjemahkan, atau ditambah kalimat lain.`
      : ` Sisakan zona ${joinAnd(textZones, "dan")} sebagai ruang tipografi yang jelas untuk pesan yang akan ditentukan pada tahap berikutnya, tanpa merender teks kampanye final sekarang.`;

  return base + textInstruction;
}

/** `color.relationships` is English dataset prose with no structured equivalent — omitted rather than left untranslated. */
function formatColor(blocks: PromptBlocks): string {
  const { color } = blocks;
  const strategy = V.COLOR_STRATEGY[color.strategy as keyof typeof V.COLOR_STRATEGY]?.id ?? V.humanizeSlug(color.strategy);
  const lines = [
    `Warna: ${strategy}, palet ${color.paletteSize} warna, saturasi ${pct(color.saturation)}, ` +
      `kontras ${pct(color.contrast)}, kompleksitas ${pct(color.complexity)}.`
  ];
  if (color.brandPalette.length > 0) {
    const swatches = color.brandPalette.map((p) => `${p.name} (${p.hex}, ${p.role})`).join(", ");
    lines.push(`Palet brand terkunci: ${swatches}.`);
  }
  return lines.join(" ");
}

/**
 * `subject.treatment`, `environment.framing` and `lighting.direction` are
 * free-text prose quoted verbatim from the country/movement datasets — those
 * datasets are authored in English (docs/prompt-compiler.md, "Known MVP
 * boundary"). Rather than leave whole English sentences inside an Indonesian
 * prompt, the Indonesian renderer omits that prose and keeps only the
 * structured, already-bilingual descriptors (subject strategy, human
 * presence, realism, contrast, materials, and the concept's own
 * `visualWorld` when one exists).
 */
function formatImagery(blocks: PromptBlocks): string {
  const { subject, environment, camera, lighting, materiality } = blocks;
  const nonPhotographic = !blocks.photographicCharacter.finish.isPhotographic;
  const realismPhrase =
    camera.realism >= 0.6 ? "rendering fotografis dengan realisme tinggi" : "rendering yang stilasi (illustrative)";
  const subjectParts = [
    subject.strategy
      ? V.SUBJECT_STRATEGY[subject.strategy as keyof typeof V.SUBJECT_STRATEGY]?.id ?? V.humanizeSlug(subject.strategy)
      : null,
    subject.humanPresence
      ? V.HUMAN_PRESENCE[subject.humanPresence as keyof typeof V.HUMAN_PRESENCE]?.id ?? V.humanizeSlug(subject.humanPresence)
      : null
  ].filter((part): part is string => Boolean(part));

  const lines = [
    subjectParts.length > 0 ? `Imagery & subjek: ${subjectParts.join(", ")}.` : null,
    environment.visualWorld ? `Lingkungan: ${ensureSentence(environment.visualWorld)}` : null,
    nonPhotographic
      ? `Perlakuan rendering: rendering grafis non-fotografis yang stilasi (tingkat realisme ${pct(camera.realism)}).`
      : `Perlakuan kamera: ${realismPhrase} (tingkat realisme ${pct(camera.realism)}).`,
    `Pencahayaan: kontras ${pct(lighting.contrast)}.`,
    `Materialitas: ${materiality.surfaces.join(", ")}, tingkat tekstur ${pct(materiality.texture)}.`
  ].filter((line): line is string => Boolean(line));
  return lines.join("\n");
}

/**
 * Photographic Character (P2.6). The resolved enum values are identical to the
 * English prompt; only the wording differs. The realism doctrine is
 * re-authored in Indonesian here (from the same subject facts) rather than
 * carrying the English `constraints` statements into an Indonesian prompt —
 * the same policy this renderer applies to every other quoted dataset string.
 */
function formatPhotographicCharacter(blocks: PromptBlocks, opts: { detail: "full" | "brief" }): string {
  const p = blocks.photographicCharacter;
  const style = V.PHOTO_STYLE[p.style as keyof typeof V.PHOTO_STYLE]?.id ?? V.humanizeSlug(p.style);
  const realismTarget =
    V.PHOTO_REALISM_TARGET[p.realismTarget as keyof typeof V.PHOTO_REALISM_TARGET]?.id ?? V.humanizeSlug(p.realismTarget);
  const imperfection =
    V.PHOTO_IMPERFECTION[p.imperfectionLevel as keyof typeof V.PHOTO_IMPERFECTION]?.id ?? p.imperfectionLevel;

  // Medium non-fotografis (graphic-poster / illustration): tidak ada instruksi
  // kamera, lensa, depth of field, atau kulit/optik — sama seperti aturan pada
  // `formatPhotographicFinish`.
  if (!p.finish.isPhotographic) {
    return `Karakter rendering: ${style} — rendering grafis non-fotografis yang datar. Bentuk, tepi tegas, dan warna terkontrol yang membawa gambar; realisme optik fotografis tidak digunakan.`;
  }

  if (opts.detail === "brief") {
    return (
      `Karakter fotografis: ${style} yang believable dengan ${realismTarget}, dengan imperfeksi dunia nyata ${imperfection} ` +
      `(risiko artifisialitas diagnostik ${p.artificialityRisk.score}/100, ${p.artificialityRisk.band}).`
    );
  }

  const emphasis = (value: string): string =>
    V.PHOTO_REALISM_EMPHASIS[value as keyof typeof V.PHOTO_REALISM_EMPHASIS]?.id ?? value;
  const camera = V.PHOTO_CAMERA[p.cameraLanguage as keyof typeof V.PHOTO_CAMERA]?.id ?? V.humanizeSlug(p.cameraLanguage);
  const lens = V.PHOTO_LENS[p.lensCharacter as keyof typeof V.PHOTO_LENS]?.id ?? V.humanizeSlug(p.lensCharacter);
  const dof = V.PHOTO_DOF[p.depthOfField as keyof typeof V.PHOTO_DOF]?.id ?? V.humanizeSlug(p.depthOfField);
  const focus = V.PHOTO_FOCUS[p.focusBehavior as keyof typeof V.PHOTO_FOCUS]?.id ?? V.humanizeSlug(p.focusBehavior);
  const perspective =
    V.PHOTO_PERSPECTIVE[p.perspectiveBehavior as keyof typeof V.PHOTO_PERSPECTIVE]?.id ?? V.humanizeSlug(p.perspectiveBehavior);
  const lighting = V.PHOTO_LIGHTING[p.lightingBehavior as keyof typeof V.PHOTO_LIGHTING]?.id ?? V.humanizeSlug(p.lightingBehavior);
  const lightDir = V.PHOTO_LIGHT_DIR[p.lightDirection as keyof typeof V.PHOTO_LIGHT_DIR]?.id ?? V.humanizeSlug(p.lightDirection);
  const highlight = V.PHOTO_HIGHLIGHT[p.highlightRolloff as keyof typeof V.PHOTO_HIGHLIGHT]?.id ?? V.humanizeSlug(p.highlightRolloff);
  const shadow = V.PHOTO_SHADOW[p.shadowBehavior as keyof typeof V.PHOTO_SHADOW]?.id ?? V.humanizeSlug(p.shadowBehavior);
  const colorResponse =
    V.PHOTO_COLOR_RESPONSE[p.colorResponse as keyof typeof V.PHOTO_COLOR_RESPONSE]?.id ?? V.humanizeSlug(p.colorResponse);
  const whiteBalance =
    V.PHOTO_WHITE_BALANCE[p.whiteBalance as keyof typeof V.PHOTO_WHITE_BALANCE]?.id ?? V.humanizeSlug(p.whiteBalance);
  const dynamicRange =
    V.PHOTO_DYNAMIC_RANGE[p.dynamicRange as keyof typeof V.PHOTO_DYNAMIC_RANGE]?.id ?? V.humanizeSlug(p.dynamicRange);
  const texture = V.PHOTO_TEXTURE[p.textureCharacter as keyof typeof V.PHOTO_TEXTURE]?.id ?? V.humanizeSlug(p.textureCharacter);
  const motion = V.PHOTO_MOTION[p.motionRealism as keyof typeof V.PHOTO_MOTION]?.id ?? V.humanizeSlug(p.motionRealism);

  const has = (needle: string) => p.constraints.some((c) => c.statement.includes(needle));
  const human = has("natural facial asymmetry");
  const impliedHands = has("realistic skin texture at close range");
  const product = has("believable weight and placement");
  const environment = has("believable atmospheric perspective");

  const realismParts: string[] = [];
  if (p.skinRealism !== "not-applicable") {
    realismParts.push(
      `jaga kulit ${emphasis(p.skinRealism)} dengan asimetri wajah yang halus, rambut ${emphasis(p.hairRealism)}, dan tangan ${emphasis(
        p.handRealism
      )}`
    );
  } else if (p.handRealism !== "not-applicable") {
    realismParts.push(`jaga setiap tangan yang terlihat ${emphasis(p.handRealism)}`);
  }
  if (p.fabricRealism !== "not-applicable") realismParts.push(`render kain ${emphasis(p.fabricRealism)}`);
  realismParts.push(`jaga material ${emphasis(p.materialRealism)} dan lingkungan ${emphasis(p.environmentalRealism)}`);

  const preferParts = [
    "satu sumber cahaya yang plausibel secara fisik dengan arah konsisten dan falloff yang realistis",
    "white balance yang koheren, permukaan netral yang natural, dan saturasi yang terkendali sesuai palet recipe",
    "perilaku material yang believable dengan variasi permukaan dan imperfeksi dunia nyata yang halus"
  ];
  if (human) {
    preferParts.push(
      "asimetri wajah yang natural, tekstur kulit yang realistis dengan pori halus, pantulan mata yang natural, dan anatomi tangan yang benar"
    );
  } else if (impliedHands) {
    preferParts.push("anatomi jari yang natural dan kulit yang realistis pada jarak dekat");
  }
  if (product) {
    preferParts.push("variasi permukaan yang realistis, pantulan yang believable, highlight yang plausibel, dan bayangan kontak yang natural");
  }
  if (environment) {
    preferParts.push("kedalaman yang plausibel secara fisik, jarak antar-objek yang natural, dan perspektif atmosferik yang believable");
  }

  const avoidParts = [
    "tampilan sinematik serba oranye, grading teal-oranye default, highlight yang mustahil, pencahayaan datar yang sintetis, dan HDR berlebihan",
    "cast warna global, split cyan/oranye default, kulit neon, hitam yang keruh, dan highlight yang ter-clip",
    "permukaan seperti CGI, pantulan palsu, penajaman berlebihan, dan bokeh sintetis"
  ];
  if (human) {
    avoidParts.push(
      "kulit seperti plastik atau lilin, simetri wajah yang sempurna, kulit yang terlalu halus, gigi yang terlalu putih, mata sintetis, pose manekin, dan jari yang mustahil"
    );
  }
  if (product) {
    avoidParts.push("produk yang melayang, pantulan yang mustahil, transparansi palsu, dan arah bayangan yang tidak realistis");
  }
  if (environment) {
    avoidParts.push("objek terkloning, arsitektur yang mustahil, pola AI yang berulang, dan simetri buatan");
  }

  const lines = [
    `Karakter fotografis: render ${style} yang believable dengan ${realismTarget}.`,
    `Kamera: ${camera} dengan ${lens} dan ${dof} — ${focus}, ${perspective}.`,
    `Cahaya: ${lighting} dari ${lightDir}, ${shadow}, ${highlight}, dan ${dynamicRange}.`,
    `Warna: ${colorResponse} dengan ${whiteBalance}.`,
    `Realisme: ${realismParts.join("; ")}. Tekstur terbaca sebagai ${texture}; gerak ${motion}; izinkan imperfeksi dunia nyata ${imperfection}.`,
    `Utamakan ${preferParts.join("; ")}.`,
    `Hindari ${avoidParts.join("; ")}.`
  ];
  return lines.join("\n");
}

function photographicCharacterNegatives(): string[] {
  return [NEGATIVE_REALISM_BLOCK.id];
}

/**
 * Karakter Finish Fotografis (P2.9). Token style / warna / cahaya / artifisialitas
 * yang sudah di-resolve, di-render lewat tabel bilingual. Untuk medium
 * non-fotografis (poster grafis / ilustrasi) hanya baris karakter warna yang
 * dirender — tanpa kosakata kamera, lensa, kulit, bokeh, atau pencahayaan
 * fotografis.
 */
function formatPhotographicFinish(blocks: PromptBlocks, opts: { detail: "full" | "brief" }): string {
  const f = blocks.photographicCharacter.finish;
  const colorChar = V.COLOR_CHARACTER[f.colorCharacter as keyof typeof V.COLOR_CHARACTER]?.id ?? V.humanizeSlug(f.colorCharacter);

  if (!f.isPhotographic) {
    return `Finish warna — ${colorChar}: jaga palet recipe tetap datar, bersih, dan terkontrol sesuai recipe grafis.`;
  }

  const style = V.FINISH_STYLE[f.style as keyof typeof V.FINISH_STYLE]?.id ?? V.humanizeSlug(f.style);
  const level = V.ARTIFICIALITY_LEVEL[f.artificiality.level as keyof typeof V.ARTIFICIALITY_LEVEL]?.id ?? f.artificiality.level;
  const lighting = f.lightingCharacter
    ? V.LIGHTING_CHARACTER[f.lightingCharacter as keyof typeof V.LIGHTING_CHARACTER]?.id ?? V.humanizeSlug(f.lightingCharacter)
    : null;

  if (opts.detail === "brief") {
    return (
      `Finish fotografis: ${style}, warna ${colorChar}${lighting ? `, ${lighting}` : ""}, ` +
      `artifisialitas ${level} (${f.artificiality.score}/100).`
    );
  }

  const cv = f.colorVocabulary;
  const wb = V.PHOTO_WHITE_BALANCE[cv.whiteBalance as keyof typeof V.PHOTO_WHITE_BALANCE]?.id ?? V.humanizeSlug(cv.whiteBalance);
  const sat = V.COLOR_SATURATION_RESTRAINT[cv.saturationRestraint as keyof typeof V.COLOR_SATURATION_RESTRAINT]?.id ?? cv.saturationRestraint;
  const con = V.COLOR_CONTRAST_CHARACTER[cv.contrastCharacter as keyof typeof V.COLOR_CONTRAST_CHARACTER]?.id ?? cv.contrastCharacter;
  const hl = V.PHOTO_HIGHLIGHT[cv.highlightRolloff as keyof typeof V.PHOTO_HIGHLIGHT]?.id ?? V.humanizeSlug(cv.highlightRolloff);
  const sd = V.SHADOW_DENSITY[cv.shadowDensity as keyof typeof V.SHADOW_DENSITY]?.id ?? cv.shadowDensity;
  const sep = V.COLOR_SEPARATION[cv.colorSeparation as keyof typeof V.COLOR_SEPARATION]?.id ?? cv.colorSeparation;
  const guidance = V.ARTIFICIALITY_GUIDANCE[f.artificiality.level as keyof typeof V.ARTIFICIALITY_GUIDANCE]?.id ?? "";
  const notes = f.realismNotes.map((k) => V.REALISM_NOTE[k as keyof typeof V.REALISM_NOTE]?.id ?? V.humanizeSlug(k));

  const lines = [
    `Finish fotografis — style ${style}.`,
    `Karakter warna: ${colorChar} — ${wb}, ${sat}, ${con}, ${hl}, ${sd}, ${sep}.`,
    ...(lighting ? [`Karakter cahaya: ${lighting}.`] : []),
    `Artifisialitas: ${level} · ${f.artificiality.score}/100 — ${guidance}.`,
    ...(notes.length > 0 ? [`Catatan realisme: ${notes.join("; ")}.`] : [])
  ];
  return lines.join("\n");
}

/**
 * Visual Generation Adapter (P2.7). The adapter selection is language-neutral
 * (identical to the English prompt); only the wording differs — taken from the
 * adapter vocabulary's own `.id` phrasings. The raw adapter id is never
 * printed. Graphic-poster / illustration carry no photographic vocabulary.
 */
function formatVisualGeneration(
  blocks: PromptBlocks,
  opts: { tier: "master" | "quick" | "image" | "layout" }
): string {
  const vg = blocks.visualGeneration;
  const v = vg.rendering;
  // The human-facing label, never the raw hyphenated id.
  const label = VISUAL_ADAPTER_LABEL[vg.adapterId]?.id ?? V.humanizeSlug(vg.adapterId);

  if (opts.tier === "quick") {
    return `Karakter visual — ${label}: ${v.camera_language.id}; ${v.realism_language.id}.`;
  }

  if (opts.tier === "layout") {
    return (
      `Karakter medium visual — ${label}: ${v.composition_language.id}. ` +
      `${ensureSentence(capitalize(v.rendering_language.id))}`
    );
  }

  const lines = [
    `Karakter visual generation — ${label}:`,
    `Sudut pandang: ${v.camera_language.id}.`,
    `Cahaya: ${v.lighting_language.id}.`,
    `Permukaan & material: ${v.surface_or_material_language.id}.`,
    ...(opts.tier === "master" ? [`Karakter komposisi: ${v.composition_language.id}.`] : []),
    `Rendering: ${v.realism_language.id}; ${v.rendering_language.id}.`,
    `Gerak: ${v.motion_language.id}.`,
    ...(opts.tier === "master" ? [`Hindari ${v.avoid_language.id}.`] : [])
  ];
  return lines.join("\n");
}

function visualGenerationNegatives(blocks: PromptBlocks): string[] {
  return [blocks.visualGeneration.rendering.avoid_language.id];
}

/** `shapeLogic`/`rhythm` are English dataset prose with no structured equivalent — omitted rather than left untranslated. */
function formatGraphicElements(blocks: PromptBlocks): string {
  const { graphicElements } = blocks;
  return `Bahasa grafis: tingkat ornamen ${pct(graphicElements.ornament)}.`;
}

/**
 * Every device is already natural-language production instruction, authored
 * bilingually in engine/graphic-treatment/data.ts (`prompt_id` here) — this
 * never dumps a raw device id (doctrine §18).
 */
function formatGraphicTreatment(blocks: PromptBlocks, opts: { visualOnly: boolean }): string | null {
  const gt = blocks.graphicTreatment;
  const groups: { label: string; devices: readonly GraphicDeviceBlockEntry[] }[] = [
    { label: V.GRAPHIC_DEVICE_CATEGORY.structural.id, devices: gt.structuralDevices },
    { label: V.GRAPHIC_DEVICE_CATEGORY.expressive.id, devices: gt.expressiveDevices },
    { label: V.GRAPHIC_DEVICE_CATEGORY.image_treatment.id, devices: gt.imageTreatments },
    ...(opts.visualOnly
      ? []
      : [{ label: V.GRAPHIC_DEVICE_CATEGORY.typography_treatment.id, devices: gt.typographyTreatments }]),
    { label: V.GRAPHIC_DEVICE_CATEGORY.texture.id, devices: gt.textures },
    { label: V.GRAPHIC_DEVICE_CATEGORY.pattern.id, devices: gt.patterns },
    { label: V.GRAPHIC_DEVICE_CATEGORY.layering.id, devices: gt.layering },
    { label: V.GRAPHIC_DEVICE_CATEGORY.accent.id, devices: gt.accents }
  ].filter((group) => group.devices.length > 0);

  if (groups.length === 0) return null;

  const intensityLabel =
    V.GRAPHIC_TREATMENT_INTENSITY[gt.intensity as keyof typeof V.GRAPHIC_TREATMENT_INTENSITY]?.id ?? gt.intensity;
  const lines = groups.map((group) => `${group.label}: ${group.devices.map((d) => d.promptId).join(" ")}`);
  return `Perlakuan grafis (${intensityLabel}):\n${lines.join("\n")}`;
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
  if (total === 0) return ["dekorasi grafis acak atau tanpa alasan yang jelas"];
  if (gt.intensity === "expressive" || gt.intensity === "experimental") {
    return ["kolase yang tidak terkendali atau aksen grafis yang saling bersaing di luar yang telah ditentukan di atas"];
  }
  return [];
}

/** `corePrinciples`/`antiStereotype` are English movement-dataset prose — omitted; the movement name and dimension ownership are kept. */
function formatCulture(blocks: PromptBlocks): string {
  const { culture } = blocks;
  const dims = culture.dimensions
    .map(
      (d) =>
        `${V.DIMENSION[d.dimension as keyof typeof V.DIMENSION]?.id ?? V.humanizeSlug(d.dimension)} dipimpin oleh ${
          d.countryName
        }${d.contested ? " (masih diperdebatkan)" : ""}`
    )
    .join("; ");
  return `Budaya & pengaruh negara: ${dims}. Berpijak pada prinsip inti gerakan ${culture.movementName}.`;
}

/** Unique demonyms for every country carrying a dimension, in stable order. */
function culturalInfluenceNames(blocks: PromptBlocks): string[] {
  const names = new Set(blocks.culture.dimensions.map((d) => V.demonym(d.countryId, d.countryName, "id")));
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
    `Hindari kesan stereotip visual budaya ${joinAnd(names, "atau")}; sampaikan pengaruh budaya melalui ` +
    `perilaku spasial, hubungan tipografi, hubungan warna, dan materialitas.`
  );
}

function formatConstraintGroup(title: string, constraints: readonly ConstraintInfo[]): string | null {
  if (constraints.length === 0) return null;
  return `${title}:\n${constraints.map((c) => `- ${ensureSentence(c.statement)}`).join("\n")}`;
}

function formatIndustry(blocks: PromptBlocks): string | null {
  return formatConstraintGroup("Ketentuan industri", blocks.industry.constraints);
}

function formatBrand(blocks: PromptBlocks): string {
  const { brand } = blocks;
  if (!brand.present) {
    return "Brand: proyek ini tidak terikat pada brand tertentu — gunakan identitas visual generik yang tidak terikat merek.";
  }
  const fontLine = brand.secondaryFont ? `${brand.primaryFont} dengan ${brand.secondaryFont}` : brand.primaryFont;
  const palette = brand.palette.map((p) => `${p.name} (${p.hex})`).join(", ");
  const rules = brand.constraints.length > 0
    ? `\n${brand.constraints.map((c) => `- ${ensureSentence(c.statement)}`).join("\n")}`
    : "";
  return `Brand: terkunci pada tipografi ${fontLine} dan palet ${palette}. Aturan brand:${rules || " tidak ada aturan lain selain palet dan tipografi."}`;
}

function formatPlatform(blocks: PromptBlocks): string {
  const { platform } = blocks;
  const channel = V.CHANNEL[platform.channel as keyof typeof V.CHANNEL]?.id ?? V.humanizeSlug(platform.channel);
  const viewing = V.VIEWING_CONTEXT[platform.viewingContext as keyof typeof V.VIEWING_CONTEXT]?.id ?? V.humanizeSlug(platform.viewingContext);
  const lines = [
    `Ketentuan platform: ${channel}, ${aspectRatioLabel(platform.aspectRatioId)}, dilihat pada ${viewing}. ` +
      `Teks lokal pada gambar ${platform.localisedText ? "diperlukan" : "tidak diperlukan"}.`
  ];
  if (platform.constraints.length > 0) {
    lines.push(platform.constraints.map((c) => `- ${ensureSentence(c.statement)}`).join("\n"));
  }
  return lines.join("\n");
}

function formatQuality(blocks: PromptBlocks): string {
  const items = blocks.quality.requirements.map((key) => V.QUALITY_REQUIREMENT[key].id);
  return `Kebutuhan kualitas: ${joinAnd(items, "dan")}.`;
}

/**
 * Positive requirements only. `must_not`/`avoid` constraints are not dropped —
 * they, plus the universal baseline, are consolidated into one trailing
 * Hindari paragraph (`buildNegativePrompt`) instead of a second, duplicate
 * bullet list right above it.
 */
function formatConstraintsAppendix(blocks: PromptBlocks): string[] {
  const { constraints } = blocks;
  const sections: string[] = [];
  const must = formatConstraintGroup("Wajib dipenuhi", constraints.must);
  const preferred = formatConstraintGroup("Sebaiknya", constraints.prefer);
  for (const section of [must, preferred]) {
    if (section) sections.push(section);
  }
  return sections;
}

function buildNegativePrompt(blocks: PromptBlocks): string {
  const { constraints, format, textMode, objective } = blocks;
  const items: string[] = [];

  items.push(...NEGATIVE_BASELINE_KEYS.map((key) => V.NEGATIVE_BASELINE[key].id));
  items.push(`rasio aspek yang salah (harus ${aspectRatioLabel(format.aspectRatioId)})`);

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
      ? `perubahan, kesalahan ejaan, atau penambahan kata pada pesan utama ("${objective.coreMessage.trim()}")`
      : "teks placeholder atau lorem-ipsum yang dirender di zona teks yang disisakan"
  );

  return `Hindari: ${items.join("; ")}.`;
}

export function renderIndonesian(blocks: PromptBlocks): Omit<PromptSet, "language" | "guard"> {
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

  const objectiveText = V.OBJECTIVE[blocks.objective.objective as keyof typeof V.OBJECTIVE]?.id ?? V.humanizeSlug(blocks.objective.objective);
  const compositionStrategy = V.COMPOSITION_STRATEGY[blocks.composition.strategy as keyof typeof V.COMPOSITION_STRATEGY]?.id
    ?? V.humanizeSlug(blocks.composition.strategy);
  const colorStrategy = V.COLOR_STRATEGY[blocks.color.strategy as keyof typeof V.COLOR_STRATEGY]?.id ?? V.humanizeSlug(blocks.color.strategy);
  const topMust = blocks.constraints.must.slice(0, 2).map((c) => ensureSentence(c.statement));

  const quickLines = [
    `Visual ${aspectRatioLabel(blocks.format.aspectRatioId)} untuk ${V.CHANNEL[blocks.format.channel as keyof typeof V.CHANNEL]?.id ?? blocks.format.channel}, untuk ${objectiveText}${
      blocks.concept ? ` — ${blocks.concept.name}: ${blocks.concept.bigIdea}` : ""
    }`,
    `${compositionStrategy}, ${colorStrategy}, ${
      V.TYPOGRAPHY_STRATEGY[blocks.typography.strategy as keyof typeof V.TYPOGRAPHY_STRATEGY]?.id ?? blocks.typography.strategy
    }.`,
    formatVisualGeneration(blocks, { tier: "quick" }),
    ...(topMust.length > 0 ? [`Wajib: ${topMust.join(" ")}`] : []),
    `Hindari: ${V.NEGATIVE_BASELINE.generic_stock_photo.id}, ${V.NEGATIVE_BASELINE.clutter.id}, ${V.NEGATIVE_BASELINE.weak_hierarchy.id}.`
  ];

  const adapterId = blocks.visualGeneration.adapterId;
  const adapterLabel = VISUAL_ADAPTER_LABEL[adapterId]?.id ?? V.humanizeSlug(adapterId);
  const realismTargetLabel = capitalize(
    V.PHOTO_REALISM_TARGET[blocks.visualGeneration.realismTarget as keyof typeof V.PHOTO_REALISM_TARGET]?.id
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
      description: visualAdapterSummary(adapterId, "id")
    }
  };
}
