# Smart Brief Classification (P2.8)

**Status:** ✅ Implemented in P2.8 — additive, deterministic layer over the existing brief pipeline.

## Problem

A natural brief such as:

> "Buat poster Instagram 4:5 untuk event kreatif anak muda di Solo…"

reaches the Brief Interpreter, which extracts every blocking field except `industry_id`. The
extraction schema (`engine/brief/extraction.ts`) constrains `industry_id` to the loaded industry
enum, so when the client's wording ("coffee shop", "kedai kopi", "brand skincare") is not a
taxonomy term the model returns `null` — correctly, because inventing an id would fail validation
and trigger the repair loop.

Before P2.8 there was no step between extraction and readiness that could turn "coffee shop" into
`fnb`. `evaluateReadiness` saw `industry_id` missing and asked the client "what kind of business is
this?" even when they had already said.

## Design

`engine/brief/classify.ts` adds one deterministic function, `classifyBrief(extraction, rawBrief,
datasets)`, called in `normalizeBrief` **after `sanitizeExtraction` and before
`evaluateReadiness`**:

```
LLM extraction → sanitizeExtraction → classifyBrief → evaluateReadiness → (brief | questions)
```

It only ever touches two fields — `industry_id` and `audience.description` — and it only fills a
value it can defend from curated aliases found in the brief text. It never calls a model, never
invents an id (every value written is already a key in `datasets.industries`), and is **not** a
second readiness gate: `evaluateReadiness` remains the single authority and now always runs on
canonical, normalized values.

### Canonical taxonomy

The industries in `data/industries/` are the only valid `industry_id` values:

| id | name |
|---|---|
| `beauty-skincare` | Beauty & Skincare |
| `fashion` | Fashion |
| `fnb` | Food & Beverage |
| `healthcare` | Healthcare & Medical *(P7)* |
| `hospitality` | Hospitality |
| `luxury` | Luxury & Prestige *(P7)* |
| `property` | Property & Real Estate |
| `technology-saas` | Technology & SaaS |
| `wellness` | Wellness & Fitness *(P7)* |

P2.8 added **no** industry, movement, provider, or schema. P7 added the three industries above as
data plus their `INDUSTRY_ALIASES` rows — no new classification logic. A test asserts every alias
in `INDUSTRY_ALIASES` points at a loaded canonical id.

### Semantic aliases

`INDUSTRY_ALIASES` maps Indonesian/English phrasings to a canonical id with a per-phrase
confidence — e.g. `"coffee shop" → fnb (0.95)`, `"kedai kopi" → fnb (0.95)`, `"real estate" →
property (0.95)`, `"klinik kecantikan" → beauty-skincare (0.92)`, `"salon" → beauty-skincare
(0.70)`.

`AUDIENCE_SIGNALS` recognizes natural target-group phrasing regardless of language — `"anak muda"`,
`"Gen Z"`, `"mahasiswa"`, `"perempuan urban"`, `"profesional muda"`, `"young professionals"`,
`"ibu rumah tangga"`, `"pelaku UMKM"`, `"business owners"`, … Matching is case-insensitive and
whole-phrase (punctuation folded to spaces). The resolved `audience.description` quotes the brief
verbatim — audience is never inferred beyond the text, per the readiness policy.

Phrases that name a **format or occasion, not an industry** are deliberately absent: `"event
kreatif"`, `"festival"`, `"komunitas"`, `"organisasi"`, `"acara komunitas"`, `"public event"`,
`"creative event"`, `"campaign event"`. None maps cleanly to one of the six canonical industries,
so mapping them would be a guess. They stay `NEEDS_CLARIFICATION`.

### Confidence rules

`HIGH_CONFIDENCE = 0.85`.

| Situation | Result | Satisfies blocking field? |
|---|---|---|
| LLM returned a value | kept as-is, `source: "explicit"` | yes |
| exactly one candidate industry, best phrase ≥ 0.85 | `industry_id` filled, `source: "alias"` | yes |
| exactly one candidate industry, best phrase < 0.85 | left `null`, `source: "alias"` (reported) | no |
| two or more candidate industries in the text | left `null`, `source: "unresolved"` (ambiguous) | no |
| nothing matched | left `null`, `source: "unresolved"` | no |

Audience follows the same rule against `AUDIENCE_SIGNALS`.

### Explicit vs inferred — traceable diagnostics

`normalizeBrief` returns `classifications: ClassificationDiagnostic[]`, forwarded through
`progressiveBriefing`:

```jsonc
{ "field": "industry_id", "value": "fnb", "source": "alias", "confidence": 0.95, "evidence": "coffee shop" }
{ "field": "industry_id", "value": null,  "source": "unresolved", "confidence": 0, "evidence": "event kreatif" }
{ "field": "audience.description", "value": "perempuan urban", "source": "alias", "confidence": 0.87, "evidence": "perempuan urban" }
```

The `(source, value, confidence)` triple distinguishes the four states the policy requires:
explicit · inferred-high-confidence · inferred-low-confidence · unresolved.

### When clarification is still required

Unchanged from `docs/readiness-policy.md`. A blocking field that the classifier leaves `null` is
still asked about by `evaluateReadiness` with its deterministic question. The classifier can only
*remove* a question when the evidence is strong and unambiguous; it never suppresses one on a
hunch, and `NEEDS_CLARIFICATION` never carries an empty question list.

## Worked examples

| Brief | `industry_id` | `audience.description` | Readiness |
|---|---|---|---|
| "…event kreatif anak muda di Solo." | `unresolved` (no canonical match) | explicit (`anak muda…`) | NEEDS_CLARIFICATION — asks industry only |
| "Buat campaign fashion untuk perempuan urban." | explicit `fashion` | alias `perempuan urban` (0.87) | NEEDS_CLARIFICATION — objective, channel, output, market |
| "Buat promo coffee shop untuk Gen Z." | alias `fnb` (0.95, "coffee shop") | alias `Gen Z` (0.90) | NEEDS_CLARIFICATION — channel, output, market |
| "Buat poster komunitas kreatif." | `unresolved` | alias, but 0.80 < 0.85 → `null` | NEEDS_CLARIFICATION — objective, audience, industry, channel, output, market |
| "Buat poster untuk bisnis saya." | `unresolved` (evidence `null`) | `unresolved` | NEEDS_CLARIFICATION |
| "…coffee shop baru di Solo. Target anak muda… grand opening." | alias `fnb` (0.95) | explicit | **READY** → contract → direction → concepts |

## Guarantees

- No live model call in classification — 100% deterministic, runs after extraction.
- No dataset, schema, provider, movement, or doctrine change.
- `evaluateReadiness` is still the single source of truth (`docs/readiness-policy.md`).
- Every value the classifier writes is a loaded canonical id / a verbatim brief slice.
- Existing brief fixtures are unaffected: they carry explicit `industry_id`, so the classifier
  takes the `explicit` branch and changes nothing.
