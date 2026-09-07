"use client";

import { useEffect, useRef } from "react";
import styles from "./marketing.module.css";
import { WorkflowArtifact, type WorkflowKind } from "./Artifacts";
import { heroPoseAt } from "./hero-choreography";

/**
 * The hero's scroll-driven composition.
 *
 * Six creative artifacts sit across a wide editorial band — a dominant central
 * "Generate" card with supporting cards fanning left and right. They begin
 * slightly scattered; as the sticky hero scrolls they settle onto that band.
 * The band never collapses toward the centre. Pure CSS transforms, one
 * rAF-batched scroll listener, no library.
 *
 * Progressive enhancement: with JS off the CSS `data-kind` slots already show
 * the settled band; with `prefers-reduced-motion` the effect jumps straight to
 * it and nothing moves.
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

export function HeroStage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const stage = stageRef.current;
    const track = trackRef.current;
    if (!stage || !track) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;

    const apply = (p: number) => {
      const t = Math.max(0, Math.min(1, p));
      track.style.setProperty("--p", String(t));
      const trackWidth = track.clientWidth;
      const viewportWidth = window.innerWidth;
      CARDS.forEach((_, i) => {
        const el = cardRefs.current[i];
        if (!el) return;
        // JS owns horizontal placement now; the CSS `left:%` slot was only the
        // no-JS fallback.
        el.style.left = "50%";
        const pose = heroPoseAt(i, t, trackWidth, viewportWidth);
        el.style.transform =
          `translate(-50%, -50%) translate(${pose.x.toFixed(1)}px, ${pose.y.toFixed(1)}%) ` +
          `rotate(${pose.rotate.toFixed(2)}deg) scale(${pose.scale.toFixed(3)})`;
        el.style.zIndex = String(pose.z);
      });
    };

    const settle = () => apply(1);

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const total = stage.offsetHeight - window.innerHeight;
        const p = total > 0 ? -stage.getBoundingClientRect().top / total : 1;
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
    <div ref={stageRef} className={styles.heroStage}>
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
