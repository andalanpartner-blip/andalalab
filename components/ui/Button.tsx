"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "link";
export type ButtonSize = "md" | "sm";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Shows a spinner + disables the button; children stay for layout stability. */
  readonly loading?: boolean;
  /** Optional trailing element (e.g. an arrow). Hidden while loading. */
  readonly trailing?: ReactNode;
};

/**
 * The one button. Variants: primary (ink fill), secondary (hairline),
 * ghost (quiet), link (underlined text). A disabled or loading button is
 * visibly inert — reduced opacity *and* a not-allowed cursor *and* no hover
 * lift. Focus uses the global :focus-visible ring.
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  trailing,
  disabled,
  children,
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  const isInert = disabled || loading;
  return (
    <button
      type={type}
      disabled={isInert}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      className={[styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ")}
      {...rest}
    >
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
      <span className={styles.label}>{children}</span>
      {trailing && !loading ? (
        <span className={styles.trailing} aria-hidden="true">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}
