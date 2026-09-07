"use client";

import { useEffect, useState } from "react";
import styles from "./marketing.module.css";

const LINKS = [
  { href: "#problem", label: "Product" },
  { href: "#workflow", label: "Workflow" },
  { href: "#team", label: "For Teams" },
  { href: "#loop", label: "How it thinks" }
];

/**
 * Minimal marketing navigation. Transparent over the hero, gains a hairline +
 * paper backing once the page scrolls. Mobile: a simple disclosure menu.
 */
export function MarketingNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className={styles.nav} data-scrolled={scrolled || undefined} data-open={open || undefined}>
      <div className={styles.navInner}>
        <a href="#top" className={styles.brand} aria-label="Andala — home">
          <span className={styles.brandMark} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M12 3 21 20H3Z" fill="currentColor" />
            </svg>
          </span>
          Andala
        </a>

        <nav className={styles.navLinks} aria-label="Primary">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>

        <div className={styles.navActions}>
          <a className={styles.navSignIn} href="/login">
            Sign in
          </a>
          <a className={styles.navCta} href="/login">
            Get Started
          </a>
          <button
            type="button"
            className={styles.navToggle}
            aria-expanded={open}
            aria-controls="m-mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            <span aria-hidden="true" data-open={open || undefined} />
          </button>
        </div>
      </div>

      <div id="m-mobile-menu" className={styles.mobileMenu} hidden={!open}>
        <nav aria-label="Mobile">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className={styles.mobileActions}>
          <a className={styles.navSignIn} href="/login">
            Sign in
          </a>
          <a className={styles.navCta} href="/login">
            Get Started
          </a>
        </div>
      </div>
    </header>
  );
}
