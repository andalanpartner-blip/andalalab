import { buildPromptBlocks } from "./blocks";
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
  return { language, ...render(blocks) };
}
