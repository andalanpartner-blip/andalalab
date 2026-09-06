"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { DesignRecipe } from "../types/schemas/recipe.schema";
import type { SelectedGraphicDevice } from "../types/schemas/graphic-treatment.schema";
import { resolveVisualAdapter, VISUAL_ADAPTER_LABEL, visualAdapterSummary } from "../engine";
import styles from "./DecisionLedger.module.css";
import { Disclosure, DisclosureGroup } from "./ui/Disclosure";
import { Meter } from "./ui/Meter";
import { Definition as Def, DefinitionGrid as DefGrid } from "./ui/Definition";
import { Input } from "./ui/Field";
import { formatChannel, humanize, percent, titleCase } from "../lib/format";

type LedgerCategory = "structural" | "photographic" | "cultural" | "platform";
type LedgerFilter = "all" | LedgerCategory;

const FILTERS: readonly { id: LedgerFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "structural", label: "Structural" },
  { id: "photographic", label: "Photographic" },
  { id: "cultural", label: "Cultural" },
  { id: "platform", label: "Platform" }
];

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

type LedgerSection = {
  readonly id: string;
  readonly title: string;
  readonly category: LedgerCategory;
  readonly hint: string;
  readonly source: string;
  readonly search: string;
  readonly defaultOpen?: boolean;
  readonly body: ReactNode;
};

function buildSections(recipe: DesignRecipe): LedgerSection[] {
  const pc = recipe.photographic_character;
  const dimensionEntries = Object.entries(recipe.culture.dimensions);
  const adapter = resolveVisualAdapter({
    photographicStyle: pc.photographic_style,
    realismTarget: pc.realism_target
  });
  const adapterLabel = VISUAL_ADAPTER_LABEL[adapter.adapterId].en;

  return [
    {
      id: "composition",
      title: "Composition",
      category: "structural",
      hint: humanize(recipe.composition.strategy),
      source: recipe.composition.source,
      defaultOpen: true,
      search: `${recipe.composition.strategy} ${recipe.composition.balance} ${recipe.composition.flow} ${recipe.composition.spatial_behavior}`,
      body: (
        <>
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
        </>
      )
    },
    {
      id: "grid",
      title: "Grid",
      category: "structural",
      hint: `${recipe.grid.columns} × ${recipe.grid.rows}`,
      source: recipe.grid.source,
      search: `grid columns rows gutter margin modularity`,
      body: (
        <>
          <DefGrid>
            <Def label="Columns" value={recipe.grid.columns} />
            <Def label="Rows" value={recipe.grid.rows} />
            <Def label="Gutter" value={percent(recipe.grid.gutter_ratio)} />
            <Def label="Margin" value={percent(recipe.grid.margin_ratio)} />
          </DefGrid>
          <div className={styles.meterStack}>
            <Meter label="Modularity" ratio={recipe.grid.modularity} />
          </div>
        </>
      )
    },
    {
      id: "hierarchy",
      title: "Hierarchy",
      category: "structural",
      hint: `${recipe.hierarchy.levels.length} zones`,
      source: "resolved DKV + layout",
      search: `hierarchy reading order ${recipe.hierarchy.reading_order.join(" ")}`,
      body: (
        <>
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
        </>
      )
    },
    {
      id: "typography",
      title: "Typography",
      category: "structural",
      hint: humanize(recipe.typography.strategy),
      source: recipe.typography.source,
      defaultOpen: true,
      search: `typography ${recipe.typography.strategy} ${recipe.typography.primary} ${recipe.typography.case_bias} ${recipe.typography.weight_bias}`,
      body: (
        <DefGrid>
          <Def label="Strategy" value={humanize(recipe.typography.strategy)} />
          <Def label="Case" value={titleCase(recipe.typography.case_bias)} />
          <Def label="Weight" value={titleCase(recipe.typography.weight_bias)} />
          <Def label="Scale ratio" value={recipe.typography.scale_ratio.toFixed(2)} />
          <Def label="Primary" value={recipe.typography.primary} />
          {recipe.typography.secondary ? <Def label="Secondary" value={recipe.typography.secondary} /> : null}
          <Def label="Brand locked" value={recipe.typography.brand_locked ? "Yes" : "No"} />
        </DefGrid>
      )
    },
    {
      id: "color",
      title: "Color",
      category: "structural",
      hint: humanize(recipe.color.strategy),
      source: recipe.color.source,
      defaultOpen: true,
      search: `color palette saturation contrast complexity ${recipe.color.strategy} ${recipe.color.relationships.join(" ")}`,
      body: (
        <>
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
                  <span className={styles.swatchChip} style={{ background: entry.hex }} aria-hidden="true" />
                  {entry.name}
                </span>
              ))}
            </div>
          ) : null}
        </>
      )
    },
    {
      id: "graphic-language",
      title: "Graphic Language",
      category: "structural",
      hint: `ornament ${percent(recipe.graphic_language.ornament)}`,
      source: recipe.graphic_language.source,
      search: `graphic language shape logic rhythm ornament ${recipe.graphic_language.shape_logic}`,
      body: (
        <>
          <DefGrid>
            <Def label="Shape logic" value={recipe.graphic_language.shape_logic} />
            <Def label="Rhythm" value={recipe.graphic_language.rhythm} />
          </DefGrid>
          <div className={styles.meterStack}>
            <Meter label="Ornament" ratio={recipe.graphic_language.ornament} />
          </div>
        </>
      )
    },
    {
      id: "graphic-treatment",
      title: "Graphic Treatment",
      category: "structural",
      hint: titleCase(recipe.graphic_treatment.intensity),
      source: "movement + industry + objective",
      search: `graphic treatment devices ${recipe.graphic_treatment.intensity}`,
      body:
        recipe.graphic_treatment.intensity === "none" ? (
          <p className={styles.note}>No graphic devices selected — restraint is the correct treatment here.</p>
        ) : (
          <>
            {GRAPHIC_TREATMENT_GROUPS.filter((group) => recipe.graphic_treatment[group.key].length > 0).map(
              (group) => (
                <div key={group.key}>
                  <p className={styles.label}>{group.label}</p>
                  <GraphicTreatmentSection devices={recipe.graphic_treatment[group.key]} />
                </div>
              )
            )}
          </>
        )
    },
    {
      id: "imagery",
      title: "Imagery",
      category: "photographic",
      hint: `${percent(recipe.imagery.realism)} realism`,
      source: recipe.imagery.source,
      search: `imagery subject framing realism ${recipe.imagery.subject_treatment}`,
      body: (
        <>
          <DefGrid>
            <Def label="Subject treatment" value={recipe.imagery.subject_treatment} />
            <Def label="Framing" value={recipe.imagery.framing} />
          </DefGrid>
          <div className={styles.meterStack}>
            <Meter label="Realism" ratio={recipe.imagery.realism} />
          </div>
        </>
      )
    },
    {
      id: "lighting",
      title: "Lighting",
      category: "photographic",
      hint: `contrast ${percent(recipe.lighting.contrast)}`,
      source: recipe.lighting.source,
      search: `lighting direction contrast ${recipe.lighting.direction}`,
      body: (
        <>
          <DefGrid>
            <Def label="Direction" value={recipe.lighting.direction} />
          </DefGrid>
          <div className={styles.meterStack}>
            <Meter label="Contrast" ratio={recipe.lighting.contrast} />
          </div>
        </>
      )
    },
    {
      id: "materiality",
      title: "Materiality",
      category: "photographic",
      hint: `texture ${percent(recipe.materiality.texture)}`,
      source: recipe.materiality.source,
      search: `materiality surfaces texture ${recipe.materiality.surfaces.join(" ")}`,
      body: (
        <>
          <PillList items={recipe.materiality.surfaces} />
          <div className={styles.meterStack}>
            <Meter label="Texture" ratio={recipe.materiality.texture} />
          </div>
        </>
      )
    },
    {
      id: "photographic-character",
      title: "Photographic Character",
      category: "photographic",
      hint: titleCase(pc.photographic_style),
      source: "resolved imagery + lighting + colour + materiality",
      search: `photographic character style realism camera lens depth of field finish artificiality ${pc.photographic_style} ${pc.realism_target}`,
      body: (
        <>
          <DefGrid>
            <Def label="Photographic style" value={titleCase(pc.photographic_style)} />
            <Def label="Realism target" value={titleCase(pc.realism_target)} />
            <Def label="Camera" value={titleCase(pc.camera_language)} />
            <Def label="Lens" value={humanize(pc.lens_character)} />
            <Def label="Depth of field" value={titleCase(pc.depth_of_field)} />
            <Def label="Lighting" value={titleCase(pc.lighting_behavior)} />
            <Def label="Color response" value={titleCase(pc.color_response)} />
            <Def
              label="Skin / face realism"
              value={`${titleCase(pc.skin_realism)} / ${titleCase(pc.face_realism)}`}
            />
            <Def label="Material realism" value={titleCase(pc.material_realism)} />
            <Def label="Imperfection level" value={titleCase(pc.imperfection_level)} />
          </DefGrid>
          <div className={styles.meterStack}>
            <Meter
              label={`Artificiality risk · ${titleCase(pc.artificiality_risk.band)}`}
              ratio={pc.artificiality_risk.score / 100}
            />
          </div>
          <p className={styles.label}>Finish</p>
          <DefGrid>
            <Def label="Style" value={titleCase(pc.finish.style.value)} />
            <Def label="Color" value={titleCase(pc.finish.color_character.value)} />
            <Def
              label="Lighting"
              value={pc.finish.lighting_character ? titleCase(pc.finish.lighting_character.value) : "—"}
            />
            <Def
              label="Artificiality"
              value={`${titleCase(pc.finish.artificiality.value)} · ${pc.finish.artificiality.score}/100`}
            />
          </DefGrid>
          {pc.finish.realism_notes.length > 0 ? (
            <>
              <p className={styles.label}>Realism Notes</p>
              <PillList
                items={pc.finish.realism_notes.map((key) => REALISM_NOTE_LABEL[key] ?? humanize(key))}
              />
            </>
          ) : (
            <p className={styles.note}>
              Non-photographic medium — colour character only, no photographic lighting or realism
              controls.
            </p>
          )}
        </>
      )
    },
    {
      id: "visual-generation",
      title: "Visual Generation",
      category: "photographic",
      hint: adapterLabel,
      source: "photographic style + realism target",
      search: `visual generation adapter ${adapterLabel} ${adapter.rationale}`,
      body: (
        <>
          <DefGrid>
            <Def label="Adapter" value={adapterLabel} />
            <Def label="Realism target" value={titleCase(pc.realism_target)} />
          </DefGrid>
          <p className={styles.label}>Why this adapter</p>
          <p className={styles.note}>{adapter.rationale}</p>
          <p className={styles.label}>How it renders</p>
          <p className={styles.note}>{visualAdapterSummary(adapter.adapterId, "en")}</p>
        </>
      )
    },
    {
      id: "culture",
      title: "Culture",
      category: "cultural",
      hint: `${dimensionEntries.length} dimensions · ${recipe.movement.name}`,
      source: "country blend + movement",
      search: `culture ${recipe.movement.name} ${recipe.movement.core_principles.join(" ")} stereotype safeguards`,
      body: (
        <>
          <DefGrid>
            {dimensionEntries.map(([dimension, owner]) => (
              <Def
                key={dimension}
                label={titleCase(dimension)}
                value={`${owner.country_name}${owner.contested ? " · contested" : ""}`}
              />
            ))}
          </DefGrid>
          <p className={styles.label}>{recipe.movement.name} — core principles</p>
          <ul className={styles.principleList}>
            {recipe.movement.core_principles.map((principle) => (
              <li key={principle}>{principle}</li>
            ))}
          </ul>
          <p className={styles.note}>
            {recipe.culture.banned_tokens.length} cultural stereotype safeguards applied automatically.
          </p>
        </>
      )
    },
    {
      id: "platform",
      title: "Platform Constraints",
      category: "platform",
      hint: formatChannel(recipe.platform.channel),
      source: "brief platform + visual type",
      search: `platform ${recipe.platform.channel} ${recipe.platform.aspect_ratio_id} ${recipe.constraints
        .map((c) => c.statement)
        .join(" ")}`,
      body: (
        <>
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
        </>
      )
    }
  ];
}

export function DecisionLedger({ recipe }: { recipe: DesignRecipe }) {
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [query, setQuery] = useState("");
  const sections = useMemo(() => buildSections(recipe), [recipe]);

  const q = query.trim().toLowerCase();
  const visible = sections.filter((section) => {
    if (filter !== "all" && section.category !== filter) return false;
    if (q.length === 0) return true;
    return (section.title + " " + section.search).toLowerCase().includes(q);
  });

  return (
    <div className={styles.ledger}>
      <p className={styles.lede}>
        Every value the AI set, with the country, movement or industry that produced it. Read-only.
      </p>

      <div className={styles.controls}>
        <div className={styles.filters} role="group" aria-label="Filter decisions">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={styles.filter}
              data-active={filter === f.id || undefined}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Input
          type="search"
          className={styles.search}
          placeholder="Search decisions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search decisions"
        />
      </div>

      {visible.length === 0 ? (
        <p className={styles.empty}>No decisions match “{query}”.</p>
      ) : (
        <DisclosureGroup>
          {visible.map((section) => (
            <Disclosure
              key={section.id}
              title={section.title}
              hint={section.hint}
              defaultOpen={q.length > 0 || section.defaultOpen}
            >
              {section.body}
              <p className={styles.source}>
                <span className={styles.sourceLabel}>Source</span> {section.source}
              </p>
            </Disclosure>
          ))}
        </DisclosureGroup>
      )}
    </div>
  );
}
