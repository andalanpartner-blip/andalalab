import { buildPromptBlocks } from "./blocks";
import { guardPromptSet } from "./guard";
import { renderEnglish } from "./render/en";
import { renderIndonesian } from "./render/id";
import type { CompilePromptInput, PromptLanguage, PromptRenderer, PromptSet } from "./types";

const RENDERERS: Record<PromptLanguage, PromptRenderer> = {
  en: renderEnglish,
  id: renderIndonesian
};

/**
 * Compile a Design Recipe (and, when present, its Creative Concept) into a
 * ready-to-copy set of prompts for an external image generator.
 *
 * Deterministic and pure: identical input produces identical output, in every
 * language. This function makes no design decisions — it only translates
 * decisions the recipe already contains into natural-language instructions.
 *
 * After rendering, the P3.0 stereotype output guard runs once over this
 * language's five prompt strings, using `recipe.culture.banned_tokens` (which
 * already excludes any token the brief released). It strips a banned token that
 * appears as a standalone positive list item and flags every other occurrence
 * for review — see `docs/prompt-output-guard.md`.
 */
export function compilePromptSet(input: CompilePromptInput): PromptSet {
  const language = input.language ?? "en";
  const blocks = buildPromptBlocks({
    recipe: input.recipe,
    concept: input.concept ?? null,
    textMode: input.textMode ?? null,
    visualAdapter: input.visualAdapter ?? null
  });

  const render = RENDERERS[language];
  const { set, report } = guardPromptSet(render(blocks), input.recipe.culture.banned_tokens);
  return { language, ...set, guard: report };
}
