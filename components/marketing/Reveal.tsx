"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";

/**
 * Progressive scroll reveal — the marketing site's one entrance.
 *
 * A wrapper that fades + lifts its content into place the first time it enters
 * the viewport. Motion is progressive enhancement: the content is fully in the
 * DOM and readable with JS disabled, and `prefers-reduced-motion` shows it
 * immediately with no transform. `stagger` cascades direct children.
 */
export type RevealProps = {
  readonly children: ReactNode;
  readonly as?: ElementType;
  /** Seconds of delay before this element animates. */
  readonly delay?: number;
  /** Cascade direct children by this many seconds each. */
  readonly stagger?: number;
  /** Entrance direction. */
  readonly from?: "up" | "left" | "right" | "none";
  readonly className?: string;
  readonly id?: string;
};

export function Reveal({
  children,
  as: Tag = "div",
  delay = 0,
  stagger = 0,
  from = "up",
  className,
  id
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(true);
      return;
    }
    // `inView` is the shared visibility test. It runs on mount (catches a
    // restored scroll position or a short viewport) and, as a fallback, on
    // scroll — so the reveal never depends on IntersectionObserver actually
    // delivering (background tabs and some embedded contexts throttle it).
    const inView = () => {
      const rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight * 0.9 && rect.bottom > 0;
    };

    let io: IntersectionObserver | null = null;
    let done = false;

    const onScroll = () => {
      if (inView()) reveal();
    };
    function reveal() {
      if (done) return;
      done = true;
      setShown(true);
      io?.disconnect();
      window.removeEventListener("scroll", onScroll);
    }

    if (inView()) {
      reveal();
      return;
    }

    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) reveal();
          }
        },
        { rootMargin: "0px 0px -12% 0px", threshold: 0.05 }
      );
      io.observe(el);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io?.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <Tag
      ref={ref}
      id={id}
      data-reveal={from}
      data-stagger={stagger ? "" : undefined}
      className={["m-reveal", shown ? "is-in" : "", className].filter(Boolean).join(" ")}
      style={
        {
          "--reveal-delay": `${delay}s`,
          "--reveal-step": `${stagger}s`
        } as React.CSSProperties
      }
    >
      {children}
    </Tag>
  );
}
