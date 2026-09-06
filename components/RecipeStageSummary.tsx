import type { DesignRecipe } from "../types/schemas/recipe.schema";
import styles from "./RecipeStageSummary.module.css";
import { StageHeader } from "./ui/StageHeader";
import { Button } from "./ui/Button";
import { Meter } from "./ui/Meter";
import { formatChannel, humanize, percent, titleCase } from "../lib/format";

/**
 * The Recipe stage shows only the decisions that define the look. The full
 * recipe — every value, with provenance — lives in the Decision Ledger.
 */
export function RecipeStageSummary({
  recipe,
  onOpenLedger
}: {
  recipe: DesignRecipe;
  onOpenLedger: () => void;
}) {
  const defining: { label: string; value: string; sub?: string }[] = [
    { label: "Movement", value: recipe.movement.name, sub: `${percent(recipe.movement.influence)} influence survived doctrine` },
    { label: "Composition", value: humanize(recipe.composition.strategy), sub: `${titleCase(recipe.composition.balance)} balance · ${titleCase(recipe.composition.flow)} flow` },
    { label: "Typography", value: humanize(recipe.typography.strategy), sub: recipe.typography.primary },
    { label: "Colour", value: humanize(recipe.color.strategy), sub: `${recipe.color.palette_size}-colour palette` },
    {
      label: "Imagery",
      value: titleCase(recipe.photographic_character.photographic_style),
      sub: `${titleCase(recipe.photographic_character.realism_target)} · artificiality ${titleCase(recipe.photographic_character.artificiality_risk.band)}`
    },
    { label: "Platform", value: formatChannel(recipe.platform.channel), sub: titleCase(recipe.platform.aspect_ratio_id) }
  ];

  return (
    <section className={`container ${styles.section}`} aria-labelledby="recipe-heading">
      <StageHeader
        kicker="Stage 4 · the design recipe"
        title="Design Recipe"
        id="recipe-heading"
        sub="The decisions that define the look. Open the decision ledger for every value, with the country, movement or industry behind it."
        aside={
          <Button variant="secondary" size="sm" onClick={onOpenLedger}>
            Open decision ledger
          </Button>
        }
      />

      <dl className={styles.grid}>
        {defining.map((item) => (
          <div className={styles.item} key={item.label}>
            <dt className={styles.label}>{item.label}</dt>
            <dd className={styles.value}>{item.value}</dd>
            {item.sub ? <dd className={styles.sub}>{item.sub}</dd> : null}
          </div>
        ))}
      </dl>

      <div className={styles.meters}>
        <Meter label="Hierarchy" ratio={recipe.hierarchy.strength} emphasis />
        <Meter label="Whitespace" ratio={recipe.composition.whitespace} emphasis />
        <Meter label="Contrast" ratio={recipe.color.contrast} emphasis />
      </div>
    </section>
  );
}
