# ADR 0003 — Dataset ids are validated slugs, not TypeScript unions

**Status:** accepted (P0)

## Context
Modelling ids as union types (`type CountryId = "indonesia" | "japan" | ...`) would give compile-time
autocomplete and catch typos in the editor.

## Decision
Ids are validated as kebab-case slugs. Referential integrity between files is checked by the loader
at load time, not by the type system.

## Consequences
- Adding a country stays a data-only change, which is the architecture's stated success test.
- Typos are caught by `pnpm validate:data` with a precise message, one build step later than the
  editor would have caught them. This is the cost, and it is small.
- The loader's `checkReferentialIntegrity` becomes load-bearing and must stay thorough — a dangling
  `preferred_movements` entry would otherwise sit silent until P1 scored nothing.

## Revisit if
A generated `data/generated/ids.d.ts` produced by the validation script could restore autocomplete
without reintroducing a hand-edited registry. Worth doing once the dataset count grows.
