# Prompt Output Guard (P3.0)

`PromptSet (rendered) + recipe.culture.banned_tokens → PromptSet + PromptGuardReport`.
Deterministic, no LLM. The **post-compile string filter** promised in
[ADR 0005](adr/0005-stereotype-guard-as-output-filter.md).

## Why

Doctrine §5 forbids country influence from collapsing into a motif. That
doctrine is enforced everywhere upstream:

- every country file declares `avoid_stereotypes: {token, why, instead}` (≥5 each);
- `collectBannedTokens` aggregates them onto `contract.banned_tokens` → `recipe.culture.banned_tokens`, **releasing** any token the brief explicitly asked for and recording the release as a visible constraint;
- `pnpm validate:data` fails a country file that guards a token and then uses it;
- the renderers already emit a compact anti-stereotype instruction line and drop the country-sourced `must_not` sentences.

The one gap: **the compiled prompt text itself was never checked.** The
renderers quote a lot of prose verbatim — `recipe.imagery.framing` (country
prose), movement `core_principles` / `anti_stereotype`, and, highest-risk, the
LLM-authored concept fields (`visual_metaphor`, `visual_world`,
`creative_tension`). A banned token in any of those could reach `masterPrompt`.
`jakarta-tokyo-blend` already does: the brief's own prohibition *"No batik
pattern as background"* renders into the Avoid paragraph of four tiers.

P3.0 closes the gap: a deterministic pass over the five compiled strings, in
each language, that reports every banned-token occurrence and removes only the
ones it can remove safely.

## Contract

`compilePromptSet` runs `guardPromptSet(render(blocks), recipe.culture.banned_tokens)`
after rendering and returns the result on `PromptSet.guard`:

```ts
type PromptGuardReport = {
  clean: boolean;               // true ⇒ no banned token reached any tier
  findings: BannedTokenFinding[];
};

type BannedTokenFinding = {
  token: string;
  tier: "masterPrompt" | "quickPrompt" | "imageOnlyPrompt" | "designLayoutPrompt" | "negativePrompt";
  action: "stripped" | "flagged";
  negative_context: boolean;    // token sat inside an "avoid / no / never" instruction
  context: string;              // the list item or sentence it appeared in
};
```

### What it scans

Only `recipe.culture.banned_tokens`. That list **already excludes released
tokens**, so a token the brief explicitly requested is never scanned for, never
flagged, never stripped — see the `batik-heritage-release` fixture. Matching
reuses `mentionsToken` (case-insensitive, word-boundary aware, multi-word
tolerant): `batik` matches `BATIK` and `a batik border` but not `prebatik`.

The `visualCharacter` metadata is not scanned — it is drawn from a fixed
adapter vocabulary with no leak surface.

### What it strips

**Exactly one shape: a standalone item of a `, ` / `; ` list, in a positive
context, on a line that has other items.** e.g.

```
Relationships: warm neutral base, batik, earth and clay tones.
    ->
Relationships: warm neutral base, earth and clay tones.
```

Removing one list item keeps the sentence grammatical. The guard eats one
adjacent `, ` / `; ` and preserves the line's terminal `.` if the removed item
carried it. Lists that open mid-line after `: ` or `. ` are handled
(`…complexity 42%. Relationships: batik, …`).

### What it flags (and never rewrites)

Everything else:

- a multi-word phrase (`traditional batik motifs`) — ambiguous to shorten;
- a token inside a sentence (`the frame leans on a batik border`);
- the only item on its line;
- **any occurrence in a negative context** — a segment starting with `avoid` /
  `no` / `not` / `never` / `without` / `hindari` / `jangan` / `tanpa`, or
  anywhere in the whole Negative Prompt. There the prompt is telling the
  generator *not* to use the motif; stripping it would delete the instruction.
  `negative_context: true` marks these as benign.

Flagged text is preserved byte-for-byte. No speculative rewriting.

### Determinism

Tokens are de-duplicated, trimmed and sorted; strips within a tier are applied
right-to-left; findings are sorted by `(token, tier order, context)`. Identical
recipe ⇒ identical `guard` report and identical prompt strings, in every
language. The banned-token list order does not matter.

## Languages

EN and ID are separate `compilePromptSet` calls and are scanned independently.
The ID renderer re-authors English dataset prose in Indonesian and omits some of
it entirely (e.g. colour-relationship sentences), so a token planted into
`color.relationships` is caught in EN and is simply absent from ID — the guard
reports each language honestly.

## UI

`PromptSection` shows one calm line under the header when `!guard.clean`: how
many guarded motif mentions were removed, how many were left in place (with the
reason: they sit inside an "avoid / no" instruction), and the exact contexts.
Nothing alarming — a flagged mention in a negative instruction is the doctrine
working.

## Guarantees

- No live model call; 100% deterministic; runs after rendering.
- No design decision, no country id read, no new provider / database / framework.
- A clean recipe's prompts are byte-identical to a pre-P3.0 render.
- The stereotype-guard property is now a CI regression test
  (`tests/golden/prompt-output-guard.golden.test.ts`,
  `tests/unit/prompt-output-guard.test.ts`) — a string property, exactly as
  ADR 0005 intended.
