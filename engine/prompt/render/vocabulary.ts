/**
 * Bilingual phrase tables for every closed enum a prompt renderer needs.
 *
 * Kept in one file, separate from the two renderers, so a translation can be
 * reviewed and corrected without touching assembly logic. Established design
 * terminology (grid, editorial, whitespace, contrast, Bauhaus, etc.) is kept
 * in English on the Indonesian side rather than forced into an awkward
 * translation — see docs/prompt-compiler.md.
 */

export type Bilingual = { readonly en: string; readonly id: string };

function table<K extends string>(entries: Record<K, Bilingual>): Record<K, Bilingual> {
  return entries;
}

export const OBJECTIVE = table({
  awareness: { en: "building awareness", id: "membangun awareness" },
  consideration: { en: "building consideration", id: "mendorong pertimbangan (consideration)" },
  conversion: { en: "driving conversion", id: "mendorong konversi" },
  launch: { en: "a launch", id: "peluncuran (launch)" },
  promotion: { en: "a promotion", id: "promosi" },
  education: { en: "education", id: "edukasi" },
  trust: { en: "building trust", id: "membangun kepercayaan" },
  "brand-building": { en: "brand building", id: "membangun citra merek" },
  recruitment: { en: "recruitment", id: "rekrutmen" },
  event: { en: "an event", id: "sebuah acara" }
});

export const COMPOSITION_STRATEGY = table({
  "modular-grid": { en: "a modular grid composition", id: "komposisi grid modular" },
  "asymmetric-editorial": { en: "an asymmetric editorial composition", id: "komposisi editorial asimetris" },
  "centred-frontal": { en: "a centred, frontal composition", id: "komposisi frontal yang terpusat" },
  "full-bleed-focal": { en: "a full-bleed focal composition", id: "komposisi full-bleed dengan satu titik fokus" },
  "stacked-vertical": { en: "a stacked vertical composition", id: "komposisi vertikal bertumpuk" }
});

export const BALANCE = table({
  symmetric: { en: "symmetric", id: "simetris" },
  asymmetric: { en: "asymmetric", id: "asimetris" },
  mixed: { en: "mixed", id: "campuran" }
});

export const FLOW = table({
  "z-pattern": { en: "a Z-pattern", id: "pola Z (Z-pattern)" },
  "f-pattern": { en: "an F-pattern", id: "pola F (F-pattern)" },
  "centre-out": { en: "a centre-outward", id: "dari tengah ke luar" },
  "top-down": { en: "a top-down", id: "dari atas ke bawah" },
  diagonal: { en: "a diagonal", id: "diagonal" }
});

export const TYPOGRAPHY_STRATEGY = table({
  "neutral-system": { en: "a neutral system-typeface approach", id: "pendekatan tipografi sistem yang netral" },
  "editorial-contrast": { en: "editorial-contrast typography", id: "tipografi dengan kontras bergaya editorial" },
  "display-dominant": { en: "display-dominant typography", id: "tipografi display yang dominan" },
  "structural-mono": { en: "structural monospace typography", id: "tipografi monospace yang struktural" }
});

export const CASE_BIAS = table({
  lower: { en: "lowercase", id: "huruf kecil (lowercase)" },
  sentence: { en: "sentence case", id: "sentence case" },
  title: { en: "title case", id: "title case" },
  upper: { en: "uppercase", id: "huruf kapital (uppercase)" },
  mixed: { en: "mixed case", id: "case campuran" }
});

export const WEIGHT_BIAS = table({
  light: { en: "light", id: "ringan (light)" },
  regular: { en: "regular", id: "reguler" },
  medium: { en: "medium", id: "medium" },
  bold: { en: "bold", id: "tebal (bold)" },
  mixed: { en: "mixed weight", id: "ketebalan campuran" }
});

export const COLOR_STRATEGY = table({
  "monochrome-structural": { en: "a structural monochrome palette", id: "palet monokrom yang struktural" },
  "restrained-neutral": { en: "a restrained neutral palette", id: "palet netral yang terkendali" },
  "single-accent": { en: "a single-accent palette", id: "palet dengan satu warna aksen" },
  "duotone-editorial": { en: "a duotone editorial palette", id: "palet duotone bergaya editorial" },
  "high-chroma-vernacular": { en: "a high-chroma vernacular palette", id: "palet vernakular dengan saturasi tinggi" }
});

export const ZONE = table({
  hero: { en: "hero", id: "hero" },
  headline: { en: "headline", id: "headline" },
  body: { en: "body copy", id: "teks body" },
  product: { en: "product", id: "produk" },
  image: { en: "image", id: "gambar" },
  offer: { en: "offer", id: "penawaran" },
  data: { en: "data", id: "data" },
  cta: { en: "call-to-action", id: "call-to-action (CTA)" },
  brand: { en: "brand mark", id: "identitas merek" },
  navigation: { en: "navigation", id: "navigasi" },
  footer: { en: "footer", id: "footer" }
});

export const EMOTIONAL_DIRECTION = table({
  calm: { en: "calm", id: "tenang" },
  warm: { en: "warm", id: "hangat" },
  urgent: { en: "urgent", id: "mendesak" },
  confident: { en: "confident", id: "percaya diri" },
  playful: { en: "playful", id: "playful/ceria" },
  reverent: { en: "reverent", id: "khidmat" },
  curious: { en: "curious", id: "menimbulkan rasa ingin tahu" },
  austere: { en: "austere", id: "austere, tegas dan minim dekorasi" }
});

export const SUBJECT_STRATEGY = table({
  "product-as-subject": { en: "the product as the subject", id: "produk sebagai subjek utama" },
  "person-as-subject": { en: "a person as the subject", id: "sosok orang sebagai subjek utama" },
  "place-as-subject": { en: "the place as the subject", id: "tempat sebagai subjek utama" },
  "typography-as-subject": { en: "typography as the subject", id: "tipografi sebagai subjek utama" },
  "material-as-subject": { en: "material as the subject", id: "material/tekstur sebagai subjek utama" },
  "process-as-subject": { en: "the process as the subject", id: "proses sebagai subjek utama" },
  "absence-as-subject": { en: "negative space as the subject", id: "ruang kosong sebagai subjek utama" }
});

export const HUMAN_PRESENCE = table({
  none: { en: "no human figures", id: "tanpa figur manusia" },
  implied: { en: "an implied human presence", id: "kehadiran manusia yang tersirat" },
  partial: { en: "a partial human presence", id: "kehadiran manusia sebagian" },
  central: { en: "a central human figure", id: "figur manusia sebagai pusat perhatian" },
  crowd: { en: "a crowd", id: "sekelompok orang" }
});

export const ABSTRACTION_LEVEL = table({
  literal: { en: "literal", id: "literal" },
  stylised: { en: "stylised", id: "stilasi (stylised)" },
  symbolic: { en: "symbolic", id: "simbolik" },
  abstract: { en: "abstract", id: "abstrak" }
});

export const CHANNEL = table({
  "instagram-feed": { en: "Instagram feed", id: "feed Instagram" },
  "instagram-story": { en: "Instagram Story/Reels", id: "Story/Reels Instagram" },
  tiktok: { en: "TikTok", id: "TikTok" },
  "facebook-feed": { en: "Facebook feed", id: "feed Facebook" },
  "linkedin-feed": { en: "LinkedIn feed", id: "feed LinkedIn" },
  web: { en: "web", id: "web" },
  print: { en: "print", id: "cetak" },
  ooh: { en: "out-of-home", id: "media luar ruang (OOH)" }
});

export const VIEWING_CONTEXT = table({
  thumb: { en: "thumbnail size while scrolling quickly", id: "ukuran thumbnail sambil scroll cepat" },
  arm: { en: "arm's length on a phone screen", id: "jarak lengan di layar ponsel" },
  room: { en: "across a room", id: "dari seberang ruangan" },
  street: { en: "from the street", id: "dari jalan" }
});

export const DIMENSION = table({
  composition: { en: "composition", id: "komposisi" },
  typography: { en: "typography", id: "tipografi" },
  color: { en: "color", id: "warna" },
  imagery: { en: "imagery", id: "imagery" },
  materiality: { en: "materiality", id: "materialitas" },
  graphic_language: { en: "graphic language", id: "bahasa grafis" }
});

export const GRAPHIC_TREATMENT_INTENSITY = table({
  none: { en: "none", id: "tanpa treatment grafis" },
  minimal: { en: "minimal", id: "minimal" },
  moderate: { en: "moderate", id: "moderat" },
  expressive: { en: "expressive", id: "ekspresif" },
  experimental: { en: "experimental", id: "eksperimental" }
});

export const GRAPHIC_DEVICE_CATEGORY = table({
  structural: { en: "Structural", id: "Struktural" },
  expressive: { en: "Expressive", id: "Ekspresif" },
  image_treatment: { en: "Image treatment", id: "Perlakuan gambar" },
  typography_treatment: { en: "Typography treatment", id: "Perlakuan tipografi" },
  texture: { en: "Texture", id: "Tekstur" },
  pattern: { en: "Pattern", id: "Pola" },
  layering: { en: "Layering", id: "Layering" },
  accent: { en: "Graphic accent", id: "Aksen grafis" }
});

// --- P2.6: Photographic Character ------------------------------------------
// Bilingual phrasing for every closed enum the Photographic Character renderer
// emits. The RESOLVED values (types/schemas/photographic-character.schema.ts)
// are identical across languages; only the wording below differs.

export const PHOTO_STYLE = table({
  "natural-editorial": { en: "natural editorial photography", id: "fotografi editorial yang natural" },
  "commercial-editorial": { en: "commercial editorial photography", id: "fotografi editorial komersial" },
  documentary: { en: "documentary photography", id: "fotografi dokumenter" },
  lifestyle: { en: "lifestyle photography", id: "fotografi lifestyle" },
  "fashion-editorial": { en: "fashion editorial photography", id: "fotografi editorial fashion" },
  "product-studio": { en: "controlled studio product photography", id: "fotografi produk studio yang terkontrol" },
  "cinematic-natural": { en: "cinematic natural photography", id: "fotografi natural yang sinematik" },
  "graphic-photographic": { en: "photography used as a graphic element", id: "fotografi yang dipakai sebagai elemen grafis" },
  "raw-documentary": { en: "raw, unpolished documentary photography", id: "fotografi dokumenter yang mentah" },
  "clean-commercial": { en: "clean commercial photography", id: "fotografi komersial yang bersih" },
  "surreal-photographic": { en: "surreal photographic imagery", id: "citra fotografis yang surealis" },
  "mixed-media-photographic": { en: "mixed-media photographic imagery", id: "citra fotografis mixed-media" }
});

export const PHOTO_REALISM_TARGET = table({
  "photoreal-refined": { en: "refined photorealism", id: "fotorealisme yang halus" },
  "photoreal-natural": { en: "natural, believable photorealism", id: "fotorealisme yang natural dan believable" },
  "stylised-photographic": { en: "a stylised photographic look", id: "tampilan fotografis yang distilasi" },
  "graphic-non-photographic": { en: "a graphic, non-photographic look", id: "tampilan grafis yang non-fotografis" }
});

export const PHOTO_CAMERA = table({
  "full-frame-natural": { en: "a full-frame natural camera response", id: "respons kamera full-frame yang natural" },
  "full-frame-editorial": { en: "a full-frame editorial camera response", id: "respons kamera full-frame bergaya editorial" },
  "medium-format-clean": { en: "a clean medium-format camera response", id: "respons kamera medium-format yang bersih" },
  "close-range-documentary": { en: "a close-range documentary camera response", id: "respons kamera dokumenter jarak dekat" },
  "studio-commercial": { en: "a controlled studio-commercial camera response", id: "respons kamera studio-komersial yang terkontrol" },
  "environmental-wide": { en: "a wide environmental camera response", id: "respons kamera lebar yang environmental" }
});

export const PHOTO_LENS = table({
  "35mm-environmental": { en: "a 35mm environmental perspective", id: "perspektif environmental 35mm" },
  "50mm-natural-perspective": { en: "a 50mm natural perspective", id: "perspektif natural 50mm" },
  "85mm-portrait-compression": { en: "an 85mm portrait compression", id: "kompresi potret 85mm" },
  "100mm-macro-product": { en: "a 100mm macro product perspective", id: "perspektif makro produk 100mm" },
  "wide-editorial-perspective": { en: "a wide editorial perspective", id: "perspektif editorial yang lebar" }
});

export const PHOTO_DOF = table({
  "deep-natural": { en: "deep natural depth of field", id: "depth of field yang dalam dan natural" },
  "moderate-optical": { en: "moderate optical depth of field", id: "depth of field optis yang moderat" },
  "shallow-optical": { en: "shallow optical depth of field", id: "depth of field optis yang dangkal" },
  "selective-focus": { en: "selective focus", id: "fokus selektif" }
});

export const PHOTO_FOCUS = table({
  "sharp-throughout": { en: "sharp throughout", id: "tajam menyeluruh" },
  "subject-critical-focus": { en: "critical focus on the subject", id: "fokus kritis pada subjek" },
  "plane-of-focus-selective": { en: "a selective plane of focus", id: "bidang fokus yang selektif" },
  "soft-overall": { en: "a soft overall focus", id: "fokus keseluruhan yang lembut" }
});

export const PHOTO_PERSPECTIVE = table({
  "natural-perspective": { en: "natural perspective", id: "perspektif natural" },
  "mild-compression": { en: "mild perspective compression", id: "kompresi perspektif yang ringan" },
  "strong-compression": { en: "strong perspective compression", id: "kompresi perspektif yang kuat" },
  "wide-expansive": { en: "a wide, expansive perspective", id: "perspektif yang lebar dan luas" },
  "corrected-architectural": { en: "corrected architectural verticals", id: "garis vertikal arsitektur yang dikoreksi" }
});

export const PHOTO_LIGHTING = table({
  "available-daylight": { en: "available daylight", id: "cahaya siang yang tersedia (available light)" },
  "window-light": { en: "soft window light", id: "cahaya jendela yang lembut" },
  "soft-directional": { en: "soft directional light", id: "cahaya terarah yang lembut" },
  "controlled-studio": { en: "controlled studio light", id: "cahaya studio yang terkontrol" },
  "mixed-natural": { en: "mixed natural light", id: "campuran cahaya natural" },
  "hard-sun": { en: "hard direct sun", id: "sinar matahari langsung yang keras" },
  "overcast-natural": { en: "soft overcast light", id: "cahaya mendung yang lembut" },
  "practical-light": { en: "in-scene practical light", id: "cahaya praktikal di dalam scene" },
  "dusk-natural": { en: "natural dusk light", id: "cahaya senja yang natural" }
});

export const PHOTO_LIGHT_DIR = table({
  "frontal-soft": { en: "a soft frontal direction", id: "arah frontal yang lembut" },
  "side-directional": { en: "a directional side angle", id: "sudut samping yang terarah" },
  "three-quarter": { en: "a three-quarter angle", id: "sudut tiga-perempat" },
  "back-rim": { en: "a back / rim direction", id: "arah belakang / rim" },
  "top-down": { en: "a top-down direction", id: "arah dari atas" },
  "ambient-wrap": { en: "an ambient wrap", id: "cahaya ambient yang membungkus" }
});

export const PHOTO_HIGHLIGHT = table({
  gentle: { en: "a gentle highlight rolloff", id: "highlight rolloff yang lembut" },
  natural: { en: "a natural highlight rolloff", id: "highlight rolloff yang natural" },
  filmic: { en: "a filmic highlight rolloff", id: "highlight rolloff bergaya film" },
  crisp: { en: "a crisp highlight rolloff", id: "highlight rolloff yang tajam" }
});

export const PHOTO_SHADOW = table({
  "soft-diffused": { en: "soft diffused shadows", id: "bayangan yang lembut dan menyebar" },
  "natural-density": { en: "natural shadow density", id: "kepekatan bayangan yang natural" },
  "defined-directional": { en: "defined directional shadows", id: "bayangan terarah yang tegas" },
  "deep-contrasty": { en: "deep, contrasty shadows", id: "bayangan yang dalam dan berkontras" }
});

export const PHOTO_COLOR_RESPONSE = table({
  "neutral-natural": { en: "a neutral, natural colour response", id: "respons warna yang netral dan natural" },
  "warm-natural": { en: "a warm, natural colour response", id: "respons warna yang hangat dan natural" },
  "restrained-commercial": { en: "a restrained commercial colour response", id: "respons warna komersial yang terkendali" },
  "editorial-neutral": { en: "an editorial-neutral colour response", id: "respons warna editorial yang netral" },
  "soft-film": { en: "a soft film colour response", id: "respons warna film yang lembut" },
  "high-fidelity-product": { en: "a high-fidelity product colour response", id: "respons warna produk dengan fidelitas tinggi" },
  "muted-documentary": { en: "a muted documentary colour response", id: "respons warna dokumenter yang muted" },
  "bold-editorial": { en: "a bold editorial colour response", id: "respons warna editorial yang berani" }
});

export const PHOTO_WHITE_BALANCE = table({
  neutral: { en: "a neutral white balance", id: "white balance yang netral" },
  "warm-ambient": { en: "a warm ambient white balance", id: "white balance ambient yang hangat" },
  "cool-daylight": { en: "a cool daylight white balance", id: "white balance daylight yang sejuk" },
  "mixed-corrected": { en: "a corrected mixed white balance", id: "white balance campuran yang dikoreksi" }
});

export const PHOTO_DYNAMIC_RANGE = table({
  restrained: { en: "a restrained dynamic range", id: "dynamic range yang terkendali" },
  natural: { en: "a natural dynamic range", id: "dynamic range yang natural" },
  extended: { en: "an extended dynamic range", id: "dynamic range yang diperluas" },
  "high-contrast": { en: "a high-contrast dynamic range", id: "dynamic range berkontras tinggi" }
});

export const PHOTO_REALISM_EMPHASIS = table({
  "not-applicable": { en: "not applicable", id: "tidak berlaku" },
  stylised: { en: "stylised", id: "distilasi" },
  naturalistic: { en: "naturalistic", id: "naturalistik" },
  "detailed-naturalistic": { en: "detailed and naturalistic", id: "detail dan naturalistik" }
});

export const PHOTO_TEXTURE = table({
  clean: { en: "a clean surface", id: "permukaan yang bersih" },
  "subtle-grain": { en: "subtle grain", id: "grain yang halus" },
  "natural-texture": { en: "natural texture", id: "tekstur yang natural" },
  "tactile-pronounced": { en: "pronounced tactile texture", id: "tekstur taktil yang menonjol" }
});

export const PHOTO_MOTION = table({
  static: { en: "static", id: "statis" },
  "subtle-implied-motion": { en: "a subtle sense of implied motion", id: "kesan gerak yang tersirat dan halus" },
  "natural-motion": { en: "natural motion", id: "gerak yang natural" },
  "dynamic-motion": { en: "dynamic motion", id: "gerak yang dinamis" }
});

export const PHOTO_IMPERFECTION = table({
  none: { en: "no", id: "tanpa" },
  subtle: { en: "subtle", id: "yang halus" },
  natural: { en: "natural", id: "yang natural" },
  expressive: { en: "expressive", id: "yang ekspresif" }
});

// --- Photographic Finish (P2.9) ---------------------------------------------
// The RESOLVED tokens (types/schemas/photographic-finish.schema.ts) are identical
// across languages; only the wording below differs. Authored in Indonesian, not
// machine-translated.

export const FINISH_STYLE = table({
  photorealistic: { en: "photorealistic", id: "fotorealistik" },
  "fashion-editorial": { en: "fashion editorial", id: "editorial fashion" },
  "product-photography": { en: "product photography", id: "fotografi produk" },
  cinematic: { en: "cinematic", id: "sinematik" },
  documentary: { en: "documentary", id: "dokumenter" },
  "graphic-poster": { en: "graphic poster", id: "poster grafis" },
  illustration: { en: "illustration", id: "ilustrasi" }
});

export const COLOR_CHARACTER = table({
  "natural-neutral": { en: "natural neutral", id: "natural netral" },
  "natural-warm": { en: "natural warm", id: "natural hangat" },
  "natural-cool": { en: "natural cool", id: "natural sejuk" },
  "editorial-neutral": { en: "editorial neutral", id: "editorial netral" },
  "muted-film": { en: "muted film", id: "film yang muted" },
  "soft-pastel": { en: "soft pastel", id: "pastel lembut" },
  "high-chroma-commercial": { en: "high-chroma commercial", id: "komersial ber-chroma tinggi" },
  monochrome: { en: "monochrome", id: "monokrom" },
  "restrained-commercial": { en: "restrained commercial", id: "komersial yang terkendali" }
});

export const LIGHTING_CHARACTER = table({
  "soft-window": { en: "soft window light", id: "cahaya jendela yang lembut" },
  "directional-daylight": { en: "directional daylight", id: "cahaya siang yang terarah" },
  "diffuse-daylight": { en: "diffuse daylight", id: "cahaya siang yang menyebar" },
  "controlled-studio": { en: "controlled studio light", id: "cahaya studio yang terkontrol" },
  "hard-sun": { en: "hard direct sun", id: "sinar matahari langsung yang keras" },
  "ambient-interior": { en: "ambient interior light", id: "cahaya ambient interior" },
  "cinematic-shaped": { en: "shaped cinematic light", id: "cahaya sinematik yang dibentuk" },
  "documentary-ambient": { en: "ambient documentary light", id: "cahaya ambient dokumenter" }
});

export const ARTIFICIALITY_LEVEL = table({
  low: { en: "low", id: "rendah" },
  medium: { en: "medium", id: "sedang" },
  high: { en: "high", id: "tinggi" }
});

export const ARTIFICIALITY_GUIDANCE = table({
  low: {
    en: "keep the finish strongly natural and un-retouched",
    id: "jaga finish tetap sangat natural dan tanpa retouch berlebihan"
  },
  medium: {
    en: "controlled photographic polish is acceptable, synthetic perfection is not",
    id: "poles fotografis yang terkontrol boleh, kesempurnaan sintetis tidak"
  },
  high: {
    en: "a deliberately stylised or synthetic finish is expected",
    id: "finish yang sengaja distilasi atau sintetis memang diharapkan"
  }
});

export const COLOR_SATURATION_RESTRAINT = table({
  restrained: { en: "restrained saturation", id: "saturasi yang terkendali" },
  natural: { en: "natural saturation", id: "saturasi yang natural" },
  elevated: { en: "elevated saturation", id: "saturasi yang ditinggikan" }
});

export const COLOR_CONTRAST_CHARACTER = table({
  low: { en: "low tonal contrast", id: "kontras tonal yang rendah" },
  gentle: { en: "gentle contrast", id: "kontras yang lembut" },
  moderate: { en: "moderate contrast", id: "kontras yang moderat" },
  firm: { en: "firm contrast", id: "kontras yang tegas" }
});

export const SHADOW_DENSITY = table({
  open: { en: "open shadows", id: "bayangan yang terbuka" },
  natural: { en: "natural shadow density", id: "kepekatan bayangan yang natural" },
  deep: { en: "deep shadows", id: "bayangan yang dalam" }
});

export const COLOR_SEPARATION = table({
  low: { en: "low colour separation", id: "separasi warna yang rendah" },
  moderate: { en: "moderate colour separation", id: "separasi warna yang moderat" },
  distinct: { en: "distinct colour separation", id: "separasi warna yang tegas" }
});

export const REALISM_NOTE = table({
  "highlight-rolloff": {
    en: "believable highlight rolloff and realistic shadow transitions",
    id: "highlight rolloff yang believable dan transisi bayangan yang realistis"
  },
  "controlled-sharpening": {
    en: "controlled sharpening and natural depth of field",
    id: "penajaman yang terkendali dan depth of field yang natural"
  },
  "restrained-retouching": {
    en: "restrained retouching with no plastic or wax-like skin",
    id: "retouching yang terkendali, tanpa kulit seperti plastik atau lilin"
  },
  "material-response": {
    en: "realistic material response and natural surface variation",
    id: "respons material yang realistis dan variasi permukaan yang natural"
  },
  "skin-and-face": {
    en: "realistic skin texture with subtle pores, natural facial asymmetry and believable eye reflections",
    id: "tekstur kulit yang realistis dengan pori halus, asimetri wajah yang natural, dan pantulan mata yang believable"
  },
  "hair-and-hands": {
    en: "realistic hair strands and natural hand and finger anatomy",
    id: "helai rambut yang realistis serta anatomi tangan dan jari yang natural"
  },
  "stylised-but-coherent": {
    en: "a deliberately stylised finish, with anatomy, reflections and perspective kept physically coherent",
    id: "finish yang sengaja distilasi, dengan anatomi, pantulan, dan perspektif yang tetap koheren secara fisik"
  }
});

export const ASPECT_RATIO = table({
  square: { en: "1:1 square", id: "1:1 persegi" },
  portrait: { en: "4:5 portrait", id: "4:5 potret" }
});

export const CONSTRAINT_KIND = table({
  must: { en: "Must", id: "Wajib" },
  must_not: { en: "Must not", id: "Tidak boleh" },
  prefer: { en: "Prefer", id: "Sebaiknya" },
  avoid: { en: "Avoid", id: "Hindari" }
});

export const QUALITY_REQUIREMENT = table({
  production_value: {
    en: "professional, production-ready visual quality",
    id: "kualitas visual profesional yang siap produksi"
  },
  hierarchy_clarity: {
    en: "a clear, unambiguous visual hierarchy",
    id: "hierarki visual yang jelas dan tidak ambigu"
  },
  single_composition: {
    en: "one coherent composition, not a collage of unrelated elements",
    id: "satu komposisi yang koheren, bukan kolase elemen yang tidak berhubungan"
  },
  resolution_ready: {
    en: "sharp, high-resolution output suitable for the target platform",
    id: "hasil tajam dan beresolusi tinggi, sesuai untuk platform tujuan"
  }
});

export const NEGATIVE_BASELINE = table({
  generic_stock_photo: { en: "generic stock-photo aesthetic", id: "kesan generic stock-photo" },
  clutter: { en: "visual clutter", id: "tampilan yang berantakan (clutter)" },
  weak_hierarchy: { en: "weak or competing visual hierarchy", id: "hierarki visual yang lemah atau saling bersaing" },
  excessive_decoration: { en: "excessive decoration or ornament", id: "dekorasi atau ornamen yang berlebihan" },
  wrong_aspect_ratio: { en: "wrong aspect ratio or cropping", id: "rasio aspek atau pemotongan gambar yang salah" },
  unwanted_visual_movement: {
    en: "distracting or unintended visual movement",
    id: "gerakan visual yang mengganggu atau tidak diinginkan"
  },
  inconsistent_lighting: { en: "inconsistent or mismatched lighting", id: "pencahayaan yang tidak konsisten" },
  excessive_visual_density: { en: "excessive visual density", id: "kepadatan visual yang berlebihan" }
});

export function lookup<K extends string>(table_: Record<K, Bilingual>, key: K, language: "en" | "id"): string {
  return table_[key][language];
}

/**
 * Demonym per country id, for the compact anti-stereotype line in the
 * Negative Prompt ("Indonesian or Japanese visual shorthand" rather than
 * dumping every banned token). Countries outside this table fall back to
 * their plain name — new country data files never crash the compiler, they
 * just render slightly less idiomatically until a demonym is added here.
 */
export const COUNTRY_DEMONYM: Record<string, Bilingual> = {
  indonesia: { en: "Indonesian", id: "Indonesia" },
  japan: { en: "Japanese", id: "Jepang" },
  switzerland: { en: "Swiss", id: "Swiss" },
  "united-states": { en: "American", id: "Amerika" }
};

export function demonym(countryId: string, countryName: string, language: "en" | "id"): string {
  return COUNTRY_DEMONYM[countryId]?.[language] ?? countryName;
}

/** Fallback for open-ended strings (aspect ratio ids outside the known set, etc.). */
export function humanizeSlug(value: string): string {
  const spaced = value.replace(/[-_]+/g, " ").trim();
  return spaced.length === 0 ? spaced : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
