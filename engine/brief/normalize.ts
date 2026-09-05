import type { DatasetRegistry } from "../../types/datasets";
import type { NormalizedBrief } from "../../types/schemas/brief.schema";
import { NormalizedBrief as NormalizedBriefSchema } from "../../types/schemas/brief.schema";
import { SCHEMA_VERSIONS } from "../../types/versions";
import type { IdPort } from "../../ports/id.port";
import type { LlmCallMeta, LlmIssue, LlmPort } from "../../ports/llm.port";
import { llmIssue } from "../../ports/llm.port";
import { err, ok, type Result } from "../util/result";
import { buildExtractionSchema, type BriefExtraction } from "./extraction";
import {
  BRIEF_NORMALIZER_SYSTEM,
  BRIEF_NORMALIZER_TEMPLATE_VERSION,
  buildBriefNormalizerPrompt
} from "./prompts/brief-normalizer";
import { sanitizeExtraction } from "./sanitize";
import { classifyBrief, type ClassificationDiagnostic } from "./classify";
import { checkCompleteness, type CompletenessReport } from "./completeness";
import { evaluateReadiness, type ReadinessResult } from "./readiness";

/**
 * The Brief Interpreter.
 *
 * This is the only place in the engine that touches a language model, and it
 * does so through a port: the file imports no provider, no SDK and no network
 * call. Swapping Gemini for Anthropic changes nothing here.
 *
 * The division of labour is strict. The model reads Indonesian and reports
 * what the text says. Everything after that — defaults, derivations,
 * completeness, and the entire P1 pipeline downstream — is deterministic code.
 * The model never returns a DKV parameter, a score, or a design decision.
 *
 * Usability is decided in exactly one place: `evaluateReadiness` (see
 * ./readiness.ts). A NormalizedBrief is built if and only if that call
 * returns `status: "READY"`. `checkCompleteness` still runs and is returned
 * for diagnostics — score, low-confidence fields — but does not gate anything.
 */

/**
 * Deterministic derivations.
 *
 * These are business rules, not guesses: a feed post is viewed at thumbnail
 * distance while scrolling, and that follows from the channel rather than from
 * anything the client has to say. Each one is recorded in `derived` so a
 * reviewer can see which values the client actually stated.
 */
export const VIEWING_CONTEXT_BY_CHANNEL: Record<string, "thumb" | "arm" | "room" | "street"> = {
  "instagram-feed": "thumb",
  "instagram-story": "thumb",
  tiktok: "thumb",
  "facebook-feed": "thumb",
  "linkedin-feed": "arm",
  web: "arm",
  print: "arm",
  ooh: "street"
};

export const ATTENTION_BY_CHANNEL: Record<string, "scroll" | "search" | "dwell" | "captive"> = {
  "instagram-feed": "scroll",
  "instagram-story": "scroll",
  tiktok: "scroll",
  "facebook-feed": "scroll",
  "linkedin-feed": "search",
  web: "dwell",
  print: "dwell",
  ooh: "captive"
};

/** Neutral midpoint, used only when the brief says nothing and flagged when it does. */
export const NEUTRAL_RATIO = 0.5;
/** Widest defensible adult range; never presented as if the client stated it. */
export const DEFAULT_AGE_RANGE: [number, number] = [18, 65];

export type BriefNormalizationOutcome = {
  readonly extraction: BriefExtraction;
  /**
   * How `industry_id` and `audience.description` were resolved — explicit,
   * inferred from a deterministic alias (with confidence and the brief text
   * that drove it), or left unresolved. Traceable diagnostics only; the
   * classifier fills `extraction` before readiness runs, it does not gate.
   */
  readonly classifications: readonly ClassificationDiagnostic[];
  /** Diagnostics only — score and low-confidence fields. Does not gate `brief`. */
  readonly completeness: CompletenessReport;
  /** The authoritative usability verdict. `brief` is non-null iff this is READY. */
  readonly readiness: ReadinessResult;
  readonly brief: NormalizedBrief | null;
  /** Sanitisation findings, including possible fabrications. */
  readonly warnings: readonly string[];
  /** Values the engine supplied rather than the client stating them. */
  readonly derived: readonly string[];
  readonly meta: LlmCallMeta;
};

export type NormalizeBriefInput = {
  readonly rawBrief: string;
  readonly projectId: string;
  readonly datasets: DatasetRegistry;
  readonly llm: LlmPort;
  readonly ids: IdPort;
  /** Supplied separately: brand identity is not something to extract from prose. */
  readonly brandId?: string | null;
};

export async function normalizeBrief(
  input: NormalizeBriefInput
): Promise<Result<BriefNormalizationOutcome, LlmIssue[]>> {
  const trimmed = input.rawBrief.trim();
  if (trimmed.length === 0) {
    return err([llmIssue("empty_response", "the brief is empty", 0)]);
  }

  const schema = buildExtractionSchema(input.datasets);
  const prompt = buildBriefNormalizerPrompt(trimmed, input.datasets);

  const response = await input.llm.generateStructured(schema, prompt, {
    projectId: input.projectId,
    stage: "brief_normalize",
    templateVersion: BRIEF_NORMALIZER_TEMPLATE_VERSION,
    system: BRIEF_NORMALIZER_SYSTEM
  });

  if (!response.ok) return err(response.error);

  const { extraction: sanitized, warnings } = sanitizeExtraction(response.value.value, trimmed);
  const { extraction, diagnostics: classifications } = classifyBrief(
    sanitized,
    trimmed,
    input.datasets
  );
  const readiness = evaluateReadiness(extraction, input.datasets);
  const completeness = checkCompleteness(extraction);
  const derived: string[] = [];

  const brief =
    readiness.status === "READY"
      ? buildNormalizedBrief({
          extraction,
          completeness,
          rawBrief: trimmed,
          briefId: input.ids.next("brief"),
          brandId: input.brandId ?? null,
          datasets: input.datasets,
          derived
        })
      : null;

  return ok({
    extraction,
    classifications,
    completeness,
    readiness,
    brief,
    warnings,
    derived,
    meta: response.value.meta
  });
}

/**
 * Extraction → NormalizedBrief.
 *
 * Only called once completeness has confirmed nothing blocking is missing, so
 * the non-null assertions below are guarded by that check rather than by hope.
 */
function buildNormalizedBrief(input: {
  extraction: BriefExtraction;
  completeness: CompletenessReport;
  rawBrief: string;
  briefId: string;
  brandId: string | null;
  datasets: DatasetRegistry;
  derived: string[];
}): NormalizedBrief | null {
  const { extraction, derived } = input;

  const channel = extraction.platform.channel.value!;
  const objective = extraction.objective.value!;
  const visualTypeId = extraction.visual_type_id.value!;
  const aspectRatioId = extraction.platform.aspect_ratio_id.value!;

  let viewingContext = extraction.platform.viewing_context.value;
  if (viewingContext === null) {
    viewingContext = VIEWING_CONTEXT_BY_CHANNEL[channel] ?? "arm";
    derived.push(`platform.viewing_context = "${viewingContext}" (from channel "${channel}")`);
  }

  let attention = extraction.audience.attention_context.value;
  if (attention === null) {
    attention = ATTENTION_BY_CHANNEL[channel] ?? "dwell";
    derived.push(`audience.attention_context = "${attention}" (from channel "${channel}")`);
  }

  const ageMin = extraction.audience.age_min.value;
  const ageMax = extraction.audience.age_max.value;
  let ageRange: [number, number];
  if (ageMin !== null && ageMax !== null) {
    ageRange = [ageMin, ageMax];
  } else {
    ageRange = DEFAULT_AGE_RANGE;
    derived.push(`audience.age_range = ${JSON.stringify(ageRange)} (not stated in the brief)`);
  }

  let sophistication = extraction.audience.sophistication.value;
  if (sophistication === null) {
    sophistication = NEUTRAL_RATIO;
    derived.push(`audience.sophistication = ${NEUTRAL_RATIO} (neutral, not stated)`);
  }

  let priceSensitivity = extraction.audience.price_sensitivity.value;
  if (priceSensitivity === null) {
    priceSensitivity = NEUTRAL_RATIO;
    derived.push(`audience.price_sensitivity = ${NEUTRAL_RATIO} (neutral, not stated)`);
  }

  let deliverables = extraction.deliverables;
  if (deliverables.length === 0) {
    const visualType = input.datasets.visualTypes.get(visualTypeId);
    const ratio = visualType?.aspect_ratios.find((entry) => entry.id === aspectRatioId);
    const label = ratio ? `${ratio.width}:${ratio.height}` : aspectRatioId;
    deliverables = [`One ${label} ${visualType?.name ?? visualTypeId} asset`];
    derived.push(`deliverables = ${JSON.stringify(deliverables)} (from visual type and ratio)`);
  }

  const country = Object.fromEntries(
    extraction.countries.map((entry) => [entry.id, entry.weight])
  );

  let coreMessage = extraction.core_message.value;
  if (coreMessage === null) {
    coreMessage = `${objective} communication for ${extraction.audience.description.value!}`;
    derived.push(`core_message = ${JSON.stringify(coreMessage)} (derived from objective and audience)`);
  }

  const confidence: Record<string, number> = {
    objective: extraction.objective.confidence,
    core_message: extraction.core_message.confidence,
    industry_id: extraction.industry_id.confidence,
    visual_type_id: extraction.visual_type_id.confidence,
    "platform.channel": extraction.platform.channel.confidence,
    "platform.aspect_ratio_id": extraction.platform.aspect_ratio_id.confidence,
    "platform.viewing_context": extraction.platform.viewing_context.value === null
      ? 0
      : extraction.platform.viewing_context.confidence,
    "audience.description": extraction.audience.description.confidence,
    "audience.attention_context": extraction.audience.attention_context.value === null
      ? 0
      : extraction.audience.attention_context.confidence,
    "audience.sophistication": extraction.audience.sophistication.value === null
      ? 0
      : extraction.audience.sophistication.confidence,
    "audience.price_sensitivity": extraction.audience.price_sensitivity.value === null
      ? 0
      : extraction.audience.price_sensitivity.confidence,
    movement_id: extraction.movement_id.value === null ? 0 : extraction.movement_id.confidence,
    country:
      extraction.countries.length > 0
        ? Math.min(...extraction.countries.map((entry) => entry.confidence))
        : 0
  };

  const candidate = {
    brief_id: input.briefId,
    schema_version: SCHEMA_VERSIONS.brief,
    raw_input: input.rawBrief,
    objective,
    core_message: coreMessage,
    audience: {
      description: extraction.audience.description.value!,
      age_range: ageRange,
      sophistication,
      price_sensitivity: priceSensitivity,
      attention_context: attention,
      cultural_context: extraction.audience.cultural_context
    },
    industry_id: extraction.industry_id.value!,
    brand_id: input.brandId,
    visual_type_id: visualTypeId,
    country,
    movement_id: extraction.movement_id.value,
    layout_id: null,
    platform: {
      channel,
      aspect_ratio_id: aspectRatioId,
      viewing_context: viewingContext,
      localised_text: true
    },
    deliverables,
    mandatories: extraction.mandatories,
    prohibitions: extraction.prohibitions,
    confidence,
    missing_fields: [...input.completeness.missing_fields]
  };

  const validated = NormalizedBriefSchema.safeParse(candidate);
  return validated.success ? validated.data : null;
}
