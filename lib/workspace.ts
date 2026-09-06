/**
 * The Andala Creative Workspace stage model (UI/UX-01, slice 3).
 *
 * Presentational only. This derives the state of the nine workflow stages from
 * the client-side artifacts the page already holds — no backend, no
 * persistence, no engine import. It makes zero design or API decisions.
 */

export const STAGES = [
  "brief",
  "strategy",
  "concept",
  "recipe",
  "layout",
  "prompt",
  "generate",
  "review",
  "correct",
  "final"
] as const;

export type StageId = (typeof STAGES)[number];

/** honest states — the five the workspace exposes. */
export type StageState = "locked" | "available" | "active" | "done" | "blocked";

export type StageMeta = {
  readonly id: StageId;
  readonly index: number;
  readonly label: string;
  /** A stage that only becomes real when the Generation Adapter (P8) ships. */
  readonly future: boolean;
  readonly summary: string;
};

export const STAGE_META: Record<StageId, StageMeta> = {
  brief: { id: "brief", index: 1, label: "Brief", future: false, summary: "What are we designing?" },
  strategy: { id: "strategy", index: 2, label: "Strategy", future: false, summary: "The art direction the AI resolved." },
  concept: { id: "concept", index: 3, label: "Concept", future: false, summary: "Three directions, one strategic idea." },
  recipe: { id: "recipe", index: 4, label: "Recipe", future: false, summary: "Every design decision, with provenance." },
  layout: { id: "layout", index: 5, label: "Layout", future: false, summary: "The intended structure — grid, zones, reading flow." },
  prompt: { id: "prompt", index: 6, label: "Prompt", future: false, summary: "The generation prompt, in two languages." },
  generate: { id: "generate", index: 7, label: "Generate", future: true, summary: "Runs the image — ships with P8." },
  review: { id: "review", index: 8, label: "Review", future: false, summary: "Compliance now; visual quality when a render exists." },
  correct: { id: "correct", index: 9, label: "Correct", future: false, summary: "Bounded nudges — a new derived recipe." },
  final: { id: "final", index: 10, label: "Final", future: true, summary: "The finished visual + decision trail — ships with P8." }
};

export const STAGE_LIST: readonly StageMeta[] = STAGES.map((id) => STAGE_META[id]);

/** The artifacts the page holds, reduced to what the stage model needs. */
export type WorkspaceSignals = {
  readonly briefReady: boolean;
  readonly clarifying: boolean;
  readonly conceptSelected: boolean;
  readonly hasRecipe: boolean;
  readonly hasReview: boolean;
  /** The P4.0 verdict on the current recipe, if any — drives `blocked`. */
  readonly criticVerdict: "PASS" | "REVIEW" | "BLOCK" | null;
};

/**
 * Derive every stage's state. `active` is layered on top by the shell for the
 * currently-viewed stage; this returns the underlying availability.
 */
export function deriveStageStates(s: WorkspaceSignals): Record<StageId, Exclude<StageState, "active">> {
  const blocked = s.criticVerdict === "BLOCK";

  return {
    brief: s.briefReady ? "done" : "available",
    strategy: s.briefReady ? "done" : "locked",
    concept: !s.briefReady ? "locked" : s.conceptSelected ? "done" : "available",
    recipe: !s.conceptSelected ? "locked" : blocked ? "blocked" : s.hasRecipe ? "done" : "available",
    // Layout is a real stage (not a P8 placeholder): the blueprint is resolved
    // and returned with every recipe/correction response. Viewable regardless of
    // the critic verdict — it shows intended structure, it decides nothing.
    layout: !s.hasRecipe ? "locked" : "done",
    prompt: !s.hasRecipe ? "locked" : "done",
    // Generate & Final are viewable placeholders once a recipe exists — the
    // real behaviour ships with P8. `future` in STAGE_META keeps the rail
    // showing them as "soon".
    generate: !s.hasRecipe ? "locked" : "available",
    review: !s.hasRecipe ? "locked" : blocked ? "blocked" : s.hasReview ? "done" : "available",
    correct: !s.hasRecipe ? "locked" : "available",
    final: !s.hasRecipe ? "locked" : "available"
  };
}

/** The furthest stage the user can sensibly be on right now (skips the P8 placeholders). */
export function defaultStage(states: Record<StageId, Exclude<StageState, "active">>): StageId {
  const order: StageId[] = ["review", "prompt", "layout", "recipe", "concept", "strategy", "brief"];
  for (const id of order) {
    if (states[id] === "available" || states[id] === "done" || states[id] === "blocked") return id;
  }
  return "brief";
}

export function isStageId(value: string | null | undefined): value is StageId {
  return value != null && (STAGES as readonly string[]).includes(value);
}

/** A stage the user is allowed to navigate to. */
export function isReachable(state: Exclude<StageState, "active">): boolean {
  return state !== "locked";
}
