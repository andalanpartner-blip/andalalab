/**
 * Hero composition maths — a pure module so the choreography can be unit tested
 * without a DOM.
 *
 * The six workflow artifacts sit across a wide editorial band: a dominant centre
 * card ("Generate") with supporting cards fanning left and right, each at its
 * own horizontal slot, vertical offset, rotation and scale. Scroll progress
 * `t` (0 → 1) interpolates from a slightly scattered pile to that settled band —
 * it never collapses back toward the centre, because the settled slots are the
 * end state.
 *
 * Units: `x` is pixels, centre-relative (0 = middle of the track). `y` is a
 * percentage of the card's own height. `rotate` is degrees. `scale` is a ratio.
 */

export type HeroPose = {
  readonly x: number;
  readonly y: number;
  readonly rotate: number;
  readonly scale: number;
  readonly z: number;
};

/** Card order — matches `CARDS` in HeroStage and the `data-kind` CSS slots. */
export const HERO_KINDS = ["brief", "concept", "recipe", "generate", "review", "final"] as const;
export type HeroKind = (typeof HERO_KINDS)[number];

/** The dominant card. */
export const HERO_CENTER_INDEX = 3;

/** Horizontal slot as a fraction of the track width (0.5 = centre). */
export const HERO_SLOTS = [0.2, 0.32, 0.44, 0.53, 0.67, 0.8] as const;

/** Settled pose per card: [yPercent, rotateDeg, scale, zIndex]. */
export const HERO_SETTLE: ReadonlyArray<readonly [number, number, number, number]> = [
  [-18, -5, 0.82, 2],
  [24, -3, 0.9, 3],
  [-4, -1.5, 0.99, 5],
  [0, 0, 1.14, 8],
  [-14, 2.5, 0.96, 4],
  [20, 4.5, 0.85, 3]
];

/** Scatter added at t = 0 and lerped to zero: [dxPx, dyPercent, dRotateDeg, dScale]. */
export const HERO_SCATTER: ReadonlyArray<readonly [number, number, number, number]> = [
  [-42, 8, -7, -0.05],
  [34, -18, 6, 0.05],
  [-30, 16, -6, 0.02],
  [22, 12, 6, -0.06],
  [46, -8, 8, 0.04],
  [-30, 18, -7, -0.04]
];

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * How wide to fan the cards for a given viewport. Full spread on desktop;
 * proportionally tighter on tablet so six cards stay a legible collection
 * without clipping; the narrowest tier is only used before the ≤640 layout
 * takes over with a vertical stack.
 */
export function heroSpread(viewportWidth: number): number {
  if (viewportWidth >= 1200) return 1;
  if (viewportWidth >= 1024) return 0.9;
  if (viewportWidth >= 768) return 0.78;
  return 0.6;
}

/**
 * The pose for card `i` at scroll progress `progress`, given the current track
 * width (the band the cards live in) and viewport width (sets the spread tier).
 */
export function heroPoseAt(
  i: number,
  progress: number,
  trackWidth: number,
  viewportWidth: number = trackWidth
): HeroPose {
  const settle = HERO_SETTLE[i];
  const scatter = HERO_SCATTER[i];
  const slot = HERO_SLOTS[i];
  if (!settle || !scatter || slot === undefined) {
    throw new RangeError(`heroPoseAt: no card at index ${i}`);
  }
  const t = easeOutCubic(clamp01(progress));
  const [cy, cr, cs, cz] = settle;
  const [dx, dy, dr, ds] = scatter;
  const settledX = (slot - 0.5) * trackWidth * heroSpread(viewportWidth);
  return {
    x: settledX + lerp(dx, 0, t),
    y: lerp(cy + dy, cy, t),
    rotate: lerp(cr + dr, cr, t),
    scale: lerp(cs + ds, cs, t),
    z: cz
  };
}

/** The settled band width (outermost card centre to outermost card centre). */
export function heroSettledSpan(trackWidth: number, viewportWidth: number = trackWidth): number {
  const xs = HERO_SLOTS.map((_, i) => heroPoseAt(i, 1, trackWidth, viewportWidth).x);
  return Math.max(...xs) - Math.min(...xs);
}
