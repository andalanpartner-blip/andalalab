import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { VisualEvidence } from "../../../types/schemas/visual-evidence.schema";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

/**
 * Load a structured visual-evidence fixture and bind it to a specific recipe.
 *
 * The fixture files carry authored observations but a placeholder `recipe_hash`
 * and `$match` / `$expected` aspect-ratio sentinels — this stamps in the real
 * recipe hash and expected ratio so the evidence is genuinely bound to the
 * design under review. Pass an explicit `recipeHash` to simulate stale
 * evidence, or an explicit `observedRatio` to simulate a wrong-ratio render.
 */
export function loadVisualEvidence(
  name: string,
  binding: { recipeHash: string; expectedRatio: string; observedRatio?: string }
): VisualEvidence {
  const raw = JSON.parse(readFileSync(join(ROOT, `${name}.json`), "utf8")) as Record<string, unknown>;
  const ar = raw.aspect_ratio as { observed: string; expected: string };
  const expected = binding.expectedRatio;
  const observed =
    binding.observedRatio ?? (ar.observed === "$match" ? expected : ar.observed);

  return VisualEvidence.parse({
    ...raw,
    recipe_hash: binding.recipeHash,
    aspect_ratio: { observed, expected }
  });
}
