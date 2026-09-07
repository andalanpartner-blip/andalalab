"use client";

import { useEffect, useRef } from "react";
import styles from "./marketing.module.css";

/**
 * The "AI that thinks before it prompts" stack.
 *
 * A sticky section: four oversized labels reveal one after another as the
 * section scrolls, while a central object rotates and settles. Scroll progress
 * is written to a CSS variable (`--p`, 0→1); the CSS decides what appears when.
 *
 * Reduced motion / no JS: every layer is shown and the object is static.
 */

const LAYERS = [
  { k: "Strategy", d: "What the work must achieve, for whom, and why." },
  { k: "Design intelligence", d: "Doctrine, movement, culture and constraints — resolved, not guessed." },
  { k: "Creative decision", d: "One coherent direction, with every value traceable to a source." },
  { k: "Visual execution", d: "A compiled prompt and a generated visual — the last step, not the first." }
];

export function LayerStack() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const stage = stageRef.current;
    if (!wrap || !stage) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;

    const set = (p: number) => stage.style.setProperty("--p", String(Math.max(0, Math.min(1, p))));

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const rect = wrap.getBoundingClientRect();
        const total = wrap.offsetHeight - window.innerHeight;
        set(total > 0 ? -rect.top / total : 0);
      });
    };

    if (reduce.matches) {
      set(1);
      return;
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={wrapRef} className={styles.layerWrap}>
      <div ref={stageRef} className={styles.layerSticky}>
        <div className={styles.layerObject} aria-hidden="true">
          <svg viewBox="0 0 200 200">
            <rect className={styles.layerShapeA} x="46" y="46" width="108" height="108" rx="18" />
            <circle className={styles.layerShapeB} cx="100" cy="100" r="44" />
            <path className={styles.layerShapeC} d="M100 40v120M40 100h120" />
          </svg>
        </div>
        <ol className={styles.layerList}>
          {LAYERS.map((l, i) => (
            <li key={l.k} className={styles.layerItem} style={{ ["--i" as string]: i }}>
              <span className={styles.layerIndex}>{String(i + 1).padStart(2, "0")}</span>
              <span className={styles.layerLabel}>{l.k}</span>
              <span className={styles.layerDesc}>{l.d}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
