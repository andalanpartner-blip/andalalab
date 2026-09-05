# ADR 0005 — The stereotype guard is an output filter, not a prompt instruction

**Status:** accepted (P0)

## Context
Doctrine §5 forbids the country layer from becoming a motif engine. Language models have strong
priors linking a country to a small set of symbols, and those priors reliably outrun an instruction
in a system prompt.

## Decision
Every country file declares `avoid_stereotypes` as structured `{token, why, instead}` entries. The
tokens are aggregated onto the Design Contract as `banned_tokens` and will be applied in P3 as a
**post-compile string filter on the generated prompt**, not as a request to the model.

The guard is a default, not a censor: a token the brief explicitly asks for is released, and the
release is recorded as a visible constraint on the contract rather than happening silently.

## Consequences
- A CI regression suite can assert the property directly, because it is a string property.
- `why` and `instead` are not decoration — `instead` is the replacement guidance the concept and
  recipe engines will read in P1 and P2.
- Authors cannot cheat: `pnpm validate:data` fails if a file guards a token and then uses it.
- Token lists need maintenance as new shortcuts emerge. That is data work, not code work.
