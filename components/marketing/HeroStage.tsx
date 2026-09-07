"use client";

import { useEffect, useRef } from "react";
import styles from "./marketing.module.css";
import { WorkflowArtifact, type WorkflowKind } from "./Artifacts";

/**
 * The hero's scroll-driven composition.
 *
 * Six creative artifacts begin scattered and layered; as the sticky hero
 * scrolls they settle into a legible left-to-right sequence and the central
 * "Generate" artifact grows slightly. Pure CSS transforms, one rAF-batched
 * scroll listener, no library.
 *
 * Progressive enhancement: with JS off or `prefers-reduced-motion` on, the
 * cards render in their settled positions and nothing moves.
 */

type Card = { kind: WorkflowKind; index: string; label: string };

const CARDS: Card[] = [
  { kind: "brief", index: "01", label: "Brief" },
  { kind: "concept", index: "02", label: "Concept" },
  { kind: "recipe", index: "03", label: "Recipe" },
  { kind: "generate", index: "04", label: "Generate" },
  { kind: "review", index: "05", label: "Review" },
  { kind: "final", index: "06", label: "Final" }
];

// Scattered start pose per card: [x%, y%, rotateDeg, scale, z]
const START: Array<[number, number, number, number, number]> = [
  [-4, 14, -9, 0.9, 1],
  [12, -8, 6, 0.94, 2],
  [-14, 2, -4, 1.0, 3],
  [4, 10, 3, 1.06, 6],
  [22, 4, 8, 0.92, 4],
  [-2, -14, -6, 0.88, 5]
];
// Settled end pose: an even row, gentle arc, central card largest
const END: Array<[number, number, number, number, number]> = [
  [-40, 6, -3, 0.9, 1],
  [-24, -2, -2, 0.95, 2],
  [-9, 1, -1, 1.0, 3],
  [8, 0, 0, 1.12, 6],
  [24, 2, 2, 0.97, 4],
  [40, 8, 4, 0.9, 2]
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export function HeroStage() {
  const stickyRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const sticky = stickyRef.current;
    const track = trackRef.current;
    if (!sticky || !track) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;

    const apply = (p: number) => {
      const t = ease(Math.max(0, Math.min(1, p)));
      track.style.setProperty("--p", String(t));
      CARDS.forEach((_, i) => {
        const el = cardRefs.current[i];
        if (!el) return;
        const s = START[i]!;
        const e = END[i]!;
        const x = lerp(s[0], e[0], t);
        const y = lerp(s[1], e[1], t);
        const r = lerp(s[2], e[2], t);
        const sc = lerp(s[3], e[3], t);
        el.style.transform = `translate(-50%, -50%) translate(${x}%, ${y}%) rotate(${r}deg) scale(${sc})`;
        el.style.zIndex = String(Math.round(lerp(s[4], e[4], t) * 10));
      });
    };

    const settle = () => apply(1);

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const rect = sticky.getBoundingClientRect();
        const total = sticky.offsetHeight - window.innerHeight;
        const p = total > 0 ? -rect.top / total : 0;
        apply(p);
      });
    };

    if (reduce.matches) {
      settle();
      return;
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    const onReduce = () => (reduce.matches ? settle() : onScroll());
    reduce.addEventListener("change", onReduce);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      reduce.removeEventListener("change", onReduce);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={stickyRef} className={styles.heroStage}>
      <div className={styles.heroSticky}>
        <div ref={trackRef} className={styles.heroTrack} aria-hidden="true">
          {CARDS.map((card, i) => (
            <div
              key={card.kind}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              className={styles.heroCard}
              data-kind={card.kind}
            >
              <WorkflowArtifact kind={card.kind} index={card.index} label={card.label} />
            </div>
          ))}
        </div>
        <ol className="visually-hidden">
          {CARDS.map((c) => (
            <li key={c.kind}>
              {c.index} {c.label}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
