import type {
  AdapterPhrase,
  VisualAdapterId,
  VisualAdapterVocabulary
} from "./types";

/**
 * The compact, deterministic adapter vocabulary — P2.7.
 *
 * One reviewable table per adapter, the same posture as
 * engine/photographic-character/data.ts and engine/prompt/render/vocabulary.ts:
 * curated once, never generated per recipe. These are PHRASINGS the compiler
 * drops into a generation instruction — they add no layout, colour, movement,
 * audience or concept decision.
 *
 * For the four photographic adapters the phrasing preserves the existing
 * "believable, non-AI" goal (natural skin texture, restrained processing,
 * realistic optical behaviour). For graphic-poster and illustration the
 * phrasing deliberately carries NO photographic skin/optics/camera language —
 * those media are not photographs.
 */

/** Human-facing adapter label, bilingual. Never a raw id in a final prompt. */
export const VISUAL_ADAPTER_LABEL: Record<VisualAdapterId, AdapterPhrase> = {
  photorealistic: { en: "Photorealistic", id: "Fotorealistik" },
  "fashion-editorial": { en: "Fashion Editorial", id: "Editorial Fashion" },
  "product-photography": { en: "Product Photography", id: "Fotografi Produk" },
  cinematic: { en: "Cinematic", id: "Sinematik" },
  "graphic-poster": { en: "Graphic Poster", id: "Poster Grafis" },
  illustration: { en: "Illustration", id: "Ilustrasi" }
};

export const VISUAL_ADAPTERS: Record<VisualAdapterId, VisualAdapterVocabulary> = {
  photorealistic: {
    camera_language: {
      en: "a believable photographic camera response with natural optical behaviour",
      id: "respons kamera fotografis yang believable dengan perilaku optik yang natural"
    },
    lighting_language: {
      en: "physically plausible light with natural falloff and believable shadow transitions",
      id: "cahaya yang plausibel secara fisik dengan falloff natural dan transisi bayangan yang believable"
    },
    surface_or_material_language: {
      en: "realistic materials with natural surface variation and subtle real-world imperfection",
      id: "material yang realistis dengan variasi permukaan natural dan imperfeksi dunia nyata yang halus"
    },
    realism_language: {
      en: "natural skin texture, restrained sharpening and believable material response",
      id: "tekstur kulit yang natural, penajaman yang terkendali, dan respons material yang believable"
    },
    composition_language: {
      en: "a composed but naturalistic frame that still reads as a real photograph",
      id: "framing yang tertata namun naturalistik dan tetap terbaca sebagai foto nyata"
    },
    motion_language: {
      en: "natural, unforced motion consistent with a real exposure",
      id: "gerak yang natural dan tidak dipaksakan, konsisten dengan eksposur nyata"
    },
    rendering_language: {
      en: "restrained processing with natural highlight rolloff and realistic shadow transitions",
      id: "pemrosesan yang terkendali dengan highlight rolloff natural dan transisi bayangan yang realistis"
    },
    avoid_language: {
      en: "an over-processed, synthetic or CGI-like photographic look",
      id: "tampilan fotografis yang over-processed, sintetis, atau seperti CGI"
    }
  },

  "fashion-editorial": {
    camera_language: {
      en: "an editorial camera response with controlled perspective compression",
      id: "respons kamera editorial dengan kompresi perspektif yang terkontrol"
    },
    lighting_language: {
      en: "fashion photography lighting with intentional, controlled shaping",
      id: "pencahayaan fotografi fashion yang disengaja dan dibentuk secara terkontrol"
    },
    surface_or_material_language: {
      en: "believable skin and fabric rendering with natural texture held intact",
      id: "rendering kulit dan kain yang believable dengan tekstur natural yang terjaga"
    },
    realism_language: {
      en: "restrained retouching that keeps skin and fabric believable",
      id: "retouching yang terkendali sehingga kulit dan kain tetap believable"
    },
    composition_language: {
      en: "a deliberate editorial frame with confident negative space",
      id: "framing editorial yang disengaja dengan ruang negatif yang percaya diri"
    },
    motion_language: {
      en: "poised, held gestures with a subtle sense of movement",
      id: "gestur yang tenang dan tertahan dengan kesan gerak yang halus"
    },
    rendering_language: {
      en: "editorial-neutral tonal separation with controlled contrast",
      id: "separasi tonal editorial-netral dengan kontras yang terkontrol"
    },
    avoid_language: {
      en: "heavy retouching, plastic skin or catalogue-flat lighting",
      id: "retouching berlebihan, kulit seperti plastik, atau pencahayaan datar khas katalog"
    }
  },

  "product-photography": {
    camera_language: {
      en: "a commercial studio product camera response with precise focus behaviour",
      id: "respons kamera produk studio komersial dengan perilaku fokus yang presisi"
    },
    lighting_language: {
      en: "controlled studio lighting with managed reflections and clean falloff",
      id: "pencahayaan studio yang terkontrol dengan pantulan yang dikelola dan falloff yang bersih"
    },
    surface_or_material_language: {
      en: "accurate product surfaces with clean material separation",
      id: "permukaan produk yang akurat dengan separasi material yang bersih"
    },
    realism_language: {
      en: "true-to-life surface detail, believable reflections and natural contact shadows",
      id: "detail permukaan yang sesuai aslinya, pantulan yang believable, dan bayangan kontak yang natural"
    },
    composition_language: {
      en: "a clean, controlled product frame with deliberate staging",
      id: "framing produk yang bersih dan terkontrol dengan penataan yang disengaja"
    },
    motion_language: {
      en: "a static, settled product with believable weight and placement",
      id: "produk yang statis dan mapan dengan bobot dan penempatan yang believable"
    },
    rendering_language: {
      en: "high-fidelity colour with a crisp but natural highlight rolloff",
      id: "warna dengan fidelitas tinggi dan highlight rolloff yang tajam namun natural"
    },
    avoid_language: {
      en: "floating products, fake reflections, impossible transparency or CGI-perfect surfaces",
      id: "produk melayang, pantulan palsu, transparansi yang mustahil, atau permukaan sempurna seperti CGI"
    }
  },

  cinematic: {
    camera_language: {
      en: "a cinematic lens response with controlled perspective and framing",
      id: "respons lensa sinematik dengan perspektif dan framing yang terkontrol"
    },
    lighting_language: {
      en: "motivated directional light with controlled shadow density",
      id: "cahaya terarah yang termotivasi dengan kepekatan bayangan yang terkontrol"
    },
    surface_or_material_language: {
      en: "believable materials sitting inside natural atmospheric depth",
      id: "material yang believable di dalam kedalaman atmosferik yang natural"
    },
    realism_language: {
      en: "natural skin and material response under restrained filmic rendering",
      id: "respons kulit dan material yang natural di bawah rendering filmis yang terkendali"
    },
    composition_language: {
      en: "a widescreen, story-led frame with intentional depth staging",
      id: "framing lebar yang digerakkan narasi dengan penataan kedalaman yang disengaja"
    },
    motion_language: {
      en: "a held cinematic moment with a subtle sense of implied motion",
      id: "momen sinematik yang tertahan dengan kesan gerak tersirat yang halus"
    },
    rendering_language: {
      en: "a filmic tonal response with motivated contrast, not a default grade",
      id: "respons tonal filmis dengan kontras yang termotivasi, bukan grading default"
    },
    avoid_language: {
      en: "a universal orange cinematic look, crushed blacks or default teal-and-orange grading",
      id: "tampilan sinematik serba oranye, hitam yang tergerus, atau grading teal-oranye default"
    }
  },

  "graphic-poster": {
    camera_language: {
      en: "a direct, flat graphic viewpoint built from hard-edged shapes",
      id: "sudut pandang grafis yang lugas dan datar, dibangun dari bentuk bertepi tajam"
    },
    lighting_language: {
      en: "flat, even graphic fills with no modelled light",
      id: "bidang warna grafis yang rata tanpa pemodelan cahaya"
    },
    surface_or_material_language: {
      en: "flat, controlled graphic surfaces with hard edges",
      id: "permukaan grafis yang datar dan terkontrol dengan tepi yang tegas"
    },
    realism_language: {
      en: "hard-edged shape rendering with controlled texture or grain only where the recipe already calls for it",
      id: "rendering bentuk bertepi tajam dengan tekstur atau grain terkontrol hanya bila memang diminta recipe"
    },
    composition_language: {
      en: "print and editorial graphic structure — cropped forms, geometric blocks, framing bands, layering and visual rhythm",
      id: "struktur grafis cetak dan editorial — bentuk ter-crop, blok geometris, pita pembingkai, layering, dan ritme visual"
    },
    motion_language: {
      en: "a static, composed graphic frame",
      id: "bidang grafis yang statis dan tertata"
    },
    rendering_language: {
      en: "controlled graphic colour rendering that keeps the recipe's palette flat and clean",
      id: "rendering warna grafis yang terkontrol dan menjaga palet recipe tetap datar dan bersih"
    },
    avoid_language: {
      en: "volumetric 3D shading, blurred edge falloff or glossy gradient bloat on flat graphic elements",
      id: "pemodelan 3D volumetrik, falloff tepi yang blur, atau gradasi mengilap berlebihan pada elemen grafis datar"
    }
  },

  illustration: {
    camera_language: {
      en: "a deliberate illustrated viewpoint with a coherent drawn perspective",
      id: "sudut pandang ilustrasi yang disengaja dengan perspektif gambar yang koheren"
    },
    lighting_language: {
      en: "intentional rendered light described through value and shape, not captured light",
      id: "cahaya yang digambarkan secara sengaja melalui value dan bentuk, bukan cahaya yang terekam"
    },
    surface_or_material_language: {
      en: "an intentional surface treatment built from controlled mark-making",
      id: "perlakuan permukaan yang disengaja, dibangun dari goresan yang terkontrol"
    },
    realism_language: {
      en: "non-photographic rendering with a coherent shape language and deliberate marks",
      id: "rendering non-fotografis dengan bahasa bentuk yang koheren dan goresan yang disengaja"
    },
    composition_language: {
      en: "an illustrated composition with intentional shape hierarchy and rhythm",
      id: "komposisi ilustratif dengan hierarki bentuk dan ritme yang disengaja"
    },
    motion_language: {
      en: "movement expressed through line, gesture and shape rather than a frozen instant",
      id: "gerak yang diekspresikan lewat garis, gestur, dan bentuk, bukan lewat perekaman instan"
    },
    rendering_language: {
      en: "consistent illustrated rendering that keeps the recipe's palette and contrast intact",
      id: "rendering ilustrasi yang konsisten dan menjaga palet serta kontras recipe tetap utuh"
    },
    avoid_language: {
      en: "literal realistic surface detail, blurred edge falloff or a plastic 3D-render look",
      id: "detail permukaan yang realistis dan literal, falloff tepi yang blur, atau kesan render 3D seperti plastik"
    }
  }
};

function cap(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * A compact, human-readable description of how an adapter renders — for the
 * read-only "Visual Generation" panel and the Prompt section's metadata line.
 * Two phrases only; never the full block.
 */
export function visualAdapterSummary(id: VisualAdapterId, language: "en" | "id"): string {
  const v = VISUAL_ADAPTERS[id];
  return `${cap(v.camera_language[language])}. ${cap(v.rendering_language[language])}.`;
}
