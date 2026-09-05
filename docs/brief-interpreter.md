# Brief Interpreter

Raw Indonesian text → `NormalizedBrief`. One model call.

## Division of labour

The model reads language. It reports what the brief **says**, with a confidence
per field and `null` wherever it found nothing.

It may extract: objective, core message, industry, visual type, platform,
audience, deliverables, mandatories, prohibitions, explicit country/movement/
style requests, visual references, and contradictions it noticed.

It may not: score candidates, resolve doctrine, choose DKV parameters, pick a
final movement, or build anything. Those are P1's job and stay deterministic.

## Why extraction is not NormalizedBrief

The model returns a `BriefExtraction`, a separate shape where every field is
`{value, confidence}` and nullable. Converting that into a `NormalizedBrief` is
a deterministic second step.

Keeping the two apart is what stops a design decision arriving disguised as an
interpretation. The model can say *"the brief mentions Japan"*; it cannot say
*"use a 0.7/0.3 Indonesia–Japan blend with asymmetric composition"*.

## Ids are validated against loaded data

`buildExtractionSchema(datasets)` builds the schema from the datasets actually
loaded, so `industry_id: "kedai-kopi"` fails validation and triggers the repair
loop rather than reaching the engine. The prompt lists the same ids, generated
from the same source — the allowed vocabulary can never drift from the data.

The schema is `.strict()`: an unexpected key such as `dkv_targets` is rejected
outright rather than ignored.

## Sanitisation

Zod proves the shape. It cannot prove the content is sane.

- Trim, collapse whitespace, drop empties, dedupe — order preserved.
- Strip `utm_*`, `fbclid`, `gclid`, `igshid` and fragments from references.
- Swap a reversed age range and say so.
- Merge duplicate countries and renormalise weights to 1.
- **Invention detection**: for every mandatory and prohibition of three tokens or
  more, measure word overlap with the source brief. Below 34%, warn. A mandatory
  the client never wrote is the most damaging thing an interpreter can produce,
  because it becomes a hard constraint the entire engine then obeys. This cannot
  catch every fabrication; it catches the confident ones. Nothing is deleted —
  dropping a real requirement would be worse than flagging a false one.

## Derived values

Some fields the schema requires are not worth asking a client for:

| Field | Rule |
|---|---|
| `platform.viewing_context` | from channel — a feed post is viewed at thumbnail distance |
| `audience.attention_context` | from channel — feed means scrolling |
| `audience.age_range` | 18–65 when unstated |
| `audience.sophistication` | 0.5, neutral |
| `audience.price_sensitivity` | 0.5, neutral |
| `deliverables` | from visual type + aspect ratio |

Every derivation is listed in `outcome.derived` and recorded with **confidence
0**, so a reviewer can always tell a derived value from a stated one.

## Completeness

Deterministic, never asked of the model — "did you miss anything?" produces a
confident answer with no relationship to what the engine requires.

- **Blocking** (no defensible default): objective, core message, industry, visual
  type, channel, aspect ratio, audience description, country. Missing any of
  these means `brief` is `null` and the project belongs in CLARIFY.
- **Derivable**: the table above. Reported as missing, then supplied.
- **Optional**: movement, brand, mandatories, prohibitions, cultural context,
  style notes, references.

`completeness_score` weights blocking fields at 0.75 and the rest at 0.25.
Fields extracted with confidence below 0.5 are listed in `low_confidence_fields`
even when present — worth confirming, not worth blocking.
