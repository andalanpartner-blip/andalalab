import type { DatasetRegistry } from "../../types/datasets";

/**
 * Nine visual layout templates (presentation presets).
 *
 * These are NOT new taxonomy — every template points at a canonical layout id
 * that already exists in `data/layouts/`. They are a curated, designer-facing
 * way to explore the existing layout grammar: a name, a one-line description
 * and a deterministic structural schematic. Selecting one re-derives the
 * design through the existing Recipe → Blueprint → Prompt chain (see
 * `engine/layout/retarget.ts`); the template itself never becomes the blueprint.
 *
 * Compatibility ("Available" vs "Not ideal for this format") is read straight
 * off the canonical layout's `suitable_visual_types` — no hardcoded claims.
 */

export type SchematicBlock =
  | "image"
  | "headline"
  | "body"
  | "cta"
  | "brand"
  | "offer"
  | "product"
  | "scene"
  // extra roles used by the visual-direction schematics (same renderer)
  | "caption"
  | "shape"
  | "silhouette"
  | "material"
  | "fragment"
  | "void";

export type SchematicNode =
  | { readonly block: SchematicBlock; readonly grow: number; readonly label?: string }
  | { readonly dir: "row" | "col"; readonly grow: number; readonly children: readonly SchematicNode[] };

export type LayoutTemplate = {
  /** Stable slug, e.g. "hero-dominant". */
  readonly id: string;
  /** Display index "01".."09". */
  readonly index: string;
  readonly name: string;
  /** The canonical layout id in `data/layouts/` this template presents. */
  readonly canonicalLayoutId: string;
  readonly description: string;
  /** Deterministic structural schematic — blocks only, never imagery. */
  readonly schematic: SchematicNode;
};

const leaf = (block: SchematicBlock, grow = 1, label?: string): SchematicNode =>
  label === undefined ? { block, grow } : { block, grow, label };
const col = (grow: number, ...children: SchematicNode[]): SchematicNode => ({ dir: "col", grow, children });
const row = (grow: number, ...children: SchematicNode[]): SchematicNode => ({ dir: "row", grow, children });

/**
 * The nine templates, in order. Each `canonicalLayoutId` is verified against
 * the dataset by `tests/unit/layout-templates.test.ts`.
 *
 * Mapping rationale (canonical layout → why this template):
 *   01 hero-visual          — a single dominant image carrying the surface
 *   02 headline-dominant    — type carries the surface, image reduced
 *   03 image-text-split     — a clean image field beside a clean type field
 *   04 web-hero-centered    — one centred proposition with the action beneath
 *   05 print-editorial-page — an editorial page: image + headline, info block, footer
 *   06 typographic          — composition built entirely from type, rules, fields
 *   07 web-hero-split       — a proposition + action beside a supporting product image
 *   08 story-stack          — a decisive statement over a field, action pinned below
 *   09 story-fullbleed      — sequential full-frame scenes
 * (`ooh-single-statement` is intentionally not mapped: it is out-of-home only,
 *  an uncommon visual type; such a brief sees the nine schematics for
 *  exploration, all marked "not ideal for this format".)
 */
export const LAYOUT_TEMPLATES: readonly LayoutTemplate[] = Object.freeze([
  {
    id: "hero-dominant",
    index: "01",
    name: "Hero Dominant",
    canonicalLayoutId: "hero-visual",
    description: "A single dominant image carries the surface; the headline and action sit quietly beneath it.",
    schematic: col(1, leaf("image", 6), leaf("headline", 1.4), leaf("cta", 1.1))
  },
  {
    id: "headline-dominant",
    index: "02",
    name: "Headline Dominant",
    canonicalLayoutId: "headline-dominant",
    description: "Type carries the whole surface — a short, decisive headline with imagery reduced to a supporting fragment.",
    schematic: col(1, leaf("headline", 2), leaf("headline", 1.6), row(2, leaf("image", 1), leaf("body", 1)))
  },
  {
    id: "image-text-split",
    index: "03",
    name: "Image + Text Split",
    canonicalLayoutId: "image-text-split",
    description: "The surface divides into a clean image field and a clean type field — the safest structure for information that must survive at small scale.",
    schematic: row(1, leaf("image", 1.3), col(1, leaf("headline", 1), leaf("body", 1.4), leaf("cta", 0.9)))
  },
  {
    id: "centered-hero",
    index: "04",
    name: "Centered Hero",
    canonicalLayoutId: "web-hero-centered",
    description: "One centred proposition over a quiet field, with the primary action directly beneath it.",
    schematic: col(1, leaf("headline", 1.3), leaf("image", 3), leaf("cta", 1))
  },
  {
    id: "editorial-grid",
    index: "05",
    name: "Editorial Grid",
    canonicalLayoutId: "print-editorial-page",
    description: "An editorial page: a dominant image and headline, a disciplined information block, and the brand mark in the footer.",
    schematic: col(
      1,
      row(2, leaf("image", 1.4), leaf("body", 1)),
      row(2, leaf("body", 1), leaf("image", 1.6)),
      row(1.6, leaf("image", 1.8), leaf("cta", 1))
    )
  },
  {
    id: "typographic-poster",
    index: "06",
    name: "Typographic Poster",
    canonicalLayoutId: "typographic",
    description: "No photography at all — the composition is built from type, rules and fields, with meaning carried by scale and spacing.",
    schematic: col(1, leaf("headline", 5, "Big headline"), leaf("body", 1.4, "Small supporting information"))
  },
  {
    id: "product-hero",
    index: "07",
    name: "Product Hero",
    canonicalLayoutId: "web-hero-split",
    description: "The product holds the centre between a headline above and an offer or action below.",
    schematic: col(1, leaf("headline", 1.2), leaf("product", 3.4), leaf("offer", 1.2))
  },
  {
    id: "problem-solution",
    index: "08",
    name: "Problem → Solution",
    canonicalLayoutId: "story-stack",
    description: "A vertical narrative — the problem stated, the solution shown, one action pinned below.",
    schematic: col(1, leaf("headline", 1.6, "Problem"), leaf("image", 3, "Solution"), leaf("cta", 1))
  },
  {
    id: "storytelling",
    index: "09",
    name: "Storytelling",
    canonicalLayoutId: "story-fullbleed",
    description: "Sequential full-frame scenes that carry a short narrative one beat at a time.",
    schematic: col(1, leaf("scene", 1, "Scene 01"), leaf("scene", 1, "Scene 02"), leaf("scene", 1, "Scene 03"))
  }
] as const);

export type TemplateAvailability = {
  readonly status: "available" | "not-ideal";
  readonly reason: string;
};

/** Read compatibility straight off the canonical layout's declared visual types. */
export function templateAvailability(
  datasets: DatasetRegistry,
  template: LayoutTemplate,
  visualTypeId: string
): TemplateAvailability {
  const layout = datasets.layouts.get(template.canonicalLayoutId);
  if (!layout) {
    return { status: "not-ideal", reason: `Layout "${template.canonicalLayoutId}" is not in dataset ${datasets.version}.` };
  }
  if (layout.suitable_visual_types.includes(visualTypeId)) {
    return { status: "available", reason: `${layout.name} is a declared fit for this format.` };
  }
  const fits = layout.suitable_visual_types.join(", ");
  return {
    status: "not-ideal",
    reason: `${layout.name} is intended for ${fits} — not this format. Switching would carry structural risk.`
  };
}

/** The template that presents a given canonical layout id, if any. */
export function templateForLayout(layoutId: string): LayoutTemplate | null {
  return LAYOUT_TEMPLATES.find((template) => template.canonicalLayoutId === layoutId) ?? null;
}

export type LayoutTemplateOverview = {
  /** The canonical layout the current recipe holds. */
  readonly currentLayoutId: string;
  readonly currentLayoutName: string;
  /** The template presenting the current layout (the default recommendation), if any. */
  readonly recommendedTemplateId: string | null;
  readonly recommendedTemplateName: string | null;
  readonly templates: ReadonlyArray<{
    readonly templateId: string;
    readonly canonicalLayoutId: string;
    readonly canonicalLayoutName: string;
    readonly status: "available" | "not-ideal";
    readonly reason: string;
  }>;
};

/**
 * The full template picture for a design — computed on the server from the real
 * dataset so the client never needs the dataset loader. Availability per
 * template is `templateAvailability`; the recommendation is the template that
 * presents the layout the recipe already holds.
 */
export function layoutTemplateOverview(
  datasets: DatasetRegistry,
  visualTypeId: string,
  currentLayoutId: string
): LayoutTemplateOverview {
  const current = datasets.layouts.get(currentLayoutId);
  const recommended = templateForLayout(currentLayoutId);
  return {
    currentLayoutId,
    currentLayoutName: current?.name ?? currentLayoutId,
    recommendedTemplateId: recommended?.id ?? null,
    recommendedTemplateName: recommended?.name ?? null,
    templates: LAYOUT_TEMPLATES.map((template) => {
      const avail = templateAvailability(datasets, template, visualTypeId);
      const layout = datasets.layouts.get(template.canonicalLayoutId);
      return {
        templateId: template.id,
        canonicalLayoutId: template.canonicalLayoutId,
        canonicalLayoutName: layout?.name ?? template.canonicalLayoutId,
        status: avail.status,
        reason: avail.reason
      };
    })
  };
}

export function templateById(id: string): LayoutTemplate | null {
  return LAYOUT_TEMPLATES.find((template) => template.id === id) ?? null;
}
