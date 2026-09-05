"use client";

import { useRef } from "react";
import styles from "./ErrorBanner.module.css";

export type ErrorBannerProps = {
  readonly title?: string;
  readonly message: string;
  readonly onRetry?: () => void;
};

export function ErrorBanner({ title = "Something needs a second look", message, onRetry }: ErrorBannerProps) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div className={`container`}>
      <div className={styles.wrap} role="alert" ref={ref} tabIndex={-1}>
        <svg
          className={styles.icon}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className={styles.body}>
          <p className={styles.title}>{title}</p>
          <p className={styles.message}>{message}</p>
          {onRetry ? (
            <div className={styles.actions}>
              <button type="button" className={styles.retry} onClick={onRetry}>
                Try again
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
