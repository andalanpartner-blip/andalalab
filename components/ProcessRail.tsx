import styles from "./ProcessRail.module.css";

export type StageStatus = "pending" | "active" | "done";
export type ProcessStage = { readonly key: string; readonly label: string; readonly status: StageStatus };

export function ProcessRail({ stages }: { stages: readonly ProcessStage[] }) {
  const activeStage = stages.find((stage) => stage.status === "active");
  return (
    <nav className={styles.wrap} aria-label="Design process">
      <div className="container">
        <ol className={styles.rail}>
          {stages.map((stage, index) => (
            <li key={stage.key} className={styles.step} data-status={stage.status}>
              <span className={styles.dot} aria-hidden="true" />
              <span className={styles.label}>{stage.label}</span>
              {index < stages.length - 1 ? <span className={styles.connector} aria-hidden="true" /> : null}
            </li>
          ))}
        </ol>
        <p className="visually-hidden" role="status" aria-live="polite">
          {activeStage ? `Working: ${activeStage.label}` : "Idle"}
        </p>
      </div>
    </nav>
  );
}
