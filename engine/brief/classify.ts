import type { BriefExtraction } from "./extraction";
import type { DatasetRegistry } from "../../types/datasets";

/**
 * Smart Brief Classification (P2.8).
 *
 * A deterministic layer that sits between `sanitizeExtraction` and
 * `evaluateReadiness` in `normalizeBrief`. It exists for one reason: a client
 * writes "coffee shop", "kedai kopi" or "brand skincare" and the language model
 * — constrained to the loaded industry enum — sometimes returns `industry_id:
 * null` rather than the canonical id. That is a vocabulary gap, not a genuine
 * ambiguity, and asking the client "what kind of business is this?" when they
 * already said "coffee shop" is the wrong outcome.
 *
 * What this layer is NOT:
 * - It never invents an industry id. It only ever writes a value that is
 *   already a key in `datasets.industries`.
 * - It is not a second readiness gate. `evaluateReadiness` remains the single
 *   authority; this layer only fills a canonical value it can defend, and
 *   records why. When it cannot defend one, it leaves `null` and readiness asks.
 * - It makes no design decision and touches no field the downstream pipeline
 *   scores against beyond `industry_id` and `audience.description`.
 *
 * The alias tables are curated Indonesian/English phrasings mapped to canonical
 * ids with a per-phrase confidence. Only a match at or above
 * `HIGH_CONFIDENCE`, with exactly one candidate industry, is allowed to satisfy
 * a blocking field. Everything weaker is surfaced as a diagnostic and left for
 * clarification — see docs/smart-brief-classification.md.
 */

/** Above this, a single-candidate alias match may satisfy a blocking field. */
export const HIGH_CONFIDENCE = 0.85;

export const CLASSIFICATION_SOURCES = ["explicit", "alias", "unresolved"] as const;
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];

/**
 * A traceable record of how one field was resolved (or why it was not).
 *
 * The (source, value, confidence) triple distinguishes the four states the
 * policy requires:
 * - explicit:            source "explicit", value non-null
 * - inferred, high conf: source "alias",    value non-null, confidence >= HIGH_CONFIDENCE
 * - inferred, low conf:  source "alias",    value null,     confidence  < HIGH_CONFIDENCE
 * - unresolved:          source "unresolved", value null
 */
export type ClassificationDiagnostic = {
  readonly field: "industry_id" | "audience.description";
  readonly value: string | null;
  readonly source: ClassificationSource;
  readonly confidence: number;
  /** The brief text that drove the classification, when there is any. */
  readonly evidence: string | null;
};

export type BriefClassification = {
  readonly extraction: BriefExtraction;
  readonly diagnostics: readonly ClassificationDiagnostic[];
};

type IndustryAlias = {
  readonly industry_id: string;
  readonly phrase: string;
  readonly confidence: number;
};

/**
 * Curated phrasings mapped to canonical industry ids.
 *
 * Every `industry_id` here MUST be a real key in `data/industries/`. The
 * `classifyBrief` guard drops any entry whose id is not loaded, so a future
 * taxonomy change cannot make this table lie, but keep it honest anyway.
 *
 * Confidence is per phrase: an unambiguous category word ("coffee shop",
 * "real estate") sits high; a word that only usually implies the category
 * ("salon", "villa") sits below HIGH_CONFIDENCE so it is reported but never
 * silently satisfies the blocking field.
 */
export const INDUSTRY_ALIASES: readonly IndustryAlias[] = [
  // --- Food & Beverage -------------------------------------------------------
  { industry_id: "fnb", phrase: "coffee shop", confidence: 0.95 },
  { industry_id: "fnb", phrase: "coffeeshop", confidence: 0.95 },
  { industry_id: "fnb", phrase: "kedai kopi", confidence: 0.95 },
  { industry_id: "fnb", phrase: "kopi susu", confidence: 0.9 },
  { industry_id: "fnb", phrase: "kafe", confidence: 0.9 },
  { industry_id: "fnb", phrase: "cafe", confidence: 0.9 },
  { industry_id: "fnb", phrase: "restoran", confidence: 0.93 },
  { industry_id: "fnb", phrase: "restaurant", confidence: 0.93 },
  { industry_id: "fnb", phrase: "rumah makan", confidence: 0.92 },
  { industry_id: "fnb", phrase: "warung makan", confidence: 0.9 },
  { industry_id: "fnb", phrase: "katering", confidence: 0.9 },
  { industry_id: "fnb", phrase: "catering", confidence: 0.9 },
  { industry_id: "fnb", phrase: "bakery", confidence: 0.9 },
  { industry_id: "fnb", phrase: "kuliner", confidence: 0.87 },
  { industry_id: "fnb", phrase: "makanan dan minuman", confidence: 0.92 },
  { industry_id: "fnb", phrase: "food and beverage", confidence: 0.95 },
  { industry_id: "fnb", phrase: "f b", confidence: 0.9 },
  { industry_id: "fnb", phrase: "eatery", confidence: 0.9 },
  { industry_id: "fnb", phrase: "gerai minuman", confidence: 0.88 },
  { industry_id: "fnb", phrase: "brand minuman", confidence: 0.85 },

  // --- Fashion -------------------------------------------------------------
  { industry_id: "fashion", phrase: "fashion", confidence: 0.95 },
  { industry_id: "fashion", phrase: "clothing line", confidence: 0.93 },
  { industry_id: "fashion", phrase: "clothing brand", confidence: 0.93 },
  { industry_id: "fashion", phrase: "apparel", confidence: 0.92 },
  { industry_id: "fashion", phrase: "streetwear", confidence: 0.92 },
  { industry_id: "fashion", phrase: "label busana", confidence: 0.92 },
  { industry_id: "fashion", phrase: "brand pakaian", confidence: 0.9 },
  { industry_id: "fashion", phrase: "brand fashion", confidence: 0.95 },
  { industry_id: "fashion", phrase: "busana", confidence: 0.88 },
  { industry_id: "fashion", phrase: "butik", confidence: 0.9 },
  { industry_id: "fashion", phrase: "boutique", confidence: 0.9 },
  { industry_id: "fashion", phrase: "konveksi", confidence: 0.8 },
  { industry_id: "fashion", phrase: "koleksi busana", confidence: 0.9 },

  // --- Beauty & Skincare --------------------------------------------------
  { industry_id: "beauty-skincare", phrase: "skincare", confidence: 0.95 },
  { industry_id: "beauty-skincare", phrase: "perawatan kulit", confidence: 0.93 },
  { industry_id: "beauty-skincare", phrase: "produk kecantikan", confidence: 0.92 },
  { industry_id: "beauty-skincare", phrase: "kosmetik", confidence: 0.9 },
  { industry_id: "beauty-skincare", phrase: "cosmetics", confidence: 0.9 },
  { industry_id: "beauty-skincare", phrase: "brand kecantikan", confidence: 0.92 },
  { industry_id: "beauty-skincare", phrase: "klinik kecantikan", confidence: 0.92 },
  { industry_id: "beauty-skincare", phrase: "serum wajah", confidence: 0.9 },
  { industry_id: "beauty-skincare", phrase: "makeup", confidence: 0.85 },
  { industry_id: "beauty-skincare", phrase: "make up", confidence: 0.85 },
  { industry_id: "beauty-skincare", phrase: "salon", confidence: 0.7 },

  // --- Hospitality -------------------------------------------------------
  { industry_id: "hospitality", phrase: "hotel", confidence: 0.92 },
  { industry_id: "hospitality", phrase: "resort", confidence: 0.92 },
  { industry_id: "hospitality", phrase: "penginapan", confidence: 0.9 },
  { industry_id: "hospitality", phrase: "homestay", confidence: 0.88 },
  { industry_id: "hospitality", phrase: "guest house", confidence: 0.88 },
  { industry_id: "hospitality", phrase: "guesthouse", confidence: 0.88 },
  { industry_id: "hospitality", phrase: "staycation", confidence: 0.85 },
  { industry_id: "hospitality", phrase: "akomodasi", confidence: 0.85 },
  { industry_id: "hospitality", phrase: "hospitality", confidence: 0.9 },
  { industry_id: "hospitality", phrase: "villa", confidence: 0.78 },

  // --- Property & Real Estate ------------------------------------------
  { industry_id: "property", phrase: "real estate", confidence: 0.95 },
  { industry_id: "property", phrase: "properti", confidence: 0.92 },
  { industry_id: "property", phrase: "property", confidence: 0.92 },
  { industry_id: "property", phrase: "perumahan", confidence: 0.92 },
  { industry_id: "property", phrase: "apartemen", confidence: 0.9 },
  { industry_id: "property", phrase: "apartment", confidence: 0.9 },
  { industry_id: "property", phrase: "hunian", confidence: 0.88 },
  { industry_id: "property", phrase: "developer properti", confidence: 0.93 },
  { industry_id: "property", phrase: "rumah subsidi", confidence: 0.9 },
  { industry_id: "property", phrase: "kavling", confidence: 0.85 },
  { industry_id: "property", phrase: "kpr", confidence: 0.82 },

  // --- Technology & SaaS ---------------------------------------------
  { industry_id: "technology-saas", phrase: "saas", confidence: 0.95 },
  { industry_id: "technology-saas", phrase: "software", confidence: 0.9 },
  { industry_id: "technology-saas", phrase: "aplikasi mobile", confidence: 0.9 },
  { industry_id: "technology-saas", phrase: "mobile app", confidence: 0.9 },
  { industry_id: "technology-saas", phrase: "startup teknologi", confidence: 0.92 },
  { industry_id: "technology-saas", phrase: "tech startup", confidence: 0.92 },
  { industry_id: "technology-saas", phrase: "platform digital", confidence: 0.85 },
  { industry_id: "technology-saas", phrase: "b2b software", confidence: 0.93 },
  { industry_id: "technology-saas", phrase: "fintech", confidence: 0.85 },
  { industry_id: "technology-saas", phrase: "aplikasi", confidence: 0.78 }
];

/**
 * Natural audience phrasings, Indonesian and English, that name a real target
 * group. When the model returns no `audience.description`, a verbatim match
 * here is enough to paraphrase evidence the brief actually contains — which is
 * all the doctrine permits (audience is never inferred beyond the brief text).
 */
export const AUDIENCE_SIGNALS: readonly { readonly phrase: string; readonly confidence: number }[] = [
  { phrase: "anak muda", confidence: 0.88 },
  { phrase: "gen z", confidence: 0.9 },
  { phrase: "gen-z", confidence: 0.9 },
  { phrase: "generasi z", confidence: 0.9 },
  { phrase: "milenial", confidence: 0.87 },
  { phrase: "millennial", confidence: 0.87 },
  { phrase: "mahasiswa", confidence: 0.88 },
  { phrase: "pelajar", confidence: 0.85 },
  { phrase: "remaja", confidence: 0.85 },
  { phrase: "young professionals", confidence: 0.88 },
  { phrase: "young professional", confidence: 0.88 },
  { phrase: "profesional muda", confidence: 0.88 },
  { phrase: "eksekutif muda", confidence: 0.86 },
  { phrase: "pekerja kantoran", confidence: 0.85 },
  { phrase: "perempuan urban", confidence: 0.87 },
  { phrase: "wanita urban", confidence: 0.87 },
  { phrase: "perempuan karier", confidence: 0.87 },
  { phrase: "wanita karier", confidence: 0.87 },
  { phrase: "ibu rumah tangga", confidence: 0.88 },
  { phrase: "ibu muda", confidence: 0.86 },
  { phrase: "keluarga muda", confidence: 0.86 },
  { phrase: "parents", confidence: 0.82 },
  { phrase: "new parents", confidence: 0.85 },
  { phrase: "orang tua murid", confidence: 0.85 },
  { phrase: "komunitas kreatif", confidence: 0.8 },
  { phrase: "pelaku umkm", confidence: 0.88 },
  { phrase: "pemilik umkm", confidence: 0.88 },
  { phrase: "umkm owners", confidence: 0.88 },
  { phrase: "umkm", confidence: 0.8 },
  { phrase: "pemilik usaha", confidence: 0.85 },
  { phrase: "pemilik bisnis", confidence: 0.85 },
  { phrase: "business owners", confidence: 0.86 },
  { phrase: "business owner", confidence: 0.86 },
  { phrase: "kolektor", confidence: 0.72 }
];

/** Lowercase, strip punctuation to spaces, single-space, and pad with spaces. */
function fold(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim()} `;
}

/** Whole-phrase containment against a folded haystack. */
function containsPhrase(foldedHaystack: string, phrase: string): boolean {
  const folded = fold(phrase).trim();
  return folded.length > 0 && foldedHaystack.includes(` ${folded} `);
}

type IndustryMatch =
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous"; readonly industries: readonly string[]; readonly evidence: string }
  | {
      readonly kind: "resolved";
      readonly industry_id: string;
      readonly phrase: string;
      readonly confidence: number;
    };

function matchIndustry(foldedBrief: string, known: ReadonlySet<string>): IndustryMatch {
  const hits = INDUSTRY_ALIASES.filter(
    (alias) => known.has(alias.industry_id) && containsPhrase(foldedBrief, alias.phrase)
  );
  if (hits.length === 0) return { kind: "none" };

  const industries = [...new Set(hits.map((hit) => hit.industry_id))].sort();
  if (industries.length > 1) {
    return {
      kind: "ambiguous",
      industries,
      evidence: [...new Set(hits.map((hit) => hit.phrase))].join(", ")
    };
  }

  // One candidate industry: report its strongest phrase.
  const best = hits.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  return {
    kind: "resolved",
    industry_id: best.industry_id,
    phrase: best.phrase,
    confidence: best.confidence
  };
}

/**
 * The verbatim brief slice for a signal phrase, so the resolved description
 * quotes the client rather than a canonical label. Requires a literal
 * (case-insensitive) occurrence — audience is never inferred beyond the text.
 */
function audienceEvidence(rawBrief: string, phrase: string): string | null {
  const idx = rawBrief.toLowerCase().indexOf(phrase);
  return idx >= 0 ? rawBrief.slice(idx, idx + phrase.length).trim() : null;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Convert semantic extraction output into canonical, readiness-ready values.
 *
 * Returns a possibly-updated extraction plus one diagnostic per classified
 * field. `evaluateReadiness` is then called on the returned extraction, so it
 * always operates on canonical normalized values.
 */
export function classifyBrief(
  extraction: BriefExtraction,
  rawBrief: string,
  datasets: DatasetRegistry
): BriefClassification {
  const foldedBrief = fold(rawBrief);
  const knownIndustries = new Set(datasets.industries.keys());
  const diagnostics: ClassificationDiagnostic[] = [];
  let next = extraction;

  // --- industry_id ---------------------------------------------------------
  if (extraction.industry_id.value !== null) {
    diagnostics.push({
      field: "industry_id",
      value: extraction.industry_id.value,
      source: "explicit",
      confidence: extraction.industry_id.confidence,
      evidence: null
    });
  } else {
    const match = matchIndustry(foldedBrief, knownIndustries);
    if (match.kind === "resolved" && match.confidence >= HIGH_CONFIDENCE) {
      next = {
        ...next,
        industry_id: { value: match.industry_id, confidence: round2(match.confidence) }
      };
      diagnostics.push({
        field: "industry_id",
        value: match.industry_id,
        source: "alias",
        confidence: round2(match.confidence),
        evidence: match.phrase
      });
    } else if (match.kind === "resolved") {
      // Single candidate, but too weak to satisfy a blocking field on its own.
      diagnostics.push({
        field: "industry_id",
        value: null,
        source: "alias",
        confidence: round2(match.confidence),
        evidence: match.phrase
      });
    } else if (match.kind === "ambiguous") {
      diagnostics.push({
        field: "industry_id",
        value: null,
        source: "unresolved",
        confidence: 0,
        evidence: match.evidence
      });
    } else {
      diagnostics.push({
        field: "industry_id",
        value: null,
        source: "unresolved",
        confidence: 0,
        evidence: null
      });
    }
  }

  // --- audience.description ----------------------------------------------
  if (extraction.audience.description.value !== null) {
    diagnostics.push({
      field: "audience.description",
      value: extraction.audience.description.value,
      source: "explicit",
      confidence: extraction.audience.description.confidence,
      evidence: null
    });
  } else {
    const found = AUDIENCE_SIGNALS.map((signal) => ({
      signal,
      evidence: audienceEvidence(rawBrief, signal.phrase)
    })).filter((entry): entry is { signal: typeof entry.signal; evidence: string } => entry.evidence !== null);

    if (found.length === 0) {
      diagnostics.push({
        field: "audience.description",
        value: null,
        source: "unresolved",
        confidence: 0,
        evidence: null
      });
    } else {
      const ordered = [...found].sort(
        (a, b) => rawBrief.toLowerCase().indexOf(a.signal.phrase) - rawBrief.toLowerCase().indexOf(b.signal.phrase)
      );
      // Collapse signals that fold to the same token ("gen z" / "gen-z"),
      // keeping the first spelling as it appears in the brief.
      const seen = new Set<string>();
      const parts: string[] = [];
      for (const entry of ordered) {
        const key = fold(entry.evidence).trim();
        if (seen.has(key)) continue;
        seen.add(key);
        parts.push(entry.evidence);
      }
      const description = parts.join(", ");
      const confidence = Math.max(...found.map((entry) => entry.signal.confidence));

      if (confidence >= HIGH_CONFIDENCE) {
        next = {
          ...next,
          audience: {
            ...next.audience,
            description: { value: description, confidence: round2(confidence) }
          }
        };
        diagnostics.push({
          field: "audience.description",
          value: description,
          source: "alias",
          confidence: round2(confidence),
          evidence: description
        });
      } else {
        diagnostics.push({
          field: "audience.description",
          value: null,
          source: "alias",
          confidence: round2(confidence),
          evidence: description
        });
      }
    }
  }

  return { extraction: next, diagnostics };
}
