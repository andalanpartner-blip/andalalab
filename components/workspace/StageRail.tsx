"use client";

import { useState } from "react";
import styles from "./StageRail.module.css";
import { StatusDot, type DotState } from "../ui/StatusDot";
import {
  STAGE_LIST,
  type StageId,
  type StageState
} from "../../lib/workspace";

export type StageRailProps = {
  readonly states: Record<StageId, StageState>;
  readonly active: StageId;
  readonly onNavigate: (stage: StageId) => void;
};

function dotState(state: StageState, future: boolean): DotState {
  if (state === "active") return "active";
  if (future) return "future";
  if (state === "done") return "done";
  if (state === "blocked") return "blocked";
  return "available";
}

function StepList({ states, active, onNavigate, onPick }: StageRailProps & { onPick?: () => void }) {
  return (
    <ol className={styles.list}>
      {STAGE_LIST.map((meta) => {
        const state = states[meta.id];
        const reachable = state !== "locked";
        const stateWord =
          state === "active"
            ? "current"
            : state === "done"
              ? "done"
              : state === "blocked"
                ? "blocked"
                : reachable
                  ? "available"
                  : meta.future
                    ? "coming with P8"
                    : "locked";
        return (
          <li key={meta.id}>
            <button
              type="button"
              className={styles.step}
              data-state={state}
              data-active={meta.id === active || undefined}
              aria-current={meta.id === active ? "step" : undefined}
              aria-label={`Stage ${meta.index} of ${STAGE_LIST.length}, ${meta.label}, ${stateWord}`}
              title={meta.label}
              disabled={!reachable}
              onClick={() => {
                onNavigate(meta.id);
                onPick?.();
              }}
            >
              <span className={styles.dot}>
                <StatusDot state={dotState(state, meta.future)} />
              </span>
              <span className={styles.index}>{meta.index}</span>
              <span className={styles.label}>{meta.label}</span>
              {meta.future ? <span className={styles.future}>soon</span> : null}
              {state === "blocked" ? <span className={styles.blockedTag}>blocked</span> : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function StageRail(props: StageRailProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const activeMeta = STAGE_LIST.find((m) => m.id === props.active) ?? STAGE_LIST[0]!;
  const order = STAGE_LIST.map((m) => m.id);
  const idx = order.indexOf(props.active);
  const prev = order.slice(0, idx).reverse().find((id) => props.states[id] !== "locked");
  const next = order.slice(idx + 1).find((id) => props.states[id] !== "locked");

  return (
    <>
      {/* Desktop / tablet — vertical rail */}
      <nav className={styles.rail} aria-label="Workflow stages">
        <StepList {...props} />
      </nav>

      {/* Mobile — a compact stepper that never overflows */}
      <div className={styles.mobileBar}>
        <button
          type="button"
          className={styles.mobilePrev}
          disabled={!prev}
          aria-label="Previous stage"
          onClick={() => prev && props.onNavigate(prev)}
        >
          ‹
        </button>
        <button
          type="button"
          className={styles.mobileCurrent}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
        >
          <span className={styles.mobileCount}>
            {activeMeta.index} / {STAGE_LIST.length}
          </span>
          <span className={styles.mobileLabel}>{activeMeta.label}</span>
        </button>
        <button
          type="button"
          className={styles.mobileNext}
          disabled={!next}
          aria-label="Next stage"
          onClick={() => next && props.onNavigate(next)}
        >
          ›
        </button>
      </div>

      {sheetOpen ? (
        <div className={styles.sheetScrim} role="dialog" aria-label="All stages" onClick={() => setSheetOpen(false)}>
          <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <div className={styles.sheetHead}>
              <span>Stages</span>
              <button type="button" className={styles.sheetClose} onClick={() => setSheetOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <StepList {...props} onPick={() => setSheetOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
