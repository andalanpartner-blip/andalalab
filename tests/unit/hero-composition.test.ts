import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HERO_SLOTS,
  HERO_SETTLE,
  HERO_CENTER_INDEX,
  heroPoseAt,
  heroSettledSpan,
  heroSpread
} from "../../components/marketing/hero-choreography";

/**
 * Marketing hero — the workflow cards must read as a wide editorial collection,
 * not a centred stack, and must never collapse toward the centre on scroll.
 */

const ROOT = new URL("../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), "utf8");

// A representative desktop track: `min(1120px, 92vw)` pins at 1120 for vw >= 1218.
const TRACK = 1120;
const CARD_MAX = 244; // clamp(178px, 19.5vw, 244px)

describe("hero composition — desktop", () => {
  it("1 — the cards occupy a broad horizontal composition (>= 55% of the track)", () => {
    for (const vw of [1280, 1440, 1600]) {
      const span = heroSettledSpan(TRACK, vw);
      expect(span).toBeGreaterThan(TRACK * 0.55);
      // ...and the visual footprint (outer card edges) is a wide band, not the middle.
      const footprint = span + CARD_MAX;
      expect(footprint).toBeGreaterThan(TRACK * 0.75);
      expect(footprint).toBeLessThanOrEqual(TRACK); // still within the track
    }
  });

  it("2 — the centre card ('Generate') stays the dominant, largest card", () => {
    const settledScales = HERO_SETTLE.map((s) => s[2]);
    const maxScale = Math.max(...settledScales);
    expect(settledScales[HERO_CENTER_INDEX]).toBe(maxScale);
    expect(settledScales.filter((s) => s === maxScale)).toHaveLength(1);

    // and at the settled scroll state
    const scales = HERO_SLOTS.map((_, i) => heroPoseAt(i, 1, TRACK, 1440).scale);
    expect(Math.max(...scales)).toBe(scales[HERO_CENTER_INDEX]);

    // the centre card sits near the middle, not off to one side
    expect(Math.abs(heroPoseAt(HERO_CENTER_INDEX, 1, TRACK, 1440).x)).toBeLessThan(TRACK * 0.1);
  });

  it("3 — no card leaves the track at any scroll progress (no horizontal overflow)", () => {
    for (const vw of [1280, 1440, 1600, 1024, 768]) {
      const track = Math.min(1120, vw * 0.92); // .heroTrack width
      const cardW = Math.min(244, Math.max(178, vw * 0.195)); // clamp(178px, 19.5vw, 244px)
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        for (let i = 0; i < HERO_SLOTS.length; i += 1) {
          const edge = Math.abs(heroPoseAt(i, t, track, vw).x) + cardW / 2;
          expect(edge).toBeLessThanOrEqual(track / 2 + 1);
        }
      }
    }
  });

  it("6 — the composition never collapses toward the centre on scroll", () => {
    for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const xs = HERO_SLOTS.map((_, i) => heroPoseAt(i, t, TRACK, 1440).x);
      const span = Math.max(...xs) - Math.min(...xs);
      expect(span).toBeGreaterThan(TRACK * 0.5);
    }
    // the settled (final) span is broad — not a tighter cluster than mid-scroll
    const finalSpan = heroSettledSpan(TRACK, 1440);
    const midXs = HERO_SLOTS.map((_, i) => heroPoseAt(i, 0.5, TRACK, 1440).x);
    const midSpan = Math.max(...midXs) - Math.min(...midXs);
    expect(finalSpan).toBeGreaterThan(midSpan * 0.85);
  });
});

describe("hero composition — responsive", () => {
  it("tablet reduces the spread proportionally but keeps it broad", () => {
    expect(heroSpread(1600)).toBe(1);
    expect(heroSpread(1024)).toBeLessThan(1);
    expect(heroSpread(768)).toBeLessThan(heroSpread(1024));
    // still a wide band at 768
    expect(heroSettledSpan(707, 768)).toBeGreaterThan(707 * 0.4);
  });

  it("4 — mobile (<=640) uses a stacked composition, centre card dominant", () => {
    const css = read("components/marketing/marketing.module.css");
    const mobile = css.slice(css.indexOf("@media (max-width: 640px)"));
    expect(mobile).toMatch(/\.heroCard\s*\{[^}]*position:\s*static\s*!important/);
    expect(mobile).toMatch(/\.heroCard\s*\{[^}]*transform:\s*none\s*!important/);
    // the centre card is the dominant one in the stack
    expect(mobile).toMatch(/\.heroCard\[data-kind="generate"\]\s*\{[^}]*width:\s*100%/);
  });

  it("7 — the shell clips rather than scrolls horizontally", () => {
    const css = read("components/marketing/marketing.module.css");
    expect(css).toMatch(/\.page\s*\{[^}]*overflow-x:\s*clip/);
    expect(css).toMatch(/\.heroSticky\s*\{[^}]*overflow:\s*hidden/);
  });
});

describe("hero composition — reduced motion / no JS", () => {
  it("5 — reduced motion jumps straight to the settled broad composition, all cards shown", () => {
    const src = read("components/marketing/HeroStage.tsx");
    // reduced motion → settle() and bail before wiring any scroll listener
    expect(src).toMatch(/if\s*\(reduce\.matches\)\s*\{\s*settle\(\);\s*return;/);
    expect(src).toMatch(/const settle = \(\) => apply\(1\)/);
    // no animation dependency: nothing hides a hero card by opacity
    const css = read("components/marketing/marketing.module.css");
    expect(css).not.toMatch(/\.heroCard[^{]*\{[^}]*opacity:\s*0/);
  });

  it("no-JS fallback: every card has a CSS slot so the band renders without the effect", () => {
    const css = read("components/marketing/marketing.module.css");
    for (const kind of ["brief", "concept", "recipe", "generate", "review", "final"]) {
      expect(css).toMatch(new RegExp(`\\.heroCard\\[data-kind="${kind}"\\]\\s*\\{[^}]*left:`));
    }
  });
});
