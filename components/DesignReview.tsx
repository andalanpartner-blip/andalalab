import type { DesignCriticReport, CriticFinding } from "../engine";
import styles from "./DesignReview.module.css";
import { titleCase } from "../lib/format";

const VERDICT_COPY: Record<DesignCriticReport["verdict"], string> = {
  PASS: "Pass",
  REVIEW: "Review",
  BLOCK: "Block"
};

const SEVERITY_LABEL: Record<CriticFinding["severity"], string> = {
  P0: "Critical",
  P1: "Review",
  P2: "Note"
};

const AREA_LABEL: Partial<Record<CriticFinding["area"], string>> = {
  dkv: "DKV",
  "prompt-coverage": "Prompt coverage",
  "stereotype-guard": "Stereotype guard"
};

export function DesignReview({ report }: { report: DesignCriticReport }) {
  return (
    <section className={`container reveal ${styles.section}`} aria-labelledby="review-heading">
      <p className={styles.kicker}>Pre-generation check — deterministic, no AI</p>
      <h2 id="review-heading" className={styles.title}>
        Design Review
      </h2>

      <div className={`${styles.verdict} ${styles[`verdict_${report.verdict}`]}`}>
        <span className={styles.badge}>{VERDICT_COPY[report.verdict]}</span>
        <span className={styles.summary}>{report.summary}</span>
      </div>

      {report.findings.length > 0 ? (
        <ul className={styles.findings}>
          {report.findings.map((finding, index) => (
            <li key={`${finding.check}-${index}`} className={styles[`finding_${finding.severity}`]}>
              <div className={styles.findingHead}>
                <span className={styles.severity}>{SEVERITY_LABEL[finding.severity]}</span>
                <span className={styles.area}>{AREA_LABEL[finding.area] ?? titleCase(finding.area)}</span>
              </div>
              <p className={styles.message}>{finding.message}</p>
              {finding.evidence.length > 0 ? (
                <p className={styles.evidence}>{finding.evidence.join(" · ")}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.note}>
          Every checked property of the recipe and the compiled prompt holds. {report.checks_run} checks
          ran against the resolved DKV values, the immutable anchors, the movement influence, the
          photographic finish, the stereotype guard and the constraint coverage.
        </p>
      )}
    </section>
  );
}
