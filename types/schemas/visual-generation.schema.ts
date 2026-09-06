import { z } from "zod";
import { DatasetVersion, Id, IsoDate, NonEmptyText, Note, SemVer, Slug } from "../primitives";

/**
 * The P2.7 visual-generation adapter taxonomy, restated here so `types/` stays
 * self-contained (it never imports from `engine/`). A boundary test asserts
 * this list is byte-identical to `engine/prompt/visual-adapter/types.ts`.
 */
export const VISUAL_GENERATION_ADAPTER_IDS = [
  "photorealistic",
  "fashion-editorial",
  "product-photography",
  "cinematic",
  "graphic-poster",
  "illustration"
] as const;

/**
 * Visual Generation — P2.11.
 *
 * Two deterministic, content-hashed artifacts around a non-deterministic image
 * API:
 *
 *   - `GenerationRequest`  — the normalised instruction sent to a provider.
 *     Built by the pure engine from an already-resolved recipe + (optional)
 *     blueprint + compiled prompt set. Carries no design decision of its own;
 *     every value is copied or hashed from an upstream artifact.
 *
 *   - `GeneratedArtifact`  — the immutable record of one generation call. It is
 *     traceable end to end: recipe id + hash, blueprint hash where applicable,
 *     prompt hash, request hash, compiler version, adapter, provider, model.
 *     It NEVER stores the image bytes — only a provider reference.
 *
 * See `docs/visual-generation-integration.md` and ADR 0004 (§ P2.11).
 */

const AdapterId = z.enum(VISUAL_GENERATION_ADAPTER_IDS);
const Hash8 = z.string().length(8);
const Orientation = z.enum(["portrait", "landscape", "square"]);

// --- request ----------------------------------------------------------

export const GenerationTarget = z
  .object({
    visual_type_id: Slug,
    channel: NonEmptyText,
    aspect_ratio_id: Slug,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    orientation: Orientation
  })
  .strict();
export type GenerationTarget = z.infer<typeof GenerationTarget>;

/** Deterministic, serialised the same way every time. No secrets, no free text. */
export const GenerationConfig = z
  .object({
    /** Which compiled tier the provider should render. */
    prompt_tier: z.enum(["master", "image-only", "design-layout"]),
    prompt_language: z.enum(["en", "id"]),
    /** Reproducibility hint. Honoured only if the provider supports it; never fabricated. */
    seed: z.number().int().nullable(),
    /** How many candidates to request. One, unless a caller explicitly asks for more. */
    candidate_count: z.number().int().min(1).max(4)
  })
  .strict();
export type GenerationConfig = z.infer<typeof GenerationConfig>;

export const GenerationProvenance = z
  .object({
    recipe_id: Id,
    recipe_hash: Hash8,
    contract_id: Id,
    direction_id: Id,
    concept_ref: Id.nullable(),
    blueprint_id: Id.nullable(),
    blueprint_hash: Hash8.nullable(),
    /** The prompt compiler / renderer version that produced the prompt strings. */
    prompt_compiler_version: SemVer,
    prompt_language: z.enum(["en", "id"]),
    /** fnv1a over the compiled prompt strings actually sent. */
    prompt_hash: Hash8,
    /** The P2.7 adapter selected from resolved recipe signals. */
    adapter_id: AdapterId,
    generation_request_version: SemVer,
    dataset_version: DatasetVersion
  })
  .strict();
export type GenerationProvenance = z.infer<typeof GenerationProvenance>;

export const GenerationRequest = z
  .object({
    schema_version: SemVer,
    generation_request_version: SemVer,
    /** The full design provenance this request carries. */
    provenance: GenerationProvenance,
    target: GenerationTarget,
    config: GenerationConfig,
    /** The exact strings a provider is asked to render — copied from the PromptSet. */
    prompt: NonEmptyText,
    negative_prompt: z.string(),
    /** fnv1a(canonicalise(body without request_hash)). Deterministic. */
    request_hash: Hash8
  })
  .strict();
export type GenerationRequest = z.infer<typeof GenerationRequest>;

// --- artifact --------------------------------------------------------

export const GeneratedImageMeta = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    aspect_ratio_id: Slug,
    mime_type: NonEmptyText,
    /** How the provider returned the image. Never the bytes. */
    delivery: z.enum(["none", "base64-ref", "url", "provider-ref"]),
    /** A short opaque handle when `delivery !== "none"`; never image data. */
    reference: z.string().nullable()
  })
  .strict()
  .superRefine((meta, ctx) => {
    if (meta.delivery === "none" && meta.reference !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "delivery 'none' must carry a null reference" });
    }
  });
export type GeneratedImageMeta = z.infer<typeof GeneratedImageMeta>;

export const GenerationRunMeta = z
  .object({
    latency_ms: z.number().min(0),
    seed: z.number().int().nullable(),
    provider_request_id: z.string().nullable(),
    finish_reason: z.string().nullable(),
    safety: z.string().nullable()
  })
  .strict();
export type GenerationRunMeta = z.infer<typeof GenerationRunMeta>;

export const GenerationCostRecord = z
  .object({
    currency: z.literal("USD"),
    estimated_cost_usd: z.number().min(0),
    image_cost_usd: z.number().min(0).nullable(),
    input_cost_usd: z.number().min(0).nullable(),
    pricing_basis: z.enum(["provider-reported", "estimated", "test-fixture"])
  })
  .strict();
export type GenerationCostRecord = z.infer<typeof GenerationCostRecord>;

export const GeneratedArtifact = z
  .object({
    schema_version: SemVer,
    artifact_id: Id,
    /**
     * fnv1a over the generation ENVELOPE (provenance + provider + model +
     * adapter + image spec + cost basis + seed) — NOT the pixels. Two calls of
     * the same request against the same provider/model with the same seed share
     * this hash even though the images differ. Volatile fields
     * (`artifact_id`, `created_at`, latency, provider request id) are excluded.
     */
    artifact_hash: Hash8,
    /** Always "generated". A failed call returns `err([...])`, never an artifact. */
    status: z.literal("generated"),
    created_at: IsoDate,

    provenance: GenerationProvenance,
    request_hash: Hash8,

    provider: NonEmptyText,
    model: NonEmptyText,
    adapter_id: AdapterId,

    image: GeneratedImageMeta,
    run: GenerationRunMeta,
    cost: GenerationCostRecord,

    /** Free-text traceability, e.g. the fixture or brief name. Never a secret. */
    note: Note.nullable().default(null)
  })
  .strict();
export type GeneratedArtifact = z.infer<typeof GeneratedArtifact>;
