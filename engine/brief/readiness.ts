import type { BriefExtraction } from "./extraction";
import type { DatasetRegistry } from "../../types/datasets";

/**
 * Three-state readiness model per docs/readiness-policy.md.
 *
 * `evaluateReadiness` is the single authoritative readiness policy for the
 * whole brief pipeline. `normalizeBrief` and `progressiveBriefing` both defer
 * to its verdict rather than deciding usability on their own terms — see
 * docs/readiness-policy.md, "Single Source of Truth".
 */

export const READINESS_STATUSES = ["READY", "NEEDS_CLARIFICATION", "INVALID"] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

/**
 * The fields a NormalizedBrief cannot be built without. This is the one
 * definition of "required field" in the pipeline — `engine/brief/completeness.ts`
 * imports it rather than keeping its own copy, and `normalizeBrief` gates
 * brief construction on `evaluateReadiness(...).status === "READY"`, which is
 * defined entirely in terms of this list.
 */
export const BLOCKING_FIELDS = [
  "objective",
  "industry_id",
  "visual_type_id",
  "platform.channel",
  "platform.aspect_ratio_id",
  "audience.description",
  "country"
] as const;

/** A single deterministic clarification question. */
export type ClarificationQuestion = {
  readonly field: string;
  readonly question: string;
};

/** The result of readiness evaluation. */
export type ReadinessResult = {
  readonly status: ReadinessStatus;
  readonly blocking_fields: readonly string[];
  readonly missing_fields: readonly string[];
  readonly derived_fields: readonly string[];
  readonly questions: readonly ClarificationQuestion[];
  readonly reason?: string;
  /** When status is INVALID, the specific contradiction or issue. */
  readonly error?: string;
};

/**
 * Evidence tracking for safe inference.
 * Used internally to decide when a field can be inferred.
 */
type FieldEvidence = {
  present: boolean;
  value: unknown;
  confidence: number;
  raw?: string;
};

/**
 * A fixed-shape record, not a generic `Record<string, FieldEvidence>` — under
 * `noUncheckedIndexedAccess` a generic index signature would type every read
 * as `FieldEvidence | undefined`, forcing null-checks for keys that are
 * always populated below. Fixed keys give the compiler what it needs instead.
 */
type Evidence = {
  objective: FieldEvidence;
  industry_id: FieldEvidence;
  visual_type_id: FieldEvidence;
  "platform.channel": FieldEvidence;
  "platform.aspect_ratio_id": FieldEvidence;
  "audience.description": FieldEvidence;
  country: FieldEvidence;
};

/**
 * Extract field evidence from extraction for readiness evaluation.
 */
function readFieldEvidence(extraction: BriefExtraction): Evidence {
  return {
    objective: {
      present: extraction.objective.value !== null,
      value: extraction.objective.value,
      confidence: extraction.objective.confidence
    },

    industry_id: {
      present: extraction.industry_id.value !== null,
      value: extraction.industry_id.value,
      confidence: extraction.industry_id.confidence
    },

    visual_type_id: {
      present: extraction.visual_type_id.value !== null,
      value: extraction.visual_type_id.value,
      confidence: extraction.visual_type_id.confidence
    },

    "platform.channel": {
      present: extraction.platform.channel.value !== null,
      value: extraction.platform.channel.value,
      confidence: extraction.platform.channel.confidence
    },

    "platform.aspect_ratio_id": {
      present: extraction.platform.aspect_ratio_id.value !== null,
      value: extraction.platform.aspect_ratio_id.value,
      confidence: extraction.platform.aspect_ratio_id.confidence
    },

    "audience.description": {
      present: extraction.audience.description.value !== null,
      value: extraction.audience.description.value,
      confidence: extraction.audience.description.confidence
    },

    country: {
      present: extraction.countries.length > 0,
      value: extraction.countries,
      confidence: extraction.countries.length > 0
        ? Math.min(...extraction.countries.map((c) => c.confidence))
        : 0
    }
  };
}

/**
 * Reference data for the channel-specific default ratio a client could be
 * offered. Not currently wired into an automatic default: the ids here
 * (e.g. "4-5") are not guaranteed to match a loaded visual type's actual
 * aspect ratio ids (e.g. "portrait"), so applying one silently could produce
 * a brief that fails downstream resolution despite being marked READY.
 * Until that mapping is dataset-validated, a missing ratio is asked about
 * instead of defaulted — see the "Ratio exception" question below.
 */
export const ASPECT_RATIO_BY_CHANNEL: Record<string, string> = {
  "instagram-feed": "4-5",
  "instagram-story": "9-16",
  tiktok: "9-16",
  "facebook-feed": "4-5",
  "linkedin-feed": "4-5",
  web: "4-5",
  print: "a4-portrait",
  ooh: "16-9"
};

/**
 * Determine if a channel infers to a unique aspect ratio.
 * Returns null if multiple ratios are possible.
 */
function inferAspectRatio(channel: string): string | null {
  return ASPECT_RATIO_BY_CHANNEL[channel] ?? null;
}

/**
 * Evaluate readiness of a brief extraction against the policy.
 *
 * This is the single authoritative readiness decision for the pipeline: every
 * field in BLOCKING_FIELDS must be present for READY, full stop. Nothing else
 * in the codebase may independently decide a brief is or isn't usable.
 *
 * Returns one of:
 * - READY: every field in BLOCKING_FIELDS is present (explicit or safely
 *   inferred during extraction)
 * - NEEDS_CLARIFICATION: understandable but needs small targeted questions
 * - INVALID: contradictory, structurally unusable, or unsafe even after clarification
 */
export function evaluateReadiness(
  extraction: BriefExtraction,
  // Accepted for API symmetry with normalizeBrief's other calls and for
  // forward-compatibility with dataset-aware inference; not read yet.
  _datasets?: DatasetRegistry
): ReadinessResult {
  const evidence = readFieldEvidence(extraction);
  const missing: string[] = [];
  const derived: string[] = [];
  const questions: ClarificationQuestion[] = [];

  // Check explicit contradictions
  if (extraction.contradictions && extraction.contradictions.length > 0) {
    return {
      status: "INVALID",
      blocking_fields: [],
      missing_fields: [],
      derived_fields: [],
      questions: [],
      error: `Brief contains contradictions: ${extraction.contradictions.join("; ")}`
    };
  }

  // 1. OBJECTIVE: Must be explicit — non-negotiable
  // Per policy: "A concrete action such as 'grand opening' or 'grow member base' is explicit."
  const hasObjective = evidence["objective"].present;
  if (!hasObjective) {
    missing.push("objective");
    questions.push({
      field: "objective",
      question:
        "Tujuan utama materi ini apa: memperkenalkan sesuatu yang baru, meningkatkan awareness, atau mendorong orang untuk membeli/mendaftar?"
    });
  }

  // 2. AUDIENCE DESCRIPTION: Must be explicit — strategic input, not a demographic guess
  // Per policy: "The brief must identify who the work is for in a usable human description."
  const hasAudience = evidence["audience.description"].present;
  if (!hasAudience) {
    missing.push("audience.description");
    questions.push({
      field: "audience.description",
      question: "Siapa orang utama yang ingin dijangkau oleh materi ini?"
    });
  }

  // 3. PLATFORM.CHANNEL: Safe to infer when one primary channel is clear
  // Per policy: "When several channels are named, infer the primary channel only
  // when that interpretation is unambiguous."
  let resolvedChannel: string | null = null;
  const hasExplicitChannel = evidence["platform.channel"].present;
  if (hasExplicitChannel) {
    resolvedChannel = evidence["platform.channel"].value as string;
  } else {
    missing.push("platform.channel");
    // Only ask about channel if we already have objective
    // (asking about everything at once is user-hostile)
    if (hasObjective) {
      questions.push({
        field: "platform.channel",
        question:
          "Materi ini akan dipakai terutama di Instagram Feed, Story/Reels, Facebook, atau channel lain?"
      });
    }
  }

  // 4. COUNTRY: Safe to infer from location or market evidence
  // Per policy: "Infer from an explicit location, market, language+market combination,
  // or named local audience. Do not infer merely from a person name, generic language,
  // or an aesthetic stereotype."
  const hasCountry = evidence["country"].present;
  if (!hasCountry) {
    missing.push("country");
    questions.push({
      field: "country",
      question: "Materi ini ditujukan untuk pasar atau negara mana?"
    });
  }

  // 5. INDUSTRY: Safe to infer from named product/service/venue/organization
  // Per policy: "Industry can normally be inferred from the named product, service, venue,
  // or organization... The inference must map to a loaded industry vocabulary" and the
  // interpreter "should ask when the offer ... cannot be distinguished safely."
  //
  // The LLM has already attempted this inference and returned null: the brief's
  // subject maps to no loaded industry vocabulary. That is a genuine
  // clarification case, not a silent-inference one — normalization has no
  // industry-inference step of its own, so without a question here the brief
  // would reach NEEDS_CLARIFICATION with nothing to ask and the pipeline would
  // report it as a generic error. A blocking field that is missing always gets
  // a question (see docs/readiness-policy.md, "Deterministic Clarification
  // Questions").
  if (!evidence["industry_id"].present) {
    missing.push("industry_id");
    questions.push({
      field: "industry_id",
      question:
        "Materi ini untuk jenis usaha atau kegiatan seperti apa — misalnya kuliner, fashion, properti, teknologi, atau hospitality?"
    });
  }

  // 6. VISUAL_TYPE: Safe to infer from requested deliverable and channel
  // Per policy: "'Konten untuk Instagram feed' supports a social-feed visual type...
  // The interpreter should infer the least-committal type." When the interpreter
  // could not settle on one, ask the policy's "Output" question rather than
  // leaving a blocking field unresolved with no question attached.
  if (!evidence["visual_type_id"].present) {
    missing.push("visual_type_id");
    questions.push({
      field: "visual_type_id",
      question:
        "Output utamanya berupa apa: satu post feed, konten story/reels, atau format lain?"
    });
  }

  // 7. PLATFORM.ASPECT_RATIO: Can have safe default from channel
  // Per policy: "Use an explicit ratio when provided. Otherwise... use the deterministic
  // channel default: e.g., Instagram Feed defaults to portrait 4:5, while Story defaults to 9:16."
  const hasExplicitRatio = evidence["platform.aspect_ratio_id"].present;
  if (!hasExplicitRatio) {
    missing.push("platform.aspect_ratio_id");
    // Ask only once the channel itself is resolved — asking about ratio
    // before channel is settled would be premature (policy: minimum
    // questions only). See ASPECT_RATIO_BY_CHANNEL for why this is a
    // question rather than a silent default.
    if (resolvedChannel && inferAspectRatio(resolvedChannel)) {
      questions.push({
        field: "platform.aspect_ratio_id",
        question: "Untuk penempatan ini, apakah harus 4:5, square, atau ukuran lain?"
      });
    }
  }

  // Determine final status based on policy rules
  // ============================================
  //
  // READY requires every field in BLOCKING_FIELDS to be resolved. This is the
  // one predicate that decides usability: `missing` above is built entirely
  // from BLOCKING_FIELDS checks, so "nothing missing" and "READY" are the same
  // condition by construction — there is no second, independent check here.
  const sortedMissing = [...missing].sort();
  const sortedDerived = [...derived].sort();

  if (sortedMissing.length > 0) {
    return {
      status: "NEEDS_CLARIFICATION",
      blocking_fields: sortedMissing,
      missing_fields: sortedMissing,
      derived_fields: sortedDerived,
      questions,
      reason:
        questions.length > 0
          ? questions.length === 1
            ? "One required field needs clarification"
            : `${questions.length} required fields need clarification`
          : "Missing one or more required fields"
    };
  }

  // All required fields are present and consistent: READY
  return {
    status: "READY",
    blocking_fields: [],
    missing_fields: [],
    derived_fields: sortedDerived,
    questions: [],
    reason: "All required fields are present and consistent"
  };
}
