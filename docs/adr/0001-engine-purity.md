# ADR 0001 — The engine is a pure library, enforced by lint

**Status:** accepted (P0)

## Context
The approved architecture requires that design intelligence never live inside React components. That
requirement is easy to state and easy to violate one convenient import at a time.

## Decision
`engine/**` is a pure module: no React, Next, Supabase, `fs`, `path`, network clients, adapters,
services, or the dataset loader; no `fetch`, `Date.now()`, `new Date()`, `Math.random()`. Datasets,
time and identity are injected as arguments. Enforced by `eslint.config.mjs` and proved by
`tests/lint/boundary.test.ts`, which lints illegal code and asserts the rule fires.

## Consequences
- Every engine function is synchronous, deterministic and testable without mocks.
- The layer can be extracted into a package later with no edits.
- Loading data becomes someone else's job — hence ADR 0002.
- A lint rule with no failing test is a rule nobody has verified, so the probes are part of the suite.

## Alternatives rejected
A monorepo with a real package boundary. Correct in principle, but it adds build tooling a one-person
team does not need yet, and the lint rule gives most of the benefit today.
