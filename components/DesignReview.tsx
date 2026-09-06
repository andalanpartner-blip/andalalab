import type { DesignCriticReport, CriticFinding } from "../engine";
import styles from "./DesignReview.module.css";
import { titleCase } from "../lib/format";
import { StageHeader } from "./ui/StageHeader";
import { Badge, type BadgeTone } from "./ui/Badge";

const VERDICT_COPY: Record<DesignCriticReport["verdict"], string> = {
  PASS: "Pass",
  REVIEW: "Review",
  BLOCK: "Block"
};

const VERDICT_TONE: Record<DesignCriticReport["verdict"], BadgeTone> = {
  PASS: "ok",
  REVIEW: "attention",
  BLOCK: "critical"
};

const SEVERITY_LABEL: Record<CriticFinding["severity"], string> = {
  P0: "Critical",
  P1: "Review",
  P2: "Note"
};

const SEVERITY_TONE: Record<CriticFinding["severity"], BadgeTone> = {
  P0: "critical",
  P1: "attention",
  P2: "neutral"
};

const AREA_LABEL: Partial<Record<CriticFinding["area"], string>> = {
  dkv: "DKV",
  "prompt-coverage": "Prompt coverage",
  "stereotype-guard": "Stereotype guard"
};

export function DesignReview({ report }: { report: DesignCriticReport }) {
  return (
    <section className={`container reveal ${styles.section}`} aria-labelledby="review-heading">
      <StageHeader
        kicker="Pre-generation check — deterministic, no AI"
        title="Design Review"
        id="review-heading"
      />

      <div className={`${styles.verdict} ${styles[`verdict_${report.verdict}`]}`}>
        <Badge tone={VERDICT_TONE[report.verdict]} variant="soft">
          {VERDICT_COPY[report.verdict]}
        </Badge>
        <span className={styles.summary}>{report.summary}</span>
      </div>

      {report.findings.length > 0 ? (
        <ul className={styles.findings}>
          {report.findings.map((finding, index) => (
            <li key={`${finding.check}-${index}`} className={styles[`finding_${finding.severity}`]}>
              <div className={styles.findingHead}>
                <Badge tone={SEVERITY_TONE[finding.severity]} variant="soft">
                  {SEVERITY_LABEL[finding.severity]}
                </Badge>
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
