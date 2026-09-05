# P2.3.2b Readiness Diagnosis

**Date:** 2026-09-05  
**Source:** `reports/real-brief-evaluation.json` (`run_at: 2026-09-05T05:38:30.358Z`)  
**Scope:** Offline diagnosis only. No Gemini call was run and no production code was changed.

## Executive Finding

The current readiness contract is **not** the contract described in the previous P2.3.2 analysis.

`engine/brief/completeness.ts` currently treats exactly these seven fields as blocking:

1. `objective`
2. `industry_id`
3. `visual_type_id`
4. `platform.channel`
5. `platform.aspect_ratio_id`
6. `audience.description`
7. `country`

`core_message` is currently optional. It is not a readiness blocker. `normalizeBrief()` derives a contract-safe `core_message` only after all seven blocking fields are present.

The latest live run proves that 10 model calls succeeded, 1 brief was ready, and 9 were excluded. It does **not** contain enough information to identify the exact missing blocking fields for those nine briefs: the evaluator discards the extraction and completeness report when `brief` is `null`, and serializes only a rounded completeness score.

Therefore the precise root cause of the remaining exclusions is:

> **The readiness predicate is intentionally blocking on seven required fields, but the evaluation artifact does not record which fields caused each exclusion. The current report cannot distinguish a model extraction gap from a normalization or schema problem for briefs 2-10.**

This is primarily an **evaluator observability issue**, with a possible extraction issue hidden behind it. It is not evidence that `core_message` is still blocking.

## Current Readiness Contract

From `engine/brief/completeness.ts`:

| Category | Fields |
|---|---|
| Blocking | `objective`, `industry_id`, `visual_type_id`, `platform.channel`, `platform.aspect_ratio_id`, `audience.description`, `country` |
| Derivable | `platform.viewing_context`, `audience.attention_context`, `audience.age_range`, `audience.sophistication`, `audience.price_sensitivity`, `deliverables` |
| Optional | `core_message`, `movement_id`, `brand_name`, `mandatories`, `prohibitions`, `audience.cultural_context`, `style_notes`, `visual_references` |

Readiness is exactly `blocking_fields.length === 0`. Low confidence does not make a present field blocking. Missing derivable and optional fields also do not make a brief unready.

## Ten-Brief Audit

The table separates facts present in the artifact from facts that are unavailable. `P` means present in the persisted normalized brief; `?` means the latest report did not persist the extraction needed to determine it.

| # | Brief | Blocking fields present | Blocking fields missing | Usable for a graphic designer? |
|---:|---|---|---|---|
| 1 | `coffee-grand-opening` | All 7: `objective`, `industry_id`, `visual_type_id`, `platform.channel`, `platform.aspect_ratio_id`, `audience.description`, `country` | None | **Yes.** It is the only brief that passed readiness. The country and audience comparison failures are evaluator comparison mismatches, not readiness failures. |
| 2 | `fashion-collection-launch` | Not persisted | Not identifiable. Score `0.5893` permits either 2 or 3 missing blocking fields under the current scoring formula | **Cannot determine from the artifact.** The source brief appears designer-usable, but the readiness decision cannot be safely reviewed without the missing-field list. |
| 3 | `property-cluster-promotion` | Not persisted | Not identifiable. Score `0.5893` permits either 2 or 3 missing blocking fields | **Cannot determine from the artifact.** The source contains objective, audience, channel, and country cues, but extraction completeness is not recorded. |
| 4 | `beauty-skincare-campaign` | Not persisted | Exactly 1 missing blocking field is implied by score `0.8036` and `ready: false`; its identity is not persisted | **Probably yes for a designer, but not safely through this engine until the missing required field is known and confirmed.** |
| 5 | `hotel-promotion` | Not persisted | Not identifiable. Score `0.6250` permits either 2 or 3 missing blocking fields | **Cannot determine from the artifact.** The source has a clear promotion, audience, channel, and country context, but the extracted blocking state is absent. |
| 6 | `wellness-pilates-campaign` | Not persisted | Score `0.7500` permits either 1 or 2 missing blocking fields | **Cannot determine from the artifact.** The source is rich enough for design exploration, but readiness requires knowing which engine-critical field was not extracted. |
| 7 | `saas-product-launch` | Not persisted | Not identifiable. Score `0.5893` permits either 2 or 3 missing blocking fields | **Cannot determine from the artifact.** The source contains a launch objective, audience, platform candidates, and country context, but the extracted blocking state is absent. |
| 8 | `public-event-campaign` | Not persisted | Score `0.6429` permits 1, 2, or 3 missing blocking fields | **Cannot determine from the artifact.** The source is detailed, but the persisted report cannot show whether the failure is one missing field or several. |
| 9 | `community-organization-campaign` | Not persisted | Score `0.3571` permits either 4 or 5 missing blocking fields | **Probably no for safe downstream design decisions without clarification.** The source has a purpose and audience, but the low score indicates a materially incomplete extraction; exact gaps remain unknown. |
| 10 | `retail-product-promotion` | Not persisted | Score `0.7500` permits either 1 or 2 missing blocking fields | **Cannot determine from the artifact.** The source appears broadly designer-usable, but the required extracted field set is unavailable. |

The score constraints above are not a substitute for the missing-field list. They arise because the completeness score combines blocking and soft-field presence:

$$
S = 0.75 \cdot \frac{B_{present}}{7} + 0.25 \cdot \frac{S_{present}}{14}
$$

Different blocking/soft presence combinations can produce the same rounded score.

## What the Latest JSON Actually Proves

- All 10 Gemini calls succeeded.
- 1 brief was eligible and 9 were readiness-excluded.
- Brief 1 had all seven blocking fields and produced a normalized brief.
- Briefs 2-10 have `field_comparisons: []`, `ready: false`, and no persisted normalized extraction.
- The evaluator serializes `actual_*` values using `e.actual_normalized?.…`; therefore all actual values are absent for not-ready briefs by design.
- The evaluator does not serialize `completeness.blocking_fields`, `missing_fields`, `derivable_fields`, or the raw `extraction`.

## Classification of the Remaining Problem

| Candidate | Finding |
|---|---|
| Intentional readiness rule | **Yes, conditionally.** The seven fields are deliberately documented as required for safe downstream design decisions. The rule itself is deterministic and does not accidentally block on confidence, `core_message`, or derivable defaults. |
| Schema issue | **Not demonstrated.** The normalized schema requires these concepts, but the extraction schema and completeness code agree on the relevant fields. No evidence shows that a valid extracted value is rejected by normalization. |
| Evaluator issue | **Definitely.** The report omits the exact blocking fields for every excluded brief, making the requested per-brief diagnosis impossible from the saved artifact. It also continues to evaluate comparisons only for ready briefs. |
| Normalization issue | **Not demonstrated.** `normalizeBrief()` calls `checkCompleteness()` directly on the sanitized extraction. It only builds a normalized brief after readiness passes. No transformation is shown to erase a blocking value. |
| Model extraction issue | **Possible, but unproven from this artifact.** One or more blocking values may genuinely be null in Gemini output. The report does not retain enough data to identify or verify them. |

## Country and Audience Findings

Brief 1 is ready, so its country and audience comparison failures are separate from readiness:

- Expected country: Indonesia `0.75`, Japan `0.25`
- Actual country: Indonesia `0.5`, Japan `0.5`
- The comparator requires each weight to be within `+/-0.15`; both differences are `0.25`, so it correctly reports a mismatch under its current rule.
- Expected audience is an English semantic summary; actual audience is Indonesian source-language wording. The deterministic category comparator reports a mismatch. This does not affect readiness because `audience.description` is present.

These are evaluator/comparison-contract issues, not reasons for the nine readiness exclusions.

## Smallest Safe Fix

Do not change Gemini prompts, readiness rules, normalization behavior, or P1 design-decision logic based on this report.

The smallest safe next change is **diagnostic-only evaluator output**: persist `completeness.blocking_fields`, `completeness.missing_fields`, and preferably the present/missing state for every successful call, including not-ready briefs. Then rerun the same live evaluation once, if a live run is explicitly authorized, to identify the actual extraction gaps.

Until that diagnostic data exists, changing the blocking list would be guesswork and could make an actually unsafe brief appear ready. The current evidence supports fixing observability first, not relaxing readiness.
