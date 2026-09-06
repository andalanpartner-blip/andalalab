# ADR 0010 — P7 Breadth: wider data, one schema bump, no new engine rules

**Status:** accepted (P7)

## Context

Through P6 the pipeline was functionally complete but narrow: 6 industries, 1
visual type, and a hardcoded four-movement shortlist in `engine/concept/validate.ts`.
Two P1 fixtures (`brutalist-trust-conflict`, `luxury-density-conflict`) stood in
`property` and `fashion` for the missing `healthcare` and `luxury` industries.
ADR 0006 named dataset authoring as the real bottleneck; P7 pays it down.

## Decision

- **Industries → 9.** `healthcare`, `wellness`, `luxury` added as `IndustryDNA`
  files. `healthcare` and `luxury` were authored to reproduce the exact tensions
  the stand-in fixtures tested, which were then repointed onto the real
  industries; the stand-ins are gone, not kept as parallel coverage.
- **Visual types → 6.** `story`, `tiktok-still`, `web-hero`, `print-a4`,
  `out-of-home` added, each with 1–2 dedicated layouts (layouts → 10). Every
  channel `PlatformSpec.channel` accepts now has a visual type.
- **Movement-name detection is data-driven.** `DesignMovement` gains an optional
  `aliases: string[]` (schema `movement@1.0.0 → 1.1.0`, additive, identity
  upcaster registered in `types/versions.ts`). `checkConstraints` iterates
  `datasets.movements` and matches `id` + `name` + `aliases`. The last hardcoded
  taxonomy list in `engine/` is removed.
- **No vertical tuning.** `healthcare`/`wellness`/`luxury` use the existing
  generic branches in `engine/photographic-character/resolve.ts` and
  `engine/concept/score.ts` (both have safe fallthroughs). Industry-specific
  photographic or concept-archetype rules are deferred to a possible P7.1.
- **Boundaries held.** No image/vision API, no new model call or provider, no
  database, no new country, no Indonesian concept lexicon.

## Consequences

- `SCHEMA_VERSIONS.movement` is the first schema past `1.0.0` and `UPCASTERS`
  holds its first entry — the "bump and write an upcaster" path from ADR 0004 is
  now exercised, not just documented.
- One P4.0 verdict shifts: `wellness-studio-promo` is a new `REVIEW` from the
  Indonesian spatial-density bias against a calm-category ceiling. The two
  repointed fixtures keep their verdicts. `docs/design-critic.md` records the
  new calibration.
- The generic photographic character for the new industries is a known, logged
  limitation, not a defect — the fallthroughs produce sensible output.
- Adding the next industry, country or movement remains a file-only change; the
  "new industry from a file alone" test now asserts this alongside the country
  one.
