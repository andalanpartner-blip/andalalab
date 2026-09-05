# ADR 0002 — Reference data lives in version-controlled JSON, not in Postgres

**Status:** accepted (P0)

## Context
Country, movement, industry, visual type and layout data must be versioned, reviewable, diffable and
loadable by a pure engine. It is authored by one person and changes deliberately, not continuously.

## Decision
Datasets are JSON files under `data/`, validated by Zod at load time and pinned by a single
`data/VERSION`. The loader scans directories rather than importing files by name. The engine never
loads anything; it receives a `DatasetRegistry`.

## Consequences
- Git provides versioning, diffs, review and rollback for free. No admin CMS to build.
- Adding a country is one file — no code change, proved by test.
- Editing requires a commit, so a non-technical editor cannot change data in-app. Acceptable while
  the author is also the developer; a `reference_overrides` table can layer on later.
- `data/loader.ts` is the only module in the system that touches disk, which keeps the purity rule
  in ADR 0001 easy to obey.
