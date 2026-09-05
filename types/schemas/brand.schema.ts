import { z } from "zod";
import { Id, NonEmptyText, Note, Ratio, SemVer, Slug } from "../primitives";

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a #rrggbb hex colour");

export const BrandColor = z.object({
  role: z.enum(["primary", "secondary", "accent", "neutral", "background", "text"]),
  hex: HexColor,
  name: NonEmptyText
});

/**
 * A Brand SNAPSHOT, not a reference.
 *
 * The contract stores a copy of the brand as it was on the day the project was
 * created. If the palette changes next year, last year's project must still be
 * able to explain itself. Same reasoning as pinning dataset_version.
 */
export const BrandSnapshot = z.object({
  brand_id: Id,
  schema_version: SemVer,
  name: NonEmptyText,
  snapshot_of_version: z.number().int().min(1),

  palette: z.array(BrandColor).min(1),
  typography: z.object({
    primary: NonEmptyText,
    secondary: NonEmptyText.optional(),
    fallback_class: z.enum(["serif", "sans", "slab", "mono", "display"])
  }),
  tone: z.array(NonEmptyText).min(1),
  positioning: Note.optional(),
  formality: Ratio,
  brand_rules: z.array(Note).default([]),
  prohibitions: z.array(Note).default([]),
  preferred_movements: z.array(Slug).default([])
});
export type BrandSnapshot = z.infer<typeof BrandSnapshot>;
