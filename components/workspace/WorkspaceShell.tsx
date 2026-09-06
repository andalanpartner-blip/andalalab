"use client";

import { useEffect, useState, type ReactNode } from "react";
import styles from "./WorkspaceShell.module.css";
import { StageRail } from "./StageRail";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import type { StageId, StageState } from "../../lib/workspace";

export type WorkspaceShellProps = {
  readonly states: Record<StageId, StageState>;
  readonly active: StageId;
  readonly onNavigate: (stage: StageId) => void;
  /** The decision ledger content (RecipeBoard today, DecisionLedger from slice 7). */
  readonly ledger: ReactNode;
  readonly ledgerAvailable: boolean;
  /** Right-aligned actions above the canvas, e.g. "Start a new brief". */
  readonly toolbar?: ReactNode;
  /** The AIStatus line — an always-present slot below the toolbar. */
  readonly aiStatus?: ReactNode;
  readonly children: ReactNode;
};

export function WorkspaceShell({
  states,
  active,
  onNavigate,
  ledger,
  ledgerAvailable,
  toolbar,
  aiStatus,
  children
}: WorkspaceShellProps) {
  const [ledgerOpen, setLedgerOpen] = useState(false);

  // Close the ledger on stage change and on Escape.
  useEffect(() => setLedgerOpen(false), [active]);
  useEffect(() => {
    if (!ledgerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLedgerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ledgerOpen]);

  return (
    <div className={`container ${styles.shell}`}>
      <StageRail states={states} active={active} onNavigate={onNavigate} />

      <div className={styles.canvasCol}>
        <div className={styles.toolbar}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setLedgerOpen(true)}
            aria-haspopup="dialog"
          >
            Decision ledger
          </Button>
          <div className={styles.toolbarRight}>{toolbar}</div>
        </div>

        {aiStatus ? <div className={styles.aiStatusRow}>{aiStatus}</div> : null}

        <div className={styles.canvas}>{children}</div>
      </div>

      {ledgerOpen ? (
        <div
          className={styles.ledgerScrim}
          role="dialog"
          aria-label="Decision ledger"
          onClick={() => setLedgerOpen(false)}
        >
          <aside className={styles.ledger} onClick={(e) => e.stopPropagation()}>
            <div className={styles.ledgerHead}>
              <span className={styles.ledgerTitle}>Decision ledger</span>
              <button
                type="button"
                className={styles.ledgerClose}
                onClick={() => setLedgerOpen(false)}
                aria-label="Close decision ledger"
              >
                ✕
              </button>
            </div>
            <div className={styles.ledgerBody}>
              {ledgerAvailable ? (
                ledger
              ) : (
                <EmptyState
                  title="Nothing decided yet"
                  description="Build the design recipe to see every value the AI set, with the country, movement or industry that produced it."
                  compact
                />
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
