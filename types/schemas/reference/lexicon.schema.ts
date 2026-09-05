import { z } from "zod";
import { NonEmptyText, SemVer, Slug } from "../../primitives";

/**
 * Language lexicons, versioned as data.
 *
 * The generic-phrase list, the vagueness vocabulary and the styling vocabulary
 * are all judgement calls that will need tuning as real concepts arrive. Keeping
 * them in the dataset rather than in code means tuning them is a data edit with
 * a version bump, reviewable in a diff, and not a deploy.
 */
export const ConceptLexicon = z.object({
  id: Slug,
  schema_version: SemVer,
  name: NonEmptyText,

  /** Whole phrases that mark a concept as advertising filler. Matched case-insensitively. */
  banned_phrases: z.array(NonEmptyText).min(8),

  /** Words that describe a feeling about a design rather than the design. */
  vague_words: z.array(NonEmptyText).min(15),

  /**
   * Styling vocabulary — colour, light, camera, type, texture.
   *
   * Stripped before two concepts are compared, so "beige version" and "cream
   * version" collapse to the same signature instead of scoring as distinct.
   */
  styling_words: z.array(NonEmptyText).min(20),

  /** Function words excluded from every density and overlap calculation. */
  stopwords: z.array(NonEmptyText).min(20),

  /** Metaphor family → the words that signal it. Used to derive a diversity feature. */
  metaphor_families: z.record(Slug, z.array(NonEmptyText).min(3)),

  /** Phrases that assert a country simply equals a look. */
  cultural_shortcut_patterns: z.array(NonEmptyText).min(3)
});
export type ConceptLexicon = z.infer<typeof ConceptLexicon>;
