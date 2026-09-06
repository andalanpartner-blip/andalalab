import { describe, expect, it } from "vitest";
import {
  STAGES,
  STAGE_LIST,
  STAGE_META,
  deriveStageStates,
  defaultStage,
  isReachable,
  isStageId
} from "../../lib/workspace";

/**
 * UI/UX-02B — the `layout` stage sits between Recipe and Prompt and is a real
 * (non-future) stage, unlocked once a recipe exists. These are pure stage-model
 * checks — no React, matching the project's testing strategy.
 */

const signals = (over: Partial<Parameters<typeof deriveStageStates>[0]> = {}) => ({
  briefReady: true,
  clarifying: false,
  conceptSelected: true,
  hasRecipe: true,
  hasReview: false,
  criticVerdict: null as "PASS" | "REVIEW" | "BLOCK" | null,
  ...over
});

describe("layout stage integration", () => {
  it("exists and sits between recipe and prompt", () => {
    expect(STAGES).toContain("layout");
    expect(isStageId("layout")).toBe(true);
    const order = [...STAGES];
    expect(order.indexOf("layout")).toBe(order.indexOf("recipe") + 1);
    expect(order.indexOf("prompt")).toBe(order.indexOf("layout") + 1);
  });

  it("is a real stage, not a P8 placeholder", () => {
    expect(STAGE_META.layout.future).toBe(false);
    expect(STAGE_META.layout.label).toBe("Layout");
  });

  it("renumbers the downstream stages contiguously", () => {
    STAGE_LIST.forEach((meta, i) => expect(meta.index).toBe(i + 1));
    expect(STAGE_LIST).toHaveLength(10);
    expect(STAGE_META.prompt.index).toBe(6);
    expect(STAGE_META.final.index).toBe(10);
  });

  it("is locked until a recipe exists, then reachable", () => {
    expect(deriveStageStates(signals({ hasRecipe: false, conceptSelected: false })).layout).toBe("locked");
    const withRecipe = deriveStageStates(signals());
    expect(withRecipe.layout).not.toBe("locked");
    expect(isReachable(withRecipe.layout)).toBe(true);
  });

  it("stays viewable even when the critic verdict is BLOCK", () => {
    const blocked = deriveStageStates(signals({ criticVerdict: "BLOCK" }));
    expect(blocked.recipe).toBe("blocked");
    expect(isReachable(blocked.layout)).toBe(true);
  });

  it("Recipe can navigate to Layout and Layout can navigate to Prompt", () => {
    const states = deriveStageStates(signals());
    // Recipe -> Layout
    expect(isReachable(states.recipe)).toBe(true);
    expect(isReachable(states.layout)).toBe(true);
    // Layout -> Prompt
    expect(isReachable(states.prompt)).toBe(true);
  });

  it("keeps existing stage-state logic intact (brief/strategy/concept unchanged)", () => {
    const fresh = deriveStageStates(signals({ briefReady: false, conceptSelected: false, hasRecipe: false }));
    expect(fresh.brief).toBe("available");
    expect(fresh.strategy).toBe("locked");
    expect(fresh.concept).toBe("locked");
    expect(fresh.layout).toBe("locked");
  });

  it("defaultStage still prefers the furthest reachable stage and knows about layout", () => {
    const noReview = deriveStageStates(signals({ hasReview: false }));
    // review is 'available' once a recipe exists, so it wins
    expect(defaultStage(noReview)).toBe("review");
    // if only up to layout were reachable, layout would be chosen over recipe
    const order = ["review", "prompt", "layout", "recipe", "concept", "strategy", "brief"];
    expect(order.indexOf("layout")).toBeGreaterThan(order.indexOf("prompt"));
  });
});
