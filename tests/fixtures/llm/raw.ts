import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Structured fixtures, returned exactly as a model would return them. */
export const llmFixture = (name: string): string =>
  readFileSync(join(process.cwd(), "tests/fixtures/llm", `${name}.json`), "utf8");

/** Fenced and prefaced — models do this no matter what the prompt says. */
export const fenced = (name: string): string =>
  `Berikut hasil ekstraksinya:\n\n\`\`\`json\n${llmFixture(name)}\n\`\`\`\n`;

/** 06 — malformed structured response: truncated JSON. */
export const MALFORMED = '{"objective": {"value": "launch", "confidence": 0.9';

/** 09 — repair-failure: prose where an object was required, twice. */
export const PROSE_ONLY =
  "Maaf, saya tidak bisa mengekstrak brief ini menjadi JSON. Silakan berikan detail lebih lanjut.";

/** The Indonesian brief from the P2.1 specification, used end to end. */
export const RAW_INDONESIAN_BRIEF =
  "Buat poster Instagram 4:5 untuk coffee shop baru di Solo. Target anak muda. " +
  "Ingin tampil modern Indonesia dengan sedikit nuansa Jepang. Fokus untuk grand opening.";

/**
 * The exact Indonesian browser brief that regressed in P2.7 debugging: every
 * blocking field is present or safely inferable EXCEPT `industry_id` — a
 * "creative youth event" maps to no loaded industry vocabulary. Paired with
 * fixture `12-solo-creative-event.json` (industry_id: null).
 */
export const RAW_SOLO_CREATIVE_EVENT_BRIEF =
  "Buat poster Instagram 4:5 untuk event kreatif anak muda di Solo. Gunakan pendekatan graphic poster yang berani, tipografi besar, geometric shapes, layering dan visual rhythm. Jangan terlihat seperti template Canva.\n\n" +
  "Warna: bold dan kontras tetapi tetap terkontrol.\n" +
  "Komposisi: editorial poster, asymmetric balance, strong focal point, layered graphic elements.\n\n" +
  "Hindari: desain generik, stock-photo look, template Canva, terlalu banyak ornamen, layout berantakan, dan visual hierarchy yang lemah.";

/**
 * P2.8 — Smart Brief Classification. Natural Indonesian briefs that use no
 * internal taxonomy term. Each is paired with an LLM fixture that leaves
 * `industry_id` (and sometimes `audience.description`) null; the deterministic
 * classifier in `engine/brief/classify.ts` resolves them where the evidence is
 * sufficient and leaves them for clarification where it is not.
 */
export const RAW_SOLO_EVENT_ANAK_MUDA_BRIEF =
  "Buat poster Instagram untuk event kreatif anak muda di Solo.";
export const RAW_CAMPAIGN_FASHION_PEREMPUAN_URBAN_BRIEF =
  "Buat campaign fashion untuk perempuan urban.";
export const RAW_PROMO_COFFEE_SHOP_GENZ_BRIEF =
  "Buat promo coffee shop untuk Gen Z.";
export const RAW_POSTER_KOMUNITAS_KREATIF_BRIEF =
  "Buat poster komunitas kreatif.";
export const RAW_POSTER_BISNIS_SAYA_BRIEF =
  "Buat poster untuk bisnis saya.";
export const RAW_COFFEE_SHOP_ALIAS_READY_BRIEF =
  "Buat poster Instagram 4:5 untuk coffee shop baru di Solo. Target anak muda yang suka kopi specialty. Fokus untuk grand opening.";
