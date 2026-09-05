# Readiness Policy

**Status:** ✅ Implemented in P2.3.2e — single authoritative gate as of the P2.3.2e unification

## Single Source of Truth

**`evaluateReadiness()` (in `engine/brief/readiness.ts`) is the single authoritative readiness
policy for the whole brief pipeline.** No other function decides, independently, whether a brief
is usable:

- `normalizeBrief()` (`engine/brief/normalize.ts`) calls `evaluateReadiness()` once and builds a
  `NormalizedBrief` if and only if the result is `status: "READY"`. It no longer has its own
  gate.
- `progressiveBriefing()` (`engine/brief/progressive-briefing.ts`) does not call
  `evaluateReadiness()` at all — it forwards the `readiness` and `brief` that `normalizeBrief()`
  already computed. There is exactly one readiness evaluation per call.
- `checkCompleteness()` (`engine/brief/completeness.ts`) is diagnostics only: its `blocking_fields`
  and `ready` are read directly from `evaluateReadiness()`, not recomputed. It still reports a
  0–1 completeness score and low-confidence fields, which `evaluateReadiness()` does not, but it
  cannot disagree with the readiness verdict — there is one blocking-field list
  (`BLOCKING_FIELDS`, defined once in `readiness.ts` and re-exported from `completeness.ts` for
  backward compatibility), not two.

Before this unification, `normalizeBrief()` gated on its own field-presence check while
`progressiveBriefing()` gated separately on `evaluateReadiness()`. The two agreed whenever a
brief was missing a required field, but diverged on contradictions: a brief with every blocking
field present but a reported contradiction would pass the old field-presence gate and produce a
`NormalizedBrief`, which `progressiveBriefing()` then had to notice and discard. That divergence
is what this unification removes — see `tests/unit/readiness-unification.test.ts`.

A related latent gap was fixed at the same time: the old "aspect ratio can default from channel"
path (`ASPECT_RATIO_BY_CHANNEL`) could mark a brief `READY` even when the aspect ratio was
never actually filled in, because the default ids it produced (e.g. `"4-5"`) do not match any
loaded visual type's real aspect ratio ids (e.g. `"portrait"`). A missing aspect ratio is now a
`NEEDS_CLARIFICATION` case (the "Ratio exception" question below) rather than a silent default,
so `READY` always means a `NormalizedBrief` can actually be built — see the "Platform aspect
ratio" classification below.

## Implementation Status (P2.3.2e)

This policy has been fully implemented with the following components:

### Core Implementation

- **Readiness Evaluation** (`engine/brief/readiness.ts`): The single authoritative policy. Evaluates extraction and returns one of three states (READY, NEEDS_CLARIFICATION, INVALID); also owns `BLOCKING_FIELDS`, the one definition of "required field" in the pipeline.
- **Normalization gate** (`engine/brief/normalize.ts`): Calls `evaluateReadiness()` and builds the `NormalizedBrief` only on READY. Has no independent gate of its own.
- **Progressive Briefing** (`engine/brief/progressive-briefing.ts`): Forwards the readiness result `normalizeBrief()` already computed; does not re-evaluate readiness.
- **Completeness diagnostics** (`engine/brief/completeness.ts`): Reports a score and low-confidence fields for observability; sources `blocking_fields` and `ready` from `evaluateReadiness()`.
- **Clarification Question Generation**: Deterministic, ordered questions in plain Indonesian per policy section below

### Three-State Model

```typescript
type ReadinessStatus = "READY" | "NEEDS_CLARIFICATION" | "INVALID";

type ReadinessResult = {
  status: ReadinessStatus;
  blocking_fields: readonly string[];
  missing_fields: readonly string[];
  derived_fields: readonly string[];
  questions: readonly ClarificationQuestion[];
  reason?: string;
  error?: string;
};

type ClarificationQuestion = {
  field: string;
  question: string; // Plain Indonesian, client-friendly
};
```

### API Usage

```typescript
// Import the progressive briefing layer
import { progressiveBriefing, formatClarificationRequest } from "@/engine";

// Step 1: Normalize and evaluate readiness
const result = await progressiveBriefing({
  rawBrief: "Buat poster grand opening coffee shop...",
  projectId: "proj_123",
  datasets,
  llm,
  ids
});

if (!result.ok) {
  // Handle LLM error
  console.error(result.error);
}

// Step 2: Check readiness status
const { readiness, brief, extraction } = result.value;

if (readiness.status === "READY") {
  // Use the brief immediately
  console.log("Brief is ready:", brief);
} else if (readiness.status === "NEEDS_CLARIFICATION") {
  // Ask the user for clarification
  const questions = formatClarificationRequest(readiness);
  console.log(questions); // Formatted for UI
  
  // After user answers, append to brief and re-normalize
  const enhancedBrief = appendClarificationAnswers(
    originalBrief,
    { channel: "Instagram Feed", country: "Indonesia" }
  );
  
  // Re-run progressiveBriefing with the enhanced brief
  const retryResult = await progressiveBriefing({
    ...input,
    rawBrief: enhancedBrief
  });
} else if (readiness.status === "INVALID") {
  // Reject the brief with error message
  console.error("Brief is invalid:", readiness.error);
}
```

### Tests

- **Readiness Evaluation** (`tests/unit/readiness.test.ts`): 19 tests covering all three states, safe inference, question generation
- **Progressive Briefing** (`tests/unit/progressive-briefing.test.ts`): 13 tests covering formatting, answer appending, LLM integration against the real `normalizeBrief()` → `progressiveBriefing()` path
- **Gate unification** (`tests/unit/readiness-unification.test.ts`): 20 tests proving `evaluateReadiness()` is authoritative — `normalizeBrief()` and `progressiveBriefing()` agree on every fixture, `checkCompleteness()` never disagrees with `evaluateReadiness()`, and the contradiction-with-all-fields-present case (the bug the old dual gate allowed) is now correctly rejected
- All tests pass offline with no live Gemini calls

## Purpose

Readiness answers a narrower question than completeness:

> Can the engine make a defensible design direction from this brief, or does it need one small answer from the client?

The client should be able to describe the work naturally. The interpreter may extract and safely infer ordinary context, but it must not silently invent a business objective, target audience, or cultural direction.

The seven fields in "Policy Table for All Seven Current Blockers" below are `BLOCKING_FIELDS`,
defined once in `engine/brief/readiness.ts`. `evaluateReadiness()` requires every one of them to
be present for `READY`; this is not a proposal awaiting a separate implementation task — it is
the actual gate `normalizeBrief()` uses.

## Classification Rules

The classifications below describe the normal policy for a field. A field classified as inferable can still trigger clarification when the source contains competing or weak signals. A default is allowed only when it is deterministic, conventional for the resolved context, and does not hide a contradiction.

### 1. Current Blocking Fields

#### Objective: **A. MUST BE EXPLICIT**

The brief must state what the communication is meant to achieve: for example, launch, awareness, promotion, consideration, or membership growth. A concrete action such as "grand opening" or "grow member base" is explicit even when it is conversational rather than labelled as an objective.

Objective controls the communication job and downstream concept scoring. If it is wrong, the design can optimize for attention when the client needs conversion, or for launch excitement when the client needs long-term trust. The AI employee cannot safely proceed without an explicit objective or a direct answer to one short question.

#### Industry: **B. SAFE TO INFER**

The industry can normally be inferred from the named product, service, venue, or organization: a coffee shop is F&B, a Pilates studio is wellness, and a residential development is property. The inference must map to a loaded industry vocabulary and be supported by the brief, not by a stereotype.

Since P2.8, a deterministic layer (`engine/brief/classify.ts`, `docs/smart-brief-classification.md`)
runs between extraction and readiness. When the model returns `industry_id: null` but the brief
text contains an unambiguous curated alias for exactly one canonical industry above
`HIGH_CONFIDENCE` (e.g. "coffee shop" → `fnb`), the classifier fills the canonical id and records
a traceable diagnostic. Weak, ambiguous, or absent evidence still leaves `null`, and readiness
asks the industry question as before. The classifier never invents an id and is not a second
gate — `evaluateReadiness` still decides.

Industry selects relevant language, constraints, and concept space. A wrong industry can produce inappropriate references, claims, or visual conventions. The AI employee may proceed when one industry is clearly supported; it should ask when the offer spans multiple industries or cannot be distinguished safely. When the interpreter returns no industry at all — the brief's subject (e.g. a community arts event) maps to nothing in the loaded industry vocabulary — that is a clarification case with a question, not a silent inference and not a generic error.

#### Visual type: **B. SAFE TO INFER**

Visual type can usually be inferred from the requested deliverable and channel. "Konten untuk Instagram feed" supports a social-feed visual type; a presentation deck, landing page, or editorial spread would point elsewhere. The interpreter should infer the least-committal type supported by the request.

Visual type controls the available layout recipes and deliverable structure. A wrong choice can make a usable idea impossible to produce in the requested format. The AI employee may proceed from a clear deliverable; it should clarify when the brief only says "make a campaign" or names incompatible output types.

#### Platform channel: **B. SAFE TO INFER**

A named channel is explicit evidence. When several channels are named, the primary channel may be inferred from wording such as "utama", "fokus", or the first stated output only when that interpretation is unambiguous. A single-channel brief can proceed without a separate platform question.

Channel affects viewing context, attention assumptions, and suitable composition. A wrong channel changes how the work is consumed. Ask only when channels have equal priority and materially different design requirements, such as Instagram Feed versus Story, or when no channel can be recovered.

#### Platform aspect ratio: **D. CAN HAVE SAFE DEFAULT (policy) — currently implemented as a question**

Use an explicit ratio when provided. Otherwise, once a real channel-to-ratio default exists that
is validated against the loaded visual type's actual aspect ratios, use it automatically. Today,
`engine/brief/readiness.ts` does not apply an automatic default: `ASPECT_RATIO_BY_CHANNEL` records
what a plausible channel default would be (e.g. Instagram Feed → 4:5), but those ids are not
guaranteed to match any loaded visual type's real aspect ratio ids (e.g. `"portrait"`,
`"square"`), so applying one silently could mark a brief READY without it actually being
buildable. Until that mapping is dataset-validated, a missing ratio triggers the "Ratio exception"
clarification question below instead of a silent default.

Aspect ratio affects composition and production dimensions, but usually not the communication strategy. A wrong default causes rework rather than a fundamentally unsafe design decision. Once the dataset-aware default exists, it may be applied automatically, provided the default is shown in the normalized output and can be overridden.

#### Audience description: **A. MUST BE EXPLICIT**

The brief must identify who the work is for in a usable human description. It does not need a demographic form: "wanita profesional yang peduli kesehatan" or "anak muda yang suka kopi specialty" is enough. Age, gender, income, or sophistication may remain unknown unless they are decision-critical.

Audience controls tone, relevance, claims, and the interpretation of cultural or lifestyle cues. An invented audience is a high-risk strategic error. The AI employee can proceed from a clear audience description; it must ask when the brief names only a product or a vague phrase such as "everyone".

#### Country: **B. SAFE TO INFER**

Infer the primary country from an explicit location, market, language-plus-market combination, or named local audience. "Studio ... di Jakarta" supports Indonesia. Do not infer a country merely from a person name, generic language, or an aesthetic stereotype.

Country influences the cultural blend and local relevance of design decisions. A wrong country can create cultural misrepresentation or unsuitable references. Proceed when one country is strongly supported; clarify when the market is international, location and target market disagree, or no reliable country cue exists.

### 2. Additional Fields

| Field | Required? | Inferable? | Clarify? | Default? | Reason |
|---|---|---|---|---|---|
| `core_message` | No | Yes | Only if the message itself is contradictory | No fixed default | A concise message can be derived from an explicit objective, offer, and audience. It is useful for concept generation but does not decide whether the brief is usable. |
| `deliverables` | No | Yes | Only when the requested outputs conflict | Yes, from visual type + channel + ratio | The engine can derive a first deliverable from the resolved output context. Ask only when production scope, count, or channels materially differ. |
| `brand_id` | No | Yes, only when an existing brand is unambiguously named | When multiple brands or an unknown brand are named | No | Brand identity improves consistency, but a new or unnamed brand can still receive a direction. Never attach an existing brand profile based on a similar name. |
| `country blend` | No | Partly | When multiple countries are presented as equal markets or the intended influence is unclear | Primary country only; no invented secondary blend | A local setting can establish the primary country. Secondary cultural influence must be explicit; it must not be manufactured from style words such as "Japanese vibe" without client intent. |
| `audience sophistication` | No | Yes, weakly and conservatively | Only when the requested positioning depends on it | Neutral midpoint | Language such as "high-end", "design-conscious", or "professional" can support a directional estimate. It must not be treated as a hard demographic fact. |
| `price sensitivity` | No | Yes, weakly from price and offer cues | When pricing or value positioning is central and contradictory | Neutral midpoint | Stated price, discounting, premium positioning, and "budget" language can guide a cautious estimate. Do not infer willingness to pay from income stereotypes. |

`brand_id` is the policy name for a future stable brand reference. The current extraction model uses `brand_name`; this document does not change that schema.

## Policy Table for All Seven Current Blockers

| Field | Required? | Inferable? | Clarify? | Default? | Reason |
|---|---|---|---|---|---|
| `objective` | Yes | No, unless the source states an equivalent action in natural language | Yes, if absent, ambiguous, or contradictory | No | The communication job must be client-grounded. |
| `industry_id` | Yes | Yes, from the offer and context | Only if more than one industry is plausible | No | Domain can usually be mapped deterministically from the brief. |
| `visual_type_id` | Yes | Yes, from deliverable and channel | Only if output type is missing or conflicting | No fixed type | Output context is often apparent from ordinary client language. |
| `platform.channel` | Yes | Yes, when one primary channel is clear | Yes, when no channel or equal-priority channels are given | No | Channel changes viewing and composition assumptions. |
| `platform.aspect_ratio_id` | No after policy resolution | Yes, from an explicit ratio or channel | Only for a hard placement conflict | Yes, channel-specific | A conventional ratio is reversible and low-risk. |
| `audience.description` | Yes | No, beyond paraphrasing evidence in the brief | Yes, when no usable audience is stated | No | Audience is strategic input, not a safe demographic guess. |
| `country` | Yes | Yes, from location or market evidence | Yes, when evidence is absent or contradictory | No | Cultural context must be grounded in the brief. |

"Required" means required after interpretation and safe inference, not necessarily literally typed by the client. A required field may be filled by a defensible inference; it must never be filled by an arbitrary default.

## Three-State Readiness Model

### READY

A brief is `READY` when:

- objective and audience are grounded in the source text;
- industry, visual type, channel, and primary country are explicit or safely inferred;
- aspect ratio is explicit or receives an allowed channel default;
- all resolved values are internally consistent and accepted by the deterministic data vocabulary; and
- normalization can produce a valid brief without inventing a strategic decision.

Ready does not mean every field is known. Optional fields, soft audience attributes, brand identity, secondary cultural influence, and exact deliverable counts may remain absent.

### NEEDS_CLARIFICATION

A brief is `NEEDS_CLARIFICATION` when it is understandable enough to ask a small, targeted question, but one or more decision-critical inputs cannot be resolved safely. The result should contain a deterministic ordered list of questions, each tied to a missing or ambiguous field.

This state is preferable to rejecting a useful brief or presenting a large form. Once the user answers, the raw brief and answer should be normalized again and rechecked.

Typical triggers are:

- no clear objective;
- no usable audience description;
- no reliable country or market;
- two equally important channels with different layouts;
- an ambiguous visual output; or
- a contradiction that may be resolved by the client's intent rather than by a parser.

### INVALID

A brief is `INVALID` when it is contradictory, structurally unusable, or unsafe to interpret even after a normal clarification question. Examples include mutually exclusive hard requirements with no possible output, an impossible or malformed production constraint, or an explicit request for a design direction that violates a non-negotiable safety or domain constraint.

An invalid brief should explain the conflict plainly. It should not be converted into `NEEDS_CLARIFICATION` merely to keep the workflow moving. A contradiction that a client can resolve, such as "Instagram Feed and Story, which one is primary?", remains `NEEDS_CLARIFICATION`.

## Deterministic Clarification Questions

Questions are generated in a stable order and only for unresolved decision-critical fields.
**Every blocking field that is missing gets a question** — a `NEEDS_CLARIFICATION` verdict never
carries an empty question list. (Before P2.7 debugging, `industry_id` and `visual_type_id` were
the exception: missing but never asked about, on the assumption that normalization would infer
them. It does not, so a brief whose subject mapped to no loaded industry became a questionless
`NEEDS_CLARIFICATION` that the pipeline could only surface as a generic error.)

1. **Objective:** "Tujuan utama materi ini apa: memperkenalkan sesuatu yang baru, meningkatkan awareness, atau mendorong orang untuk membeli/mendaftar?"
2. **Audience:** "Siapa orang utama yang ingin dijangkau oleh materi ini?"
3. **Industry:** "Materi ini untuk jenis usaha atau kegiatan seperti apa — misalnya kuliner, fashion, properti, teknologi, atau hospitality?" (only when the interpreter could not map the brief's subject to a loaded industry)
4. **Channel:** "Materi ini akan dipakai terutama di Instagram Feed, Story/Reels, Facebook, atau channel lain?"
5. **Output:** "Output utamanya berupa apa: satu post feed, konten story/reels, atau format lain?"
6. **Country/market:** "Materi ini ditujukan untuk pasar atau negara mana?"
7. **Ratio exception:** "Untuk penempatan ini, apakah harus 4:5, square, atau ukuran lain?"

The engine should omit questions whose answers are already explicit or safely inferred. It should combine compatible questions into one natural sentence rather than expose internal field names. It should not ask about `core_message`, sophistication, price sensitivity, or country blend unless a specific design decision genuinely depends on them.

## Progressive Briefing Flow

```text
RAW BRIEF
  |
  v
INTERPRET
  |
  v
SAFE INFERENCE
  |
  v
READINESS CHECK
  |-----------------------------|
  |                             |
READY                 NEEDS_CLARIFICATION
  |                             |
  v                             v
DESIGN DIRECTION       ASK MINIMUM QUESTIONS
                                |
                                v
                           USER ANSWER
                                |
                                v
                         NORMALIZE AGAIN
                                |
                                v
                              READY
```

The user should never be asked to complete a large creative brief form. The interpreter does the low-risk work; the user answers only the smallest unresolved business question.

## Example Dialogues

### Coffee Shop Brief

**Client:**

> Jadi kami buka coffee shop di Solo, namanya Kopiko Craft. Lokasi strategis, target audience anak muda yang suka kopi specialty. Butuh konten untuk Instagram feed, format 4:5 atau square, untuk launching awal bulan. Vibe-nya modern, tetap ada sentuhan budaya Indonesia, kombinasi estetika Jepang juga boleh. Ada grand opening sale untuk 100 pengunjung pertama.

**Interpretation:** Objective is launch with a supporting opening promotion; industry is F&B; audience is young specialty-coffee drinkers; channel is Instagram Feed; country is Indonesia from Solo; Japan is an optional explicit influence, not a replacement for the primary country. Use 4:5 as the Instagram Feed default because the client accepts it.

**AI employee:**

> Saya sudah menangkap tujuan utamanya: memperkenalkan pembukaan Kopiko Craft di Solo dan menarik pengunjung awal. Materi akan dibuat untuk Instagram Feed dengan ukuran 4:5. Apakah tujuan yang paling penting adalah membangun awareness tentang coffee shop baru ini, atau mendorong 100 pengunjung pertama datang untuk promo grand opening?

This question is optional only if the client has already made the priority clear. It is shown here because the brief contains two plausible objectives: launch awareness and immediate promotion.

### VYNE Pilates Brief

**Client:**

> Studio Pilates VYNE di Jakarta ingin menambah member. Sekarang ada 50 member aktif, targetnya 150 dalam tiga bulan. Kelas untuk semua level, fokus flexibility dan core strength. Targetnya wanita profesional usia 25-55 yang peduli kesehatan. Konten di Instagram dan Facebook, dengan class footage, testimonial member, dan tips.

**Interpretation:** Industry is wellness; audience is usable; country is Indonesia from Jakarta; growth/member acquisition is explicit; Instagram and Facebook are both named. The unresolved issue is primary channel, because Feed, Story, and Facebook placements may need different compositions.

**AI employee:**

> Saya sudah menangkap bahwa tujuan utamanya adalah menambah member VYNE dari 50 menjadi 150 dalam tiga bulan. Konten ini akan dipakai terutama di Instagram atau Facebook? Dan apakah prioritas formatnya Feed 4:5, Story/Reels 9:16, atau keduanya?

If the client answers "Instagram Feed, 4:5", the engine should proceed without asking about core message, audience sophistication, price sensitivity, or an exact deliverable list. It may derive a working message such as improving strength and wellbeing through accessible Pilates, while keeping that message visibly derived rather than client-quoted.

## Implementation Examples (P2.3.2e)

### Example 1: Coffee Shop → READY

**Input:**
```
Jadi kami buka coffee shop di Solo, namanya Kopiko Craft. Lokasi strategis, target audience 
anak muda yang suka kopi specialty. Butuh konten untuk Instagram feed, format 4:5 atau square, 
untuk launching awal bulan. Vibe-nya modern, tetap ada sentuhan budaya Indonesia, kombinasi 
estetika Jepang juga boleh. Ada grand opening sale untuk 100 pengunjung pertama.
```

**Readiness Result:**
```json
{
  "status": "READY",
  "blocking_fields": [],
  "missing_fields": ["movement_id", "brand_id"],
  "derived_fields": [
    "platform.aspect_ratio_id = \"4-5\" (channel \"instagram-feed\" default)",
    "platform.viewing_context = \"thumb\" (from channel \"instagram-feed\")",
    "audience.attention_context = \"scroll\" (from channel \"instagram-feed\")"
  ],
  "questions": [],
  "reason": "All required fields are present and consistent"
}
```

**Extracted Values:**
- objective: "launch" (explicit: grand opening)
- audience.description: "anak muda yang suka kopi specialty" (explicit)
- industry_id: "fnb" (inferred: coffee shop)
- visual_type_id: "social-feed" (inferred: Instagram feed)
- platform.channel: "instagram-feed" (explicit)
- platform.aspect_ratio_id: "4-5" (explicit choice, or channel default)
- country: { "indonesia": 1.0 } (inferred: Solo)

### Example 2: Ambiguous Studio → NEEDS_CLARIFICATION

**Input:**
```
Kami punya studio di Jakarta yang baru. Target market bisa dari berbagai kalangan.
Butuh materi marketing untuk sosial media dan offline.
```

**Readiness Result:**
```json
{
  "status": "NEEDS_CLARIFICATION",
  "blocking_fields": ["objective", "audience.description", "platform.channel"],
  "missing_fields": ["objective", "audience.description", "platform.channel"],
  "derived_fields": ["country"],
  "questions": [
    {
      "field": "objective",
      "question": "Tujuan utama materi ini apa: memperkenalkan sesuatu yang baru, meningkatkan awareness, atau mendorong orang untuk membeli/mendaftar?"
    },
    {
      "field": "audience.description",
      "question": "Siapa orang utama yang ingin dijangkau oleh materi ini?"
    },
    {
      "field": "platform.channel",
      "question": "Materi ini akan dipakai terutama di Instagram Feed, Story/Reels, Facebook, atau channel lain?"
    }
  ],
  "reason": "3 required fields need clarification"
}
```

**User's Response:**
```
Tujuannya awareness untuk mempromosikan studio kami yang baru kepada profesional muda
yang peduli dengan wellness. Materi utamanya untuk Instagram Feed.
```

**Enhanced Brief:**
```
Kami punya studio di Jakarta yang baru. Target market bisa dari berbagai kalangan.
Butuh materi marketing untuk sosial media dan offline.

Tujuannya awareness untuk mempromosikan studio kami yang baru kepada profesional muda
yang peduli dengan wellness. Materi utamanya untuk Instagram Feed.
```

**After Re-normalization → READY**

### Example 3: Contradictory Requirements → INVALID

**Input:**
```
Buat design untuk satu post Instagram yang juga harus bisa di-print ukuran 1 meter x 2 meter
untuk billboard di tepi jalan, tapi harus tetap bisa dibaca di thumbnail ukuran 100 pixel.
Semua harus ada dalam satu file, tanpa ada kompromi pada visual quality.
```

**Readiness Result:**
```json
{
  "status": "INVALID",
  "blocking_fields": [],
  "missing_fields": [],
  "derived_fields": [],
  "questions": [],
  "error": "Brief contains contradictions: mutually exclusive output requirements (Instagram Feed thumbnail vs. 1m x 2m billboard)",
  "reason": "Structurally unusable"
}
```

## Implementation Notes

### Key Differences from Completeness

- **Completeness** (`checkCompleteness()`) is diagnostics: a 0–1 score and low-confidence fields, for reporting only. It does not decide anything — its `ready` and `blocking_fields` are read from `evaluateReadiness()`.
- **Readiness** (`evaluateReadiness()`) is the single authoritative policy that decides whether a brief is actionable (P2.3 concern), including the INVALID/contradiction case completeness never checked.
- A brief with missing optional fields can still be READY
- Low-confidence fields don't automatically trigger clarification—policy rules do

### Safe Inference Decisions

Per policy section "Classification Rules":
- **Objective, Audience:** Always require explicit text (never inferred)
- **Industry:** Inferred from business type (coffee shop → fnb, studio → wellness, etc.)
- **Visual Type:** Inferred from channel + deliverable description
- **Channel:** Inferred when one primary channel is unambiguous
- **Aspect Ratio:** Policy target is a channel default (deterministic, reversible); current implementation asks a clarification question instead until the default is dataset-validated (see "Platform aspect ratio" above)
- **Country:** Inferred from location mention + market context

### No Live Gemini Calls in Readiness

The readiness evaluation is 100% deterministic and runs after extraction:

```
EXTRACTION (calls Gemini once) → READINESS (pure function) → questions or brief
```

This ensures readiness evaluation never triggers additional LLM calls or dependencies.

## Recommendation for Implementation

✅ **COMPLETE** — The following has been implemented:

1. ✅ Preserve the current extraction and normalization contracts
2. ✅ Add a deterministic policy evaluation result with `READY`, `NEEDS_CLARIFICATION`, and `INVALID`
3. ✅ Record evidence and whether each resolved value was explicit, inferred, or defaulted
4. ✅ Generate the ordered minimum clarification questions from unresolved fields
5. ✅ Support re-run of normalization after answers are appended to the raw brief
6. ✅ Add offline tests for coffee shop, VYNE Pilates, missing-objective, ambiguous-channel, contradictory cases

The implementation includes:
- `engine/brief/readiness.ts` — core evaluation logic
- `engine/brief/progressive-briefing.ts` — integration layer + user helpers
- `tests/unit/readiness.test.ts` — 19 tests, all passing
- `tests/unit/progressive-briefing.test.ts` — 13 tests, all passing
- Full API exports in `engine/index.ts`

No production behavior for existing briefs has changed. The readiness layer is additional, non-breaking, and fully compatible with P1/P2.2 design rules.
