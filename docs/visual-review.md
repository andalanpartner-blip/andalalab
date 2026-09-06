# Visual Review (P4.1)

`{ contract, direction, recipe, promptSet, concept?, visualEvidence? } → VisualReviewReport`.
Deterministic, pure, read-only. **No LLM, no image processing, no vision model,
no network.** The image-measuring half of the Design Critic named in ADR 0009 —
built the way that ADR anticipated: structured evidence first, not computer
vision.

`reviewDesign` extends P4.0; it does not replace it. `auditDesign` runs
unchanged and its `DesignCriticReport` is embedded verbatim as
`report.pre_generation`.

## The three dimensions

| dimension | what it covers | when it is assessed |
| --- | --- | --- |
| `design_compliance` | the deterministic pre-generation checks + the selected direction's fit scores | **always** — from pipeline artifacts. `evidence-backed`. |
| `visual_quality` | composition · hierarchy · typography · color · imagery, **as rendered** | only when a matching `VisualEvidence` fixture is supplied. `fixture-backed`. Otherwise `unassessed`. |
| `technical_quality` | render artifacts · text rendering · aspect ratio · resolution | same. `fixture-backed` → else `unassessed`. |

Each dimension reports `{ status: assessed | unassessed, basis, score: 0..1 | null, issue_count }`.

## The twelve categories

`communication`, `composition`, `hierarchy`, `typography`, `color`, `imagery`,
`brand_fit`, `industry_fit`, `cultural_fit`, `movement_fit`, `platform_fit`,
`technical_quality`. Each issue carries exactly one. `brand_fit` is `unassessed`
when the brief supplied no brand.

## Severity

`P0` critical · `P1` major · `P2` moderate · `P3` minor. P4.0 findings map
straight through (`P0→P0`, `P1→P1`, `P2→P2`); `P3` is used for weak fit-score
notes and the "not assessed" placeholder.

## Every issue

```ts
type ReviewIssue = {
  dimension; category; severity;
  basis: "evidence-backed" | "fixture-backed" | "unassessed";
  what;    // what was observed / found
  why;     // why it matters, in doctrine terms
  impact;  // the consequence for the finished visual
  fix;     // the concrete corrective action
  upholds; // which doctrine principle, or null
  evidence: string[]; // empty ONLY when basis is "unassessed"
};
```

**The evidence rule is enforced by the schema.** A `.superRefine` on
`ReviewIssue` rejects any `evidence-backed` or `fixture-backed` issue with an
empty `evidence` array, and any `unassessed` issue that carries evidence. No
visual-quality or technical-quality claim can be presented as fact without
evidence.

## Overall

```ts
overall: {
  score: number | null;                 // mean of the three dimension scores,
                                         // or null while a renderable dimension
                                         // is unassessed
  status: "assessed" | "partially-assessed" | "unassessed";
  verdict: "PASS" | "REVIEW" | "BLOCK" | "UNASSESSED";
}
```

Verdict rollup over the actionable issues (basis ≠ `unassessed`): any `P0` ⇒
`BLOCK`; else any `P1` ⇒ `REVIEW`; else `PASS`. With no evidence the verdict
therefore tracks the P4.0 verdict exactly, and `status` is `partially-assessed`
to make the gap explicit.

## VisualEvidence

A bounded, structured description of ONE rendered frame — `types/schemas/visual-evidence.schema.ts`:

- `recipe_hash` — binds the evidence to a specific recipe. A mismatch is
  reported (`audited.visual_evidence_stale = true`) and the renderable
  dimensions stay `unassessed`; stale observations are never applied.
- `source` — `fixture` | `human-review` | `vision-model`. Only the first two
  exist today.
- `aspect_ratio { observed, expected }`, `text_render { rendered_text_present,
  core_message_legible }`, `artifacts: string[]`, and `observations` — each
  `{ category, statement, polarity: supports|concern|neutral, severity_hint,
  confidence }`.

Deterministic checks over the evidence: wrong aspect ratio → `P1` technical;
text rendered into a `LAYOUT_ONLY` design → `P1` technical; an illegible core
message in a `TEXT_CRITICAL` design → `P0` technical; each artifact → `P1`
technical; each `concern` observation → an issue at its `severity_hint` (or
`P2`), routed to the category's home dimension.

## Doctrine preserved

The seven ordering principles are carried verbatim in `report.doctrine` and used
as the category tiebreaker when issues sort:

1. Communication before decoration.
2. Function before style.
3. Hierarchy before detail.
4. Brand before trend.
5. Context before stereotype.
6. Consistency before novelty.
7. Design decisions before prompt generation.

## Guarantees

- Pure and deterministic; no model, no image processing, no network.
- Read-only: never mutates the contract, direction, recipe or prompt set. A
  critique never feeds back into a `DesignRecipe`.
- Additive: `RecipeOkResult` gains `review`; `critic` and every P0–P7 behaviour
  are untouched.
- No visual or technical claim without evidence — enforced by schema.
- An honest `null` / `unassessed` state wherever a rendered image was not
  reviewed.

## Tests

- `tests/unit/visual-review.test.ts` — shape, doctrine order, P4.0 embedding,
  determinism, no-mutation, the unassessed path, the fixture-backed path, stale
  evidence, wrong ratio, brand-fit unassessed.
- `tests/golden/visual-review.golden.test.ts` — every P1 fixture gets a
  schema-valid deterministic review whose verdict tracks P4.0; the pipeline
  carries `review` alongside `critic`; a matching fixture assesses all three
  dimensions; unreadable evidence is ignored without error.
- `tests/fixtures/visual-evidence/` — `clean-render.json`,
  `weak-hierarchy-render.json`, and a loader that binds them to a recipe hash.
