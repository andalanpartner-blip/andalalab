import type { ReactNode } from "react";
import type { DesignRecipe } from "../types/schemas/recipe.schema";
import type { SelectedGraphicDevice } from "../types/schemas/graphic-treatment.schema";
import { resolveVisualAdapter, VISUAL_ADAPTER_LABEL, visualAdapterSummary } from "../engine";
import styles from "./RecipeBoard.module.css";
import { Collapsible } from "./ui/Collapsible";
import { Meter } from "./ui/Meter";
import { formatChannel, humanize, percent, titleCase } from "../lib/format";

function Def({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={styles.defRow}>
      <span className={styles.defLabel}>{label}</span>
      <span className={styles.defValue}>{value}</span>
    </div>
  );
}

function DefGrid({ children }: { children: ReactNode }) {
  return <div className={styles.defGrid}>{children}</div>;
}

function PillList({ items }: { items: readonly string[] }) {
  return (
    <div className={styles.pillList}>
      {items.map((item) => (
        <span className={styles.pill} key={item}>
          {item}
        </span>
      ))}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  must: "Must",
  must_not: "Must not",
  prefer: "Prefer",
  avoid: "Avoid"
};

/** P2.9 — plain-English label for each keyed realism note. */
const REALISM_NOTE_LABEL: Record<string, string> = {
  "highlight-rolloff": "Believable highlight rolloff and realistic shadow transitions",
  "controlled-sharpening": "Controlled sharpening and natural depth of field",
  "restrained-retouching": "Restrained retouching — no plastic or wax skin",
  "material-response": "Realistic material response and surface variation",
  "skin-and-face": "Realistic skin texture, natural facial asymmetry, believable eye reflections",
  "hair-and-hands": "Realistic hair strands and natural hand and finger anatomy",
  "stylised-but-coherent": "Deliberately stylised, but anatomy and perspective stay coherent"
};

type GraphicTreatmentSpec = DesignRecipe["graphic_treatment"];
type GraphicTreatmentDeviceKey = {
  [K in keyof GraphicTreatmentSpec]: GraphicTreatmentSpec[K] extends readonly SelectedGraphicDevice[] ? K : never;
}[keyof GraphicTreatmentSpec];

const GRAPHIC_TREATMENT_GROUPS: readonly { key: GraphicTreatmentDeviceKey; label: string }[] = [
  { key: "structural_devices", label: "Structural" },
  { key: "expressive_devices", label: "Expressive" },
  { key: "image_treatments", label: "Image Treatment" },
  { key: "typography_treatments", label: "Typography Treatment" },
  { key: "textures", label: "Texture" },
  { key: "patterns", label: "Pattern" },
  { key: "layering", label: "Layering" },
  { key: "accents", label: "Graphic Accent" }
];

function GraphicTreatmentSection({ devices }: { devices: readonly SelectedGraphicDevice[] }) {
  return (
    <div className={styles.pillList}>
      {devices.map((device) => (
        <span className={styles.pill} key={device.id} title={device.rationale}>
          {device.name}
        </span>
      ))}
    </div>
  );
}

export function RecipeBoard({ recipe }: { recipe: DesignRecipe }) {
  const dimensionEntries = Object.entries(recipe.culture.dimensions);

  const visualAdapter = resolveVisualAdapter({
    photographicStyle: recipe.photographic_character.photographic_style,
    realismTarget: recipe.photographic_character.realism_target
  });
  const visualAdapterLabel = VISUAL_ADAPTER_LABEL[visualAdapter.adapterId].en;

  return (
    <section className={`container reveal ${styles.section}`} aria-labelledby="recipe-heading">
      <div className={styles.head}>
        <p className={styles.kicker}>Ready to brief a designer or a generator</p>
        <h2 id="recipe-heading" className={styles.title}>
          Design Recipe
        </h2>
        <p className={styles.sub}>Every value here traces back to the country, movement or industry that produced it.</p>
      </div>

      <div className={styles.board}>
        <Collapsible title="Composition" hint={humanize(recipe.composition.strategy)} defaultOpen>
          <DefGrid>
            <Def label="Strategy" value={humanize(recipe.composition.strategy)} />
            <Def label="Balance" value={titleCase(recipe.composition.balance)} />
            <Def label="Flow" value={titleCase(recipe.composition.flow)} />
            <Def label="Spatial behavior" value={recipe.composition.spatial_behavior} />
          </DefGrid>
          <div className={styles.meterStack}>
            <Meter label="Density" ratio={recipe.composition.density} />
            <Meter label="Whitespace" ratio={recipe.composition.whitespace} />
          </div>
        </Collapsible>

        <Collapsible title="Grid" hint={`${recipe.grid.columns} × ${recipe.grid.rows}`}>
          <DefGrid>
            <Def label="Columns" value={recipe.grid.columns} />
            <Def label="Rows" value={recipe.grid.rows} />
            <Def label="Gutter" value={percent(recipe.grid.gutter_ratio)} />
            <Def label="Margin" value={percent(recipe.grid.margin_ratio)} />
          </DefGrid>
          <div className={styles.meterStack}>
            <Meter label="Modularity" ratio={recipe.grid.modularity} />
          </div>
        </Collapsible>

        <Collapsible title="Hierarchy" hint={`${recipe.hierarchy.levels.length} zones`}>
          <div className={styles.meterStack}>
            <Meter label="Strength" ratio={recipe.hierarchy.strength} />
            <Meter label="Focal dominance" ratio={recipe.hierarchy.focal_dominance} />
          </div>
          <div className={styles.readingOrder}>
            {recipe.hierarchy.reading_order.map((zone, index) => (
              <span key={zone}>
                {titleCase(zone)}
                {index < recipe.hierarchy.reading_order.length - 1 ? (
                  <span className={styles.arrow}> → </span>
                ) : null}
              </span>
            ))}
          </div>
        </Collapsible>

        <Collapsible title="Typography" hint={humanize(recipe.typography.strategy)} defaultOpen>
          <DefGrid>
            <Def label="Strategy" value={humanize(recipe.typography.strategy)} />
            <Def label="Case" value={titleCase(recipe.typography.case_bias)} />
            <Def label="Weight" value={titleCase(recipe.typography.weight_bias)} />
            <Def label="Scale ratio" value={recipe.typography.scale_ratio.toFixed(2)} />
            <Def label="Primary" value={recipe.typography.primary} />
            {recipe.typography.secondary ? <Def label="Secondary" value={recipe.typography.secondary} /> : null}
            <Def label="Brand locked" value={recipe.typography.brand_locked ? "Yes" : "No"} />
          </DefGrid>
        </Collapsible>

        <Collapsible title="Color" hint={humanize(recipe.color.strategy)} defaultOpen>
          <DefGrid>
            <Def label="Strategy" value={humanize(recipe.color.strategy)} />
            <Def label="Palette size" value={recipe.color.palette_size} />
          </DefGrid>
          <div className={styles.meterStack}>
            <Meter label="Saturation" ratio={recipe.color.saturation} />
            <Meter label="Contrast" ratio={recipe.color.contrast} />
            <Meter label="Complexity" ratio={recipe.color.complexity} />
          </div>
          <PillList items={recipe.color.relationships} />
          {recipe.color.brand_palette.length > 0 ? (
            <div className={styles.swatchRow}>
              {recipe.color.brand_palette.map((entry) => (
                <span className={styles.swatch} key={entry.role}>
                  <span
                    className={styles.swatchChip}
                    style={{ background: entry.hex }}
                    aria-hidden="true"
                  />
                  {entry.name}
                </span>
              ))}
            </div>
          ) : null}
        </Collapsible>

        <Collapsible title="Imagery" hint={`${percent(recipe.imagery.realism)} realism`}>
          <DefGrid>
            <Def label="Subject treatment" value={recipe.imagery.subject_treatment} />
            <Def label="Framing" value={recipe.imagery.framing} />
          </DefGrid>
          <div className={styles.meterStack}>
            <Meter label="Realism" ratio={recipe.imagery.realism} />
          </div>
        </Collapsible>

        <Collapsible title="Lighting">
          <DefGrid>
            <Def label="Direction" value={recipe.lighting.direction} />
          </DefGrid>
          <div className={styles.meterStack}>
            <Meter label="Contrast" ratio={recipe.lighting.contrast} />
          </div>
        </Collapsible>

        <Collapsible title="Materiality">
          <PillList items={recipe.materiality.surfaces} />
          <div className={styles.meterStack}>
            <Meter label="Texture" ratio={recipe.materiality.texture} />
          </div>
        </Collapsible>

        <Collapsible title="Graphic Language">
          <DefGrid>
            <Def label="Shape logic" value={recipe.graphic_language.shape_logic} />
            <Def label="Rhythm" value={recipe.graphic_language.rhythm} />
          </DefGrid>
          <div className={styles.meterStack}>
            <Meter label="Ornament" ratio={recipe.graphic_language.ornament} />
          </div>
        </Collapsible>

        <Collapsible
          title="Graphic Treatment"
          hint={titleCase(recipe.graphic_treatment.intensity)}
        >
          {recipe.graphic_treatment.intensity === "none" ? (
            <p className={styles.movementNote}>No graphic devices selected — restraint is the correct treatment here.</p>
          ) : (
            GRAPHIC_TREATMENT_GROUPS.filter((group) => recipe.graphic_treatment[group.key].length > 0).map((group) => (
              <div key={group.key}>
                <p className={styles.movementLabel}>{group.label}</p>
                <GraphicTreatmentSection devices={recipe.graphic_treatment[group.key]} />
              </div>
            ))
          )}
        </Collapsible>

        <Collapsible
          title="Photographic Character"
          hint={titleCase(recipe.photographic_character.photographic_style)}
        >
          <DefGrid>
            <Def
              label="Photographic style"
              value={titleCase(recipe.photographic_character.photographic_style)}
            />
            <Def
              label="Realism target"
              value={titleCase(recipe.photographic_character.realism_target)}
            />
            <Def label="Camera" value={titleCase(recipe.photographic_character.camera_language)} />
            <Def label="Lens" value={humanize(recipe.photographic_character.lens_character)} />
            <Def
              label="Depth of field"
              value={titleCase(recipe.photographic_character.depth_of_field)}
            />
            <Def
              label="Lighting"
              value={titleCase(recipe.photographic_character.lighting_behavior)}
            />
            <Def
              label="Color response"
              value={titleCase(recipe.photographic_character.color_response)}
            />
            <Def
              label="Skin / face realism"
              value={`${titleCase(recipe.photographic_character.skin_realism)} / ${titleCase(
                recipe.photographic_character.face_realism
              )}`}
            />
            <Def
              label="Material realism"
              value={titleCase(recipe.photographic_character.material_realism)}
            />
            <Def
              label="Imperfection level"
              value={titleCase(recipe.photographic_character.imperfection_level)}
            />
          </DefGrid>
          <div className={styles.meterStack}>
            <Meter
              label={`Artificiality risk · ${titleCase(
                recipe.photographic_character.artificiality_risk.band
              )}`}
              ratio={recipe.photographic_character.artificiality_risk.score / 100}
            />
          </div>

          <p className={styles.movementLabel}>Finish</p>
          <DefGrid>
            <Def
              label="Style"
              value={titleCase(recipe.photographic_character.finish.style.value)}
            />
            <Def
              label="Color"
              value={titleCase(recipe.photographic_character.finish.color_character.value)}
            />
            <Def
              label="Lighting"
              value={
                recipe.photographic_character.finish.lighting_character
                  ? titleCase(recipe.photographic_character.finish.lighting_character.value)
                  : "—"
              }
            />
            <Def
              label="Artificiality"
              value={`${titleCase(recipe.photographic_character.finish.artificiality.value)} · ${
                recipe.photographic_character.finish.artificiality.score
              }/100`}
            />
          </DefGrid>
          {recipe.photographic_character.finish.realism_notes.length > 0 ? (
            <>
              <p className={styles.movementLabel}>Realism Notes</p>
              <PillList
                items={recipe.photographic_character.finish.realism_notes.map(
                  (key) => REALISM_NOTE_LABEL[key] ?? humanize(key)
                )}
              />
            </>
          ) : (
            <p className={styles.movementNote}>
              Non-photographic medium — colour character only, no photographic lighting or realism
              controls.
            </p>
          )}
        </Collapsible>

        <Collapsible title="Visual Generation" hint={visualAdapterLabel}>
          <DefGrid>
            <Def label="Adapter" value={visualAdapterLabel} />
            <Def label="Realism target" value={titleCase(recipe.photographic_character.realism_target)} />
          </DefGrid>
          <p className={styles.movementLabel}>Why this adapter</p>
          <p className={styles.movementNote}>{visualAdapter.rationale}</p>
          <p className={styles.movementLabel}>How it renders</p>
          <p className={styles.movementNote}>{visualAdapterSummary(visualAdapter.adapterId, "en")}</p>
          <p className={styles.movementNote}>
            Design Recipe → Visual Generation Character → Prompt. This layer only translates
            already-decided recipe values into generation language; it makes no new design decision.
          </p>
        </Collapsible>

        <Collapsible title="Culture" hint={`${dimensionEntries.length} dimensions blended`}>
          <div className={styles.defGrid}>
            {dimensionEntries.map(([dimension, owner]) => (
              <Def
                key={dimension}
                label={titleCase(dimension)}
                value={`${owner.country_name}${owner.contested ? " · contested" : ""}`}
              />
            ))}
          </div>
          <p className={styles.movementLabel}>{recipe.movement.name} — core principles</p>
          <ul className={styles.principleList}>
            {recipe.movement.core_principles.map((principle) => (
              <li key={principle}>{principle}</li>
            ))}
          </ul>
          <p className={styles.movementNote}>
            {recipe.culture.banned_tokens.length} cultural stereotype safeguards applied automatically.
          </p>
        </Collapsible>

        <Collapsible title="Platform Constraints" hint={formatChannel(recipe.platform.channel)}>
          <DefGrid>
            <Def label="Channel" value={formatChannel(recipe.platform.channel)} />
            <Def label="Aspect ratio" value={titleCase(recipe.platform.aspect_ratio_id)} />
            <Def label="Viewing context" value={titleCase(recipe.platform.viewing_context)} />
          </DefGrid>
          <div className={styles.statementList}>
            {recipe.constraints.map((constraint) => (
              <div className={styles.statement} key={constraint.id}>
                <span className={styles.statementKind}>{KIND_LABEL[constraint.kind] ?? constraint.kind}</span>
                <span>{constraint.statement}</span>
              </div>
            ))}
          </div>
        </Collapsible>
      </div>
    </section>
  );
}
