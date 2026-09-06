# Visual Generation Integration Foundation

`DesignRecipe (+ LayoutBlueprint) → PromptCompiler → GenerationRequest → VisualGenerationPort → GeneratedArtifact`.

P2.11 builds the smallest safe production seam for turning a resolved design into a generated
visual, **without** coupling the core system to a live image-generation workflow. It ships the
port, the schemas, a deterministic request builder and a fake adapter. No live image API is
called.

## The layer is an execution boundary

The hierarchy is unchanged:

```
Human creative intent → Design intelligence → DesignRecipe → LayoutBlueprint
  → PromptCompiler → Generation Adapter → External image model → Generated visual → Human / Critic review
```

The generation layer **must not** invent a layout, typography hierarchy, brand strategy or
cultural interpretation, and it never modifies the recipe, the blueprint or the prompt compiler
output. Every decision arrives fixed on the request.

## Provider neutrality

```
services/generation.service.ts
        ↓
ports/visual-generation.port.ts   (VisualGenerationPort — a capability, not a provider)
        ↓
adapters/visual-generation/client.ts   (provider-independent: cost, error mapping, artifact assembly)
        ↓
adapters/visual-generation/fake.ts   (the only adapter today — a RawGenerationCall)
        ↓
(future) a real provider adapter — a sibling RawGenerationCall, changing nothing else
```

`engine/**`, the prompt compiler, the critic, the correction engine, the recipe engine and the
blueprint engine contain **no provider import** — enforced by `eslint.config.mjs` and
`tests/lint/boundary.test.ts`.

## Determinism

The image API is non-deterministic (the pixels differ run to run). Everything around it is
deterministic:

| deterministic | how |
|---|---|
| request normalisation | `buildGenerationRequest` is pure — no clock, no RNG, no I/O |
| prompt hash | `fnv1a(canonicalise({ prompt, negative_prompt, language }))` |
| request hash | `fnv1a(canonicalise(request body without request_hash))` |
| provenance | copied verbatim from resolved artifacts |
| adapter selection | `promptSet.visualCharacter.id` — the P2.7 taxonomy, already resolved |
| config serialisation | a closed `GenerationConfig` shape, always the same key order |
| cost accounting | one ledger event per call, booked before the result |

> Same recipe + same blueprint + same prompt set + same config + same dataset version ⇒
> byte-identical `GenerationRequest` and `request_hash`.

The **generated image itself is not claimed to be deterministic.**

## Provenance

Every `GeneratedArtifact` answers "which exact design decisions produced this visual?" from its
`provenance` block alone:

```
recipe_id, recipe_hash, contract_id, direction_id, concept_ref,
blueprint_id, blueprint_hash,
prompt_compiler_version, prompt_language, prompt_hash,
adapter_id, generation_request_version, dataset_version
```

plus top-level `provider`, `model`, `adapter_id`, `request_hash`.

`artifact_hash` is the hash of the generation **envelope** (provenance + provider + model +
adapter + image spec + cost basis + seed) — not the pixels. Two calls of the same request against
the same provider/model with the same seed share `artifact_hash`; `artifact_id` is fresh per
call and identifies the specific generation event.

## Image storage

None. `image.delivery` is one of `none | base64-ref | url | provider-ref` and `image.reference`
is a short opaque handle — never the bytes. Object storage, a database, a CDN and persistence are
out of scope for this milestone. A provider that returns base64 or a temporary URL keeps that
detail inside its adapter.

## Cost accounting

Generation reuses the existing `CostLedgerPort`. `CostEvent.stage` gains one member,
`"visual_generate"`; a generation event carries `input_tokens: 0` / `output_tokens: 0` (images
are not token-priced) and an explicit `estimated_cost_usd` from the provider. The
provider-independent client records the event **before** returning, on success and on failure.
The fake adapter uses explicit test cost only (`pricing_basis: "test-fixture"`); no production
price is hardcoded as fact.

## Error handling

`VisualGenerationPort.generate` returns `Result<GeneratedArtifact, GenerationIssue[]>`. Failure
classes: `not_configured`, `configuration_error`, `provider_unavailable`, `authentication_error`,
`rate_limited`, `content_rejected`, `malformed_request`, `timeout`, `unknown_provider_error`.
A failure is never retried and never turned into a successful artifact.

## Pipeline separation

`runVisualGeneration` (`services/generation.service.ts`) is an **explicit downstream action**. It
is not called by `runRecipePipeline` or `runCorrectionPipeline`. Recipe creation and visual
generation are separate operations — for cost control, human approval, regeneration and provider
switching.

## What P2.11 does NOT add

No live image API, no real provider adapter, no computer vision, no image understanding, no
database, no persistence, no job queue, no retry framework, no batch orchestration, no export
system, no Generate UI, no dependency. A real provider adapter is the next milestone.
