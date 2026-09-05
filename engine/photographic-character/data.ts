import type { PhotographicConstraint } from "../../types/schemas/photographic-character.schema";

/**
 * The Photographic Character doctrine, as data.
 *
 * A fixed, curated set of prefer/avoid statements — the same posture as
 * engine/graphic-treatment/data.ts and engine/prompt/render/vocabulary.ts:
 * reviewable in one file, never generated per recipe. The resolver picks the
 * blocks that apply to the resolved subject and lighting, in a fixed order.
 *
 * These are realism GUIDANCE for the Prompt Compiler. They never change a
 * Design Recipe value and they are not an image-generation integration.
 */

/** Always applied — the universal optical/colour/material realism floor (§8). */
export const UNIVERSAL_REALISM_DOCTRINE: readonly PhotographicConstraint[] = [
  {
    kind: "prefer",
    statement:
      "a single physically plausible light source with one consistent direction, realistic falloff and a believable highlight-to-shadow relationship"
  },
  {
    kind: "avoid",
    statement:
      "a universal orange cinematic look, default teal-and-orange grading, incompatible light sources, impossible highlights, flat synthetic lighting and excessive HDR"
  },
  {
    kind: "prefer",
    statement:
      "natural neutral surfaces, coherent white balance, restrained saturation and controlled contrast that preserves the recipe's existing palette relationships"
  },
  {
    kind: "avoid",
    statement: "a global colour cast, a default cyan/orange split, neon skin, muddy blacks and clipped highlights"
  },
  {
    kind: "prefer",
    statement:
      "believable material behaviour with realistic surface variation, realistic edge behaviour and subtle real-world imperfection"
  },
  {
    kind: "avoid",
    statement: "perfect CGI surfaces, fake reflections, excessive sharpness and synthetic bokeh"
  }
];

/** Added when a full human figure is present (§8 — people). */
export const HUMAN_REALISM_DOCTRINE: readonly PhotographicConstraint[] = [
  {
    kind: "prefer",
    statement:
      "natural facial asymmetry, believable facial proportions, realistic skin texture with subtle pores, natural eye reflections, realistic hair strands, natural hand and finger anatomy, restrained retouching, believable clothing fit and natural posture"
  },
  {
    kind: "avoid",
    statement:
      "plastic or wax-like skin, perfect facial symmetry, over-smoothed skin, unrealistically white teeth, synthetic eyes, repeated or cloned faces, mannequin posture and impossible fingers"
  }
];

/** Added when only hands / partial human presence is implied (e.g. F&B). */
export const IMPLIED_HUMAN_REALISM_DOCTRINE: readonly PhotographicConstraint[] = [
  {
    kind: "prefer",
    statement: "natural hand and finger anatomy, realistic skin texture at close range and a natural, unposed gesture"
  },
  { kind: "avoid", statement: "impossible fingers, plastic skin and a stiff, staged hand position" }
];

/** Added when a product / crafted object is the subject (§8 — products). */
export const PRODUCT_REALISM_DOCTRINE: readonly PhotographicConstraint[] = [
  {
    kind: "prefer",
    statement:
      "realistic surface variation, believable reflections, subtle material imperfections, realistic edge behaviour, physically plausible highlights, natural contact shadows and believable weight and placement"
  },
  {
    kind: "avoid",
    statement: "floating products, perfect CGI surfaces, impossible reflections, excessive sharpness, fake transparency and unrealistic shadow direction"
  }
];

/** Added when an environment / place carries the frame (§8 — environment). */
export const ENVIRONMENT_REALISM_DOCTRINE: readonly PhotographicConstraint[] = [
  {
    kind: "prefer",
    statement:
      "physically plausible depth, natural object spacing, realistic environmental variation, believable atmospheric perspective, contextual imperfection and believable foreground-to-background separation"
  },
  {
    kind: "avoid",
    statement: "cloned objects, impossible architecture, repetitive AI patterns, synthetic depth and artificial symmetry"
  }
];

/**
 * §18 — the one compact realism block the Negative Prompt adds. Verbatim,
 * deterministic, bilingual. Not a large negative-prompt dump.
 */
export const NEGATIVE_REALISM_BLOCK = {
  en:
    "plastic skin, artificial facial symmetry, wax-like surfaces, synthetic eyes, impossible hands, CGI-like material response, fake reflections, excessive HDR, over-sharpening, synthetic bokeh, inconsistent lighting, orange skin, excessive saturation, impossible perspective, cloned objects, and overly perfect repetition",
  id:
    "kulit seperti plastik, simetri wajah yang artifisial, permukaan seperti lilin, mata sintetis, tangan yang mustahil, respons material seperti CGI, pantulan palsu, HDR berlebihan, penajaman berlebihan, bokeh sintetis, pencahayaan yang tidak konsisten, kulit oranye, saturasi berlebihan, perspektif yang mustahil, objek terkloning, dan pengulangan yang terlalu sempurna"
} as const;
