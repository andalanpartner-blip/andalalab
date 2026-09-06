import type { DesignCriticReport } from "../engine";
import styles from "./ComplianceChip.module.css";
import { Badge, type BadgeTone } from "./ui/Badge";

const VERDICT_TONE: Record<DesignCriticReport["verdict"], BadgeTone> = {
  PASS: "ok",
  REVIEW: "attention",
  BLOCK: "critical"
};

const VERDICT_COPY: Record<DesignCriticReport["verdict"], string> = {
  PASS: "Compliance: pass",
  REVIEW: "Compliance: review",
  BLOCK: "Compliance: block"
};

/** A compact P4.0 verdict, linking to the full Review stage. */
export function ComplianceChip({
  critic,
  onOpen
}: {
  critic: DesignCriticReport;
  onOpen: () => void;
}) {
  return (
    <button type="button" className={styles.chip} onClick={onOpen}>
      <Badge tone={VERDICT_TONE[critic.verdict]} variant="soft" dot>
        {VERDICT_COPY[critic.verdict]}
      </Badge>
      <span className={styles.open}>Open review →</span>
    </button>
  );
}
