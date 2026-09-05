"use client";

import { useCallback, useState } from "react";
import styles from "./CopyButton.module.css";

export type CopyButtonProps = {
  readonly text: string;
  readonly label: string;
  readonly copiedLabel: string;
  readonly variant?: "default" | "inverted";
};

/** Copies exactly the text it was given — never a sibling block's content. */
export function CopyButton({ text, label, copiedLabel, variant = "default" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(() => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {
        // Clipboard permission denied or unavailable — nothing useful to fall back to.
      });
  }, [text]);

  return (
    <button
      type="button"
      className={`${styles.button} ${variant === "inverted" ? styles.inverted : ""}`}
      onClick={handleClick}
      aria-live="polite"
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
