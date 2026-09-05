import type { NormalizedBrief } from "../types/schemas/brief.schema";
import type { DesignContract } from "../types/schemas/contract.schema";
import type { CountryInfluence } from "../services/pipeline.service";
import styles from "./BriefIntelligence.module.css";
import { Tag } from "./ui/Tag";
import { derivedFieldKeys, HIGH_CONFIDENCE } from "../lib/derived";
import { formatAgeRange, formatChannel, humanize, percent } from "../lib/format";

export type BriefIntelligenceProps = {
  readonly brief: NormalizedBrief;
  readonly contract: DesignContract;
  readonly derived: readonly string[];
  readonly countries: readonly CountryInfluence[];
};

export function BriefIntelligence({ brief, contract, derived, countries }: BriefIntelligenceProps) {
  const derivedKeys = derivedFieldKeys(derived);

  const confidenceTag = (key: string) => {
    if (derivedKeys.has(key)) return <Tag>Derived</Tag>;
    const confidence = brief.confidence[key];
    if (confidence !== undefined && confidence >= HIGH_CONFIDENCE) {
      return <Tag tone="accent">High confidence</Tag>;
    }
    return null;
  };

  return (
    <section className={`container reveal ${styles.section}`} aria-labelledby="intel-heading">
      <div className={styles.head}>
        <div>
          <p className={styles.kicker}>What I understood</p>
          <h2 id="intel-heading" className={styles.title}>
            Brief Intelligence
          </h2>
        </div>
        <p className={styles.coreMessage}>{contract.core_message}</p>
      </div>

      <div className={styles.grid}>
        <div className={styles.cell}>
          <div className={styles.cellHead}>
            <span className={styles.label}>Objective</span>
            {confidenceTag("objective")}
          </div>
          <span className={styles.value}>{humanize(contract.objective)}</span>
        </div>

        <div className={styles.cell}>
          <div className={styles.cellHead}>
            <span className={styles.label}>Industry</span>
            {confidenceTag("industry_id")}
          </div>
          <span className={styles.value}>{contract.industry.name}</span>
        </div>

        <div className={styles.cell}>
          <div className={styles.cellHead}>
            <span className={styles.label}>Audience</span>
            {confidenceTag("audience.description")}
          </div>
          <span className={styles.value}>{contract.audience.description}</span>
          <span className={styles.metaLine}>{formatAgeRange(contract.audience.age_range)}</span>
        </div>

        <div className={styles.cell}>
          <div className={styles.cellHead}>
            <span className={styles.label}>Platform</span>
            {confidenceTag("platform.channel")}
          </div>
          <span className={styles.value}>{formatChannel(contract.platform.channel)}</span>
          <span className={styles.metaLine}>{contract.visual_type.aspect_ratio_id.replace("-", " · ")}</span>
        </div>

        <div className={styles.cell}>
          <div className={styles.cellHead}>
            <span className={styles.label}>Country Influence</span>
            {confidenceTag("country")}
          </div>
          <div className={styles.bars}>
            {countries.map((country) => (
              <div className={styles.barRow} key={country.id}>
                <span className={styles.barName}>{country.name}</span>
                <span className={styles.barTrack}>
                  <span className={styles.barFill} style={{ width: percent(country.weight) }} />
                </span>
                <span className={styles.barPct}>{percent(country.weight)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
