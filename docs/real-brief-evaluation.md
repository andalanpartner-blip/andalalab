# Real Brief Evaluation Harness — P2.3.2

## Purpose

The Real Brief Evaluation Harness is an **engineering evaluation tool**, NOT a statistically representative benchmark.

It runs 10 realistic Indonesian client briefs through the production Gemini Brief Interpreter and measures:
- Field-level extraction accuracy
- Completeness assessment
- Token consumption and cost
- Repair frequency

This tool helps developers validate the Brief Interpreter against realistic inputs and spot systematic failures before they reach production.

**Critical caveat**: These 10 briefs represent a snapshot of Andala Creative's domain, not a statistically valid sample of all possible briefs. Results should not be published as "the model is X% accurate at brief interpretation" without substantial additional testing.

## Running the Evaluation

```bash
# Requires GEMINI_API_KEY to be set
pnpm evaluate:briefs
```

The evaluation:
1. Loads 10 briefs from `data/evaluation/real-briefs.json`
2. Calls `normalizeBrief()` with real Gemini for each
3. Compares actual output against manually-defined expected values
4. Prints human-readable results to stdout
5. Writes machine-readable report to `reports/real-brief-evaluation.json`

## The 10 Briefs

Each brief is realistic, imperfect, and conversational — as if a real Indonesian client had sent it via WhatsApp or email.

### 1. Coffee Shop Grand Opening
- **Industry**: F&B
- **Objective**: launch
- **Platform**: Instagram feed (4:5 portrait)
- **Country blend**: Indonesia 0.75 / Japan 0.25
- **Audience**: Millennial and Gen Z coffee enthusiasts; urban professionals
- **Notes**: Intentionally includes informal language, minor grammatical issues, and combines Indonesian with design terminology

### 2. Fashion Collection Launch
- **Industry**: fashion
- **Objective**: launch
- **Platform**: Instagram feed (1:1 square)
- **Country blend**: Indonesia 1.0
- **Audience**: High-income urban professionals aged 25–40; design-conscious consumers
- **Notes**: References specific design movements (Bauhaus, Swiss design)

### 3. Property Cluster Promotion
- **Industry**: property
- **Objective**: promotion
- **Platform**: Facebook feed (4:5 portrait)
- **Country blend**: Indonesia 1.0
- **Audience**: Young families and professionals aged 30–50; seeking residential investment
- **Notes**: Includes pricing and location details but omits some delivery channel specifics

### 4. Beauty Skincare Campaign
- **Industry**: beauty-skincare
- **Objective**: awareness
- **Platform**: Instagram feed (4:5 portrait)
- **Country blend**: Indonesia 1.0
- **Audience**: Urban women aged 20–45; interested in skincare and natural beauty
- **Notes**: Mentions budget constraints; emphasizes UGC strategy

### 5. Hotel Promotion
- **Industry**: hospitality
- **Objective**: promotion
- **Platform**: Instagram feed (4:5 portrait)
- **Country blend**: Indonesia 1.0
- **Audience**: Affluent couples aged 25–45; seeking romantic getaways in Bali
- **Notes**: Aesthetic-focused brief; includes niche appeal (honeymoon market)

### 6. Wellness Pilates Campaign
- **Industry**: wellness
- **Objective**: promotion
- **Platform**: Instagram feed (4:5 portrait)
- **Country blend**: Indonesia 1.0
- **Audience**: Health-conscious women professionals aged 25–55; interested in fitness
- **Notes**: Growth-focused; includes member base baseline

### 7. Technology SaaS Product Launch
- **Industry**: technology-saas
- **Objective**: launch
- **Platform**: LinkedIn feed (4:5 portrait)
- **Country blend**: Indonesia 1.0
- **Audience**: SME owners and business managers aged 30–55; interested in business intelligence
- **Notes**: B2B positioning; mentions "technical but accessible" messaging requirement

### 8. Public Event Campaign
- **Industry**: event
- **Objective**: awareness
- **Platform**: Instagram feed (4:5 portrait)
- **Country blend**: Indonesia 1.0
- **Audience**: Design professionals and creatives aged 20–50 in Jakarta
- **Notes**: Large-scale event; includes exhibition and workshop components

### 9. Community Organization Campaign
- **Industry**: organization
- **Objective**: awareness
- **Platform**: Instagram feed (4:5 portrait)
- **Country blend**: Indonesia 1.0
- **Audience**: Educated middle to upper-class Indonesians; concerned with social impact
- **Notes**: NGO positioning; education and social impact focus

### 10. Retail Electronics Launch
- **Industry**: retail
- **Objective**: promotion
- **Platform**: Instagram feed (4:5 portrait)
- **Country blend**: Indonesia 1.0
- **Audience**: Tech-savvy urban consumers and students aged 15–50; interested in electronics
- **Notes**: Grand opening promotion; emphasizes deals and store experience

## Expected Labels

The **expected values** for each brief were manually defined by a human reviewer who:
1. Read the raw brief carefully
2. Identified explicit and inferable fields
3. Made conservative assumptions when fields were ambiguous
4. Documented reasons for each choice

Expected values are NOT simply "whatever Gemini would predict" — they represent reasoned baseline truth for comparison.

### Readiness Rules

The blocking fields are `objective`, `industry_id`, `visual_type_id`, `platform.channel`, `platform.aspect_ratio_id`, `audience.description`, and `country`. They remain blocking because the downstream design pipeline cannot choose a communication job, domain, output context, audience, or cultural blend safely without them.

`core_message` is optional. An explicit value is preserved with its extraction confidence. When it is absent but objective and audience are available, normalization creates a contract-safe derived message and records it in `derived` with confidence `0`; it does not block readiness. Age range, attention context, sophistication, price sensitivity, and deliverables remain derivable. Movement, brand name, mandatories, prohibitions, cultural context, style notes, and references remain optional.

Completeness separates missing blocking, derivable, and optional fields. Blocking fields carry the larger score weight, while missing optional information causes only a modest penalty. Derived values remain visible and never receive extraction confidence.

### Readiness vs Evaluation Eligibility

Readiness and evaluation eligibility are different decisions:

- **Ready** means the extraction contains every blocking field and can be converted into a `NormalizedBrief` for downstream design decisions.
- **Eligible** means the brief is ready and is therefore included in field-accuracy denominators.
- A successful model call can still produce an ineligible brief when one or more blocking fields are absent. This is a readiness exclusion, not an API failure.

Every evaluation record now retains the raw brief, raw extraction, normalized brief when available, completeness score, confidence summary, field comparisons, errors, and a deterministic readiness diagnosis. For an excluded brief, `readiness.missing_blocking_fields` identifies the exact absent fields; `readiness.optional_missing_fields` is informational and never blocks readiness. `readiness.derived_fields` records values supplied deterministically after extraction.

The report's `metrics.field_accuracy[field]` contains `matches`, `total`, and `not_evaluated_due_to_readiness`. `total` is the eligible denominator for that field; excluded successful briefs are counted separately rather than silently disappearing. The summary also reports `total_briefs`, `eligible_briefs`, `excluded_briefs`, and `readiness_exclusion_rate`.

The terminal output prints the call result, readiness decision, missing blocking fields, optional missing fields, and completeness score for every brief. This makes a readiness exclusion reviewable without changing the readiness rules.

### Ambiguous Cases

Some fields required judgment calls:

- **Coffee shop brief**: Suggests "launch" (explicit "grand opening") rather than "promotion" (alternative reading).
- **Fashion brief**: Explicitly states "launching" but doesn't mention other channels; Instagram feed is the reasonable primary channel.
- **Wellness brief**: Message about "transformasi" (transformation) could be read as awareness OR promotion; expected as "promotion" because it emphasizes member acquisition.

## Scoring Methodology

### Field-Level Comparison

The evaluator compares these fields:

| Field | Comparison Method | Tolerance |
|-------|-------------------|-----------|
| `objective` | Exact string match | None |
| `industry_id` | Exact string match | None |
| `visual_type_id` | Exact string match | None |
| `country` (blend) | Same presence, primary role, and numerical tolerance | ±0.15 per country |
| `platform.channel` | Exact string match | None |
| `platform.aspect_ratio_id` | Exact string match | None |
| `audience` | Language-aware semantic categories | ≥30% expected categories |

### Country Blend Tolerance

Country blends allow **±0.15 per country** because:
- The Brief Interpreter extracts "influences" from conversational text, not precise specifications
- A client saying "Indonesia with a touch of Japan" reasonably maps to 0.75/0.25, but 0.7/0.3 or 0.8/0.2 are also defensible
- Tolerance prevents penalizing the model for reasonable rounding

Country presence is still required: an expected secondary country cannot be omitted. The primary country must remain the highest-weight country, so swapping primary and secondary roles fails even when the same countries are present.

### Audience Comparison

Audience is compared **semantically** because:
- Clients express audience in different words (e.g., "young professionals" vs. "millennials and Gen Z")
- Exact prose matching is inappropriate
- Common Indonesian and English aliases are normalized into deterministic categories, including `anak muda`/`young people`, `perempuan muda`/`young women`, `pemilik bisnis`/`business owners`, and `profesional muda`/`young professionals`.
- Common age-group, gender, and demographic descriptions are also recognized.
- At least 30% of expected semantic categories must be present; no additional model or network call is used.

Example: Expected "urban women aged 20–45" vs. Actual "women interested in skincare, 20–50 demographic" → ~50% term overlap → **match**.

## Completeness Metrics

The evaluation tracks:

- **`completeness_score`**: Andala's deterministic completeness calculation (blocking fields, derivable fields, confidence threshold)
- **`ready`**: Boolean; true when no blocking fields are missing
- **`confidence_summary`**: Per-field confidence from the model

A brief with `ready: false` cannot proceed to design because at least one blocking field is missing. It is excluded from field accuracy, but remains visible with its readiness state and completeness score.

### Evaluation Denominators

The summary reports `total briefs`, `eligible briefs`, and `excluded briefs`. Readiness exclusions are reported separately from failed model calls. Each field reports `matches/evaluated`, where `evaluated` is the number of eligible briefs with a non-null expected value for that field. A nullable expected value represents an intentional ambiguity and is excluded from that field's denominator rather than rewritten to inflate accuracy.

## Token and Cost Metrics

The evaluation reports:

| Metric | Unit | Purpose |
|--------|------|---------|
| `input_tokens` | Tokens | Size of the prompt sent to Gemini |
| `output_tokens` | Tokens | Size of Gemini's JSON response |
| `estimated_cost_usd` | USD | Cost estimate based on Gemini pricing |
| `model_calls` | Count | Number of API calls (1 = first attempt, 2 = first + repair) |

Costs are estimated using rates as of **2026-09-04**:
- Flash Lite: $0.25M input, $1.50M output

## Cost Cap and Safety

The evaluation enforces a **maximum of 20 model calls per run**:
- 10 briefs × 2 calls per brief (initial + repair if needed)

If any brief fails to establish an API connection, the cost cap prevents cascading retries. A provider failure (timeout, rate limit, API error) stops that brief but allows the evaluation to continue.

## Interpretation of Results

### Success Cases

A brief is **successful** when:
1. The API call succeeds
2. The response validates against the schema
3. A `NormalizedBrief` object is returned

Success does NOT mean the extracted values are correct — accuracy is measured by field-level comparison.

### Failure Cases

A brief is **failed** when:
1. The API call itself fails (network error, auth error, rate limit)
2. The response is invalid JSON
3. The JSON fails schema validation and cannot be repaired

Failed briefs are reported but do NOT stop the evaluation.

### Field Accuracy Interpretation

- **100% field accuracy**: All fields matched expected values
- **80% field accuracy**: One field mismatched (e.g., wrong industry)
- **Partial accuracy**: Some fields correct, others incorrect

A brief can be **successful but inaccurate** (API call worked, but extracted the wrong industry).

### Repair Cases

When the model's response fails schema validation, the Brief Interpreter automatically retries with a repair instruction. A brief marked `was_repaired: true` required this retry.

High repair rates suggest:
- The prompt may be unclear
- The model may be inventing fields
- The schema may be too strict for some brief styles

## Not Measured

This evaluation explicitly does NOT measure:

- **Statistical confidence**: 10 briefs cannot support claims about accuracy on all Indonesian briefs
- **Reproducibility**: Different random seeds or model versions may produce different results
- **Latency**: API response times are recorded but not analyzed
- **User satisfaction**: No human has reviewed whether the extracted briefing is actually useful to a designer

## Automated Test Behavior

The automated test suite (`pnpm test`) includes deterministic offline tests for:
- Country blend comparison logic
- Audience term-overlap calculation
- Metrics aggregation
- Report shape validation

**Automated tests do NOT contact Gemini.** They use pure functions and mock data.

The live evaluation (`pnpm evaluate:briefs`) is a manual developer command and is NOT run in CI.

## How to Use the Report

### For Developers

1. **Run the evaluation**: `pnpm evaluate:briefs`
2. **Review stdout**: Scan for failed calls or mismatched fields
3. **Examine `reports/real-brief-evaluation.json`**: Details for each brief
4. **Identify patterns**: Do all SaaS briefs fail on industry extraction? Do all B2B briefs require repair?
5. **File issues**: "Brief Interpreter misidentifies TechSaaS briefs as 'retail'" → investigate prompt

### For Designers

1. **Field accuracy**: If accuracy is <80%, the model may not yet be ready to process your client briefs
2. **Completeness**: If <50% of briefs are ready, clients are often missing key information
3. **Cost**: If cost per brief is >$0.01, consider using a smaller model

### For Product

1. **Quality gates**: Decide if 80% field accuracy is acceptable before shipping
2. **Cost modeling**: Use token averages to estimate production costs
3. **Repair rates**: If >30% of briefs require repair, the prompt needs tuning

## Limitations

1. **Scale**: 10 briefs cannot represent all possible Indonesian client briefs
2. **Bias**: These briefs skew toward Andala's current clients (SaaS, property, F&B); they do not represent niche industries
3. **Snapshot**: Results depend on the specific Gemini model version; upgrading models will change results
4. **Confidence**: "Semantic" audience comparison is itself subjective; two reviewers might disagree on term overlap
5. **Expectations**: The expected labels represent one human's judgment, not ground truth

## Future Work

- Expand to 50+ briefs covering more industries and edge cases
- Add structured human review (designer + PM agreement on expected labels)
- Benchmark against other models (Anthropic, OpenAI)
- Track performance over time as models are updated
- Correlate extraction accuracy with downstream design quality
