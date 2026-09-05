# Data authoring guide

Reference data is source code. It determines everything the product does, it is reviewed like code,
and a bad file fails the build. This guide is how to write one.

**Read `data/countries/indonesia.json` before writing anything.** It is the exemplar. Every other
country file is judged against it.

---

## The one rule

> A country is an **influence layer**, not a visual template.

You are describing *how a place behaves visually* — spatial habits, typographic relationships,
colour reasoning, materials, rhythm — not *what objects appear in it*. If a field could be replaced
by a stock photo search term, it is wrong.

| ❌ Motif thinking | ✅ Influence thinking |
|---|---|
| "traditional patterns and textiles" | "dense figure-ground interlock; rhythmic repetition with variation" |
| "temples and heritage architecture" | "layered thresholds; indoor-outdoor continuity as permeable framing" |
| "vibrant tropical colours" | "two registers: high-chroma vernacular that survives sunlight, and low-chroma contemporary premium that signals restraint against it" |
| "minimalist and zen" | "interval as an active designed element; unequal margins; confident emptiness" |

## Writing `avoid_stereotypes`

This is the most important block in the file, and the only one with three required parts.

```json
{
  "token": "batik",
  "why":     "why this shortcut is lazy, inaccurate, or harmful — 30+ characters",
  "instead": "what to carry across instead — the underlying principle — 30+ characters"
}
```

- `token` is lowercase and becomes a **filter applied to generated prompt strings** in P3. It is not
  advice to a model; it is a string match on output.
- Minimum five per country. Include the obvious ones — the test suite checks that the well-known
  shortcut for each MVP country is declared.
- **A token you guard must not appear anywhere else in the same file.** `pnpm validate:data` fails on
  self-contradiction: a file that says "avoid batik" and then writes "batik-inspired rhythm" into
  `visual_traits` is arguing with itself.
- The guard is a default, not a ban. If a brief explicitly asks for the token, the contract releases
  it and records the override. Write `why` for the common case, not the exception.

## Weights

`weights` says which dimensions carry this country's influence most strongly. They must sum to 1.
Switzerland loads composition and typography; Indonesia spreads across composition, materiality and
imagery. If every country has the same weights, none of them is doing anything.

Each `style_variants` entry may override the whole vector — variants are how one country supports
several legitimate registers without becoming vague.

## Checklist before committing

- [ ] `pnpm validate:data` passes
- [ ] `pnpm test` passes (the anti-stereotype suite runs against your file automatically)
- [ ] `weights` and every `weights_override` sum to 1
- [ ] Nothing in the file could be replaced by a stock photo search term
- [ ] `historical_influences[].visual_consequence` says what it does to a *layout*, not what it looked like
- [ ] At least two `style_variants`, and they are genuinely different registers, not two palettes
- [ ] `id` matches the filename exactly
- [ ] `schema_version` matches the current entry in `types/versions.ts`

## Adding a whole new country

1. Copy `indonesia.json`, rename it, replace **every** value.
2. Run `pnpm validate:data`.
3. Add the country's well-known shortcuts to `MUST_DECLARE` in
   `tests/anti-stereotype/country-guard.test.ts` — optional, but it is the extra scrutiny that keeps
   the guard honest.

That is the whole procedure. No TypeScript is edited at any point. If you find yourself needing to
change code to add data, stop — something in the architecture has drifted.
