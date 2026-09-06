# ADR 0004 — Artifacts are immutable, version-pinned and content-hashed

**Status:** accepted (P0) · **correction loops implemented (P6)** · **Layout Blueprint added (P2.10)** · **Visual Generation foundation added (P2.11)** — see `docs/correction-engine.md`, `docs/layout-blueprint.md` and `docs/visual-generation-integration.md`

## Context
A project must remain readable years later, after schemas and datasets have moved on. Correction
loops (P6) produce many derived versions of the same design.

## Decision
Every artifact carries `schema_version`, `dataset_version`, `created_by` and a content hash, and is
deep-frozen on creation. Revisions create new artifacts referencing their parent; nothing is ever
mutated. Brand data is **snapshotted into** the contract rather than referenced by id.

The hash covers the contract body only — id and timestamp are excluded — so "same brief in, same
contract out" is a testable property rather than an aspiration.

## Consequences
- The read path will need upcasters (registered in `types/versions.ts`, empty at P0) rather than
  destructive migrations.
- Storage grows. Irrelevant at this scale.
- Determinism is testable, and it is tested for all three golden briefs.
- Brand changes never retroactively alter old projects.

## P6 — Correction Engine
Implemented as designed: a correction (`engine/correction/apply.ts`) never mutates the parent
recipe. It produces a new derived recipe with `derived_from = parent.id`, a fresh id / timestamp /
hash, deep-frozen. A DKV correction additionally derives a new contract and direction (same
candidate, re-tuned band). Anything that would move a locked anchor or a structural field is
rejected as `redesign` — no recipe is produced. The bounded patch surface is the DKV parameters
plus colour saturation, imagery realism, materiality texture and ornament; movement, layout,
composition, concept, objective and core message are out of reach by construction.

## P2.10 — Layout Blueprint
The Layout Blueprint (`engine/blueprint/resolve.ts` → `resolveLayoutBlueprint`) is another
artifact of exactly this kind, and needs no new architecture terminology.

It is a **derived, read-only structural projection** of a finished
`DesignContract → DesignDirection → DesignRecipe` plus the resolved `VisualType` and
`LayoutSystem`. It carries `schema_version`, `resolver_version`, `dataset_version` and an 8-char
`blueprint_hash = fnv1a(canonicalise(body))` (id/hash excluded from the body, same rule as the
recipe), and is deep-frozen on creation.

- It **never mutates** the recipe, and it holds no design number the recipe did not already
  resolve. Every value is tagged `structural` (copied verbatim), `derived` (computed by documented
  deterministic arithmetic — geometry, roles, layering, waypoints), or `unassessed` (listed in
  `blueprint.unassessed`).
- It is **not authoritative**: the recipe decides the visual strategy; the blueprint only
  visualises the spatial consequences. The prompt compiler is unchanged and still owns translation
  to generator language.
- Determinism is a testable property: same recipe + same `dataset_version` + same
  `resolver_version` ⇒ byte-identical blueprint and hash. `Math.random`, `Date` and model calls are
  forbidden by the existing `engine/**` lint boundary.
- The resolver **does not silently repair** invalid input. A recipe/contract/direction id
  mismatch, a missing dataset reference, an empty zone set or a geometry overflow produces an
  explicit `BlueprintIssue` (P0/P1/P2) — fatal conditions return `err([...])`, advisory ones ride
  on `blueprint.issues`.
- No image, no vision model, no render is required or produced.

No new dataset (ADR 0002 stands). No new engine rule for the design core (ADR 0006 stands — the
blueprint is arithmetic over resolved artifacts). No LLM (ADR 0007 stands).

## P2.11 — Visual Generation
Two more artifacts of this kind wrap a **non-deterministic** image API without letting anything
around it drift.

- **`GenerationRequest`** (`engine/generation/request.ts` → `buildGenerationRequest`) — the
  normalised instruction sent to a provider. Pure and deterministic: built from an
  already-resolved recipe, its (optional) blueprint and the compiled prompt set. It carries
  `schema_version`, `generation_request_version`, a full `provenance` block (recipe id + hash,
  contract, direction, concept ref, blueprint hash, prompt-compiler version, prompt hash,
  P2.7 adapter id, dataset version) and an 8-char `request_hash = fnv1a(canonicalise(body))`.
  Same inputs ⇒ byte-identical request and hash. It makes no design decision — the adapter, the
  prompt strings and every parameter were resolved upstream.
- **`GeneratedArtifact`** — the immutable record of one generation call, deep-frozen. It is
  traceable end to end and never stores the image bytes — only `image.delivery` +
  `image.reference` (a short opaque handle). `artifact_hash` identifies the generation
  *envelope* (provenance + provider + model + adapter + image spec + cost basis + seed), not the
  pixels; `artifact_id` is fresh per call. Provider metadata, run metadata and a
  `GenerationCostRecord` (with an explicit `pricing_basis`, never presented as an invoice) ride
  alongside.

The provider is reached only through `VisualGenerationPort` (`ports/visual-generation.port.ts`),
mirroring the LLM boundary: `engine/**`, the prompt compiler, the critic, the correction engine,
the recipe engine and the blueprint engine contain no provider import (enforced by the
`engine/**` lint boundary and `tests/lint/boundary.test.ts`). A provider-independent client
(`adapters/visual-generation/client.ts`) books a cost-ledger event for every call — on success
and on failure, before the result is decided — never retries, and never turns a provider failure
into an artifact. Generation is an **explicit downstream action** (`services/generation.service.ts`)
and is never triggered by `runRecipePipeline` or `runCorrectionPipeline`.

No live image API is called: this milestone ships the port, the schemas, the deterministic
request builder and a **fake adapter** (`adapters/visual-generation/fake.ts`) that returns a
schema-valid artifact with `delivery: "none"` and `pricing_basis: "test-fixture"`. No object
storage, no database, no persistence, no new dependency.
