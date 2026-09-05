import { mentionsToken } from "../country/anti-stereotype";

/**
 * The stereotype / banned-token prompt output guard (P3.0).
 *
 * Doctrine §5 forbids country influence from collapsing into a motif. That
 * doctrine is enforced everywhere upstream (country files declare
 * `avoid_stereotypes`, the contract aggregates them into `banned_tokens`,
 * `validate:data` fails a file that contradicts its own guard) EXCEPT the final
 * output. This layer closes that gap with a deterministic, post-compile string
 * pass over every prompt tier — exactly the "post-compile string filter"
 * described in `docs/adr/0005-stereotype-guard-as-output-filter.md`.
 *
 * It is a string property, not a model instruction:
 *
 * - It scans the five compiled prompt strings for any token in
 *   `recipe.culture.banned_tokens`. That list ALREADY excludes tokens the brief
 *   explicitly released (see `collectBannedTokens`), so a released token is
 *   never scanned for, never flagged and never stripped.
 * - Every detection is reported (`findings`).
 * - A token that appears as a self-contained item of a comma / semicolon list,
 *   in a POSITIVE context, is stripped — removing one list item keeps the
 *   sentence grammatical. That is the only rewrite it performs.
 * - A token anywhere else — inside a sentence, or inside an "Avoid" / "No" /
 *   "Never" negative instruction (including the whole Negative Prompt) — is
 *   left exactly as written and surfaced as a structured violation. No
 *   speculative rewriting.
 *
 * It makes no design decision, calls no model, reads no country id, and adds no
 * provider, database or framework. `compilePromptSet` runs it once, per
 * language, after rendering.
 */

export const GUARDED_PROMPT_TIERS = [
  "masterPrompt",
  "quickPrompt",
  "imageOnlyPrompt",
  "designLayoutPrompt",
  "negativePrompt"
] as const;
export type GuardedPromptTier = (typeof GUARDED_PROMPT_TIERS)[number];

export type GuardAction = "stripped" | "flagged";

export type BannedTokenFinding = {
  readonly token: string;
  readonly tier: GuardedPromptTier;
  readonly action: GuardAction;
  /**
   * True when the token sat inside a negative instruction (an "Avoid" / "No" /
   * "Never" / "Hindari" / "Jangan" segment, or the whole Negative Prompt). Such
   * an occurrence is benign — the prompt is telling the generator NOT to use
   * the motif — so it is always preserved, never stripped.
   */
  readonly negative_context: boolean;
  /** The list item or sentence the token appeared in, trimmed. */
  readonly context: string;
};

export type PromptGuardReport = {
  readonly clean: boolean;
  readonly findings: readonly BannedTokenFinding[];
};

/** The minimum shape the guard reads and rewrites. `visualCharacter` etc. pass through untouched. */
type GuardableSet = { readonly [K in GuardedPromptTier]: string };

/**
 * Where one list item ends and the next begins. `, ` / `; ` are the joins the
 * renderers use; `: ` / `. ` additionally mark the start of a list that opens
 * mid-line (e.g. "…complexity 42%. Relationships: a, b, c."). Only `, ` / `; `
 * are ever *consumed* when a stripped item is removed.
 */
const SEGMENT_BOUNDARIES = ["; ", ", ", ": ", ". "] as const;
/** The two an excise is allowed to eat. */
const CONSUMABLE_DELIMS = ["; ", ", "] as const;

/** A segment beginning with one of these is a negative instruction. Bilingual. */
const NEGATIVE_CUE =
  /^(avoid|no|not|never|without|do not|don't|hindari|jangan|tanpa)\b/i;

/** Cap on how much surrounding text a `context` string carries. */
const CONTEXT_CAP = 200;

/** Boundary-correct spans of `token` in `text`, in order — mirrors `mentionsToken`. */
function tokenSpans(text: string, token: string): [number, number][] {
  const spans: [number, number][] = [];
  const haystack = text.toLowerCase();
  const needle = token.toLowerCase();
  if (needle.length === 0) return spans;
  const boundary = /[a-z0-9]/i;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) return spans;
    const before = index === 0 ? "" : haystack[index - 1] ?? "";
    const afterIndex = index + needle.length;
    const after = afterIndex >= haystack.length ? "" : haystack[afterIndex] ?? "";
    if (!boundary.test(before) && !boundary.test(after)) spans.push([index, afterIndex]);
    from = index + 1;
  }
}

/** The line (between newlines) containing [start, end). */
function lineRange(text: string, start: number): { start: number; end: number } {
  const ls = text.lastIndexOf("\n", start - 1) + 1;
  const nl = text.indexOf("\n", start);
  return { start: ls, end: nl === -1 ? text.length : nl };
}

/**
 * The delimiter-bounded segment ranges of a line, as [start, end) offsets into
 * `text` (absolute). A line with no delimiter is one segment.
 */
function segmentRanges(text: string, line: { start: number; end: number }): [number, number][] {
  const body = text.slice(line.start, line.end);
  const cuts: number[] = [];
  for (let i = 0; i < body.length - 1; i += 1) {
    const two = body.slice(i, i + 2);
    if ((SEGMENT_BOUNDARIES as readonly string[]).includes(two)) {
      cuts.push(i);
      i += 1;
    }
  }
  const ranges: [number, number][] = [];
  let cursor = 0;
  for (const cut of cuts) {
    ranges.push([line.start + cursor, line.start + cut]);
    cursor = cut + 2;
  }
  ranges.push([line.start + cursor, line.end]);
  return ranges;
}

/** The sentence around [start, end) — bounded by ". ", newline, or string ends. */
function sentenceContext(text: string, start: number, end: number): string {
  let s = start;
  while (s > 0) {
    const prev2 = text.slice(s - 2, s);
    if (prev2 === ". " || text[s - 1] === "\n") break;
    s -= 1;
  }
  let e = end;
  while (e < text.length) {
    if (text[e] === "\n") break;
    if (text.slice(e, e + 2) === ". ") {
      e += 1;
      break;
    }
    e += 1;
  }
  return text.slice(s, e).trim().slice(0, CONTEXT_CAP);
}

type Decision = {
  readonly token: string;
  readonly action: GuardAction;
  readonly negativeContext: boolean;
  readonly context: string;
  /** Absolute [start, end) of the segment to excise, when action is "stripped". */
  readonly cut?: { readonly segStart: number; readonly segEnd: number; readonly line: { start: number; end: number } };
};

function decide(text: string, span: [number, number], token: string, tier: GuardedPromptTier): Decision {
  const [start, end] = span;
  const line = lineRange(text, start);
  const lineText = text.slice(line.start, line.end);
  const segments = segmentRanges(text, line);
  const seg = segments.find(([s, e]) => start >= s && end <= e) ?? [line.start, line.end];
  const segmentText = text.slice(seg[0], seg[1]).trim();

  const negativeContext =
    tier === "negativePrompt" ||
    NEGATIVE_CUE.test(lineText.trim()) ||
    NEGATIVE_CUE.test(segmentText);

  // Strip ONLY a standalone list item, in a positive context, on a multi-item line.
  const bareSegment = segmentText.replace(/[.!?;:,\s]+$/u, "").replace(/^[.!?;:,\s]+/u, "");
  const isStandaloneItem = bareSegment.toLowerCase() === token.toLowerCase();

  if (!negativeContext && isStandaloneItem && segments.length >= 2) {
    return {
      token,
      action: "stripped",
      negativeContext: false,
      context: segmentText,
      cut: { segStart: seg[0], segEnd: seg[1], line }
    };
  }

  return {
    token,
    action: "flagged",
    negativeContext,
    context: negativeContext ? segmentText || sentenceContext(text, start, end) : sentenceContext(text, start, end)
  };
}

const CONSUMABLE = new Set<string>(CONSUMABLE_DELIMS);

/** Excise `[segStart, segEnd)` plus one adjacent `, ` / `; `; keep the line's terminal punctuation. */
function excise(text: string, cut: NonNullable<Decision["cut"]>): string {
  const { segStart, segEnd, line } = cut;
  const before = text.slice(0, line.start);
  const after = text.slice(line.end);
  const originalBody = text.slice(line.start, line.end);
  let s = segStart - line.start;
  let e = segEnd - line.start;

  if (CONSUMABLE.has(originalBody.slice(s - 2, s))) {
    s -= 2; // preceding delimiter
  } else if (CONSUMABLE.has(originalBody.slice(e, e + 2))) {
    e += 2; // first item: following delimiter
  }

  let body = originalBody.slice(0, s) + originalBody.slice(e);

  // If the removed item was the line's last and carried the terminal ".",
  // the shortened line would end without one — put it back.
  const terminal = originalBody.match(/([.!?]+)\s*$/u)?.[1] ?? "";
  if (terminal && !/[.!?]\s*$/u.test(body)) body = body.replace(/[\s,;]+$/u, "") + terminal;

  return before + body + after;
}

export function guardPromptSet<T extends GuardableSet>(
  set: T,
  bannedTokens: readonly string[]
): { set: T; report: PromptGuardReport } {
  const tokens = [...new Set(bannedTokens.map((t) => t.trim()).filter((t) => t.length > 0))].sort();
  const findings: BannedTokenFinding[] = [];
  const next: Record<string, string> = { ...set };

  for (const tier of GUARDED_PROMPT_TIERS) {
    let text = set[tier];
    if (tokens.length === 0 || !tokens.some((token) => mentionsToken(text, token))) {
      continue;
    }

    for (const token of tokens) {
      const spans = tokenSpans(text, token);
      if (spans.length === 0) continue;

      const decisions = spans.map((span) => decide(text, span, token, tier));

      // Apply strips right-to-left so earlier offsets stay valid.
      for (const d of [...decisions].reverse()) {
        if (d.action === "stripped" && d.cut) text = excise(text, d.cut);
      }

      for (const d of decisions) {
        findings.push({
          token: d.token,
          tier,
          action: d.action,
          negative_context: d.negativeContext,
          context: d.context
        });
      }
    }

    next[tier] = text;
  }

  findings.sort(
    (a, b) =>
      a.token.localeCompare(b.token) ||
      GUARDED_PROMPT_TIERS.indexOf(a.tier) - GUARDED_PROMPT_TIERS.indexOf(b.tier) ||
      a.context.localeCompare(b.context)
  );

  return {
    set: next as T,
    report: { clean: findings.length === 0, findings }
  };
}
