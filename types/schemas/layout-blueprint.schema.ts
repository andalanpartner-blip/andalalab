import { z } from "zod";
import { DatasetVersion, Id, NonEmptyText, Note, Ratio, SemVer, Slug } from "../primitives";
import { CompositionStrategy } from "./direction.schema";
import { ZoneId } from "./reference/layout.schema";

/**
 * The Layout Blueprint — P2.10.
 *
 * A DERIVED, read-only, deterministic structural plan for a visual. It answers
 * "before generating the final image, this is how the AI intends to organise
 * the surface" — canvas, grid, zones, geometry, hierarchy, reading flow, focal
 * area and the structural relationships between zones.
 *
 * It is NOT a finished design and NOT a render. It carries no pixels and needs
 * no image analysis. It is a projection of the already-resolved
 * `DesignContract → DesignDirection → DesignRecipe` plus the resolved
 * `VisualType` and `LayoutSystem` — every number in it either is copied from
 * one of those artifacts (a STRUCTURAL fact) or is computed from them by
 * documented deterministic arithmetic (a DERIVED value). It makes no design
 * decision the recipe did not already make, calls no model, and never mutates
 * the recipe.
 *
 * Determinism: same recipe + same dataset version + same resolver version ⇒
 * byte-identical blueprint and `blueprint_hash`. See `docs/layout-blueprint.md`
 * and ADR 0004 (§ P2.10).
 */

// --- value semantics ------------------------------------------------------

/**
 * How a value in the blueprint is supported.
 *  - `structural`  — copied verbatim from the recipe / layout / visual type.
 *  - `derived`     — computed deterministically from structural values.
 *  - `unassessed`  — could not be resolved; listed in `blueprint.unassessed`.
 */
export const ValueBasis = z.enum(["structural", "derived", "unassessed"]);
export type ValueBasis = z.infer<typeof ValueBasis>;

// --- geometry -----------------------------------------------------------

/** A normalised rectangle in 0..1 canvas space. Origin top-left, y grows down. */
export const BlueprintRect = z
  .object({
    x: Ratio,
    y: Ratio,
    w: Ratio,
    h: Ratio
  })
  .strict()
  .superRefine((rect, ctx) => {
    if (rect.w <= 0 || rect.h <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "rect must have positive area" });
    }
    if (rect.x + rect.w > 1 + 1e-6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `rect overflows the right edge (x+w=${(rect.x + rect.w).toFixed(4)})`
      });
    }
    if (rect.y + rect.h > 1 + 1e-6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `rect overflows the bottom edge (y+h=${(rect.y + rect.h).toFixed(4)})`
      });
    }
  });
export type BlueprintRect = z.infer<typeof BlueprintRect>;

/** Integer grid-cell span. `col`/`row` are 0-indexed from the top-left. */
export const GridSpan = z
  .object({
    col: z.number().int().min(0).max(24),
    row: z.number().int().min(0).max(24),
    cols: z.number().int().min(1).max(24),
    rows: z.number().int().min(1).max(24)
  })
  .strict();
export type GridSpan = z.infer<typeof GridSpan>;

export const BlueprintCanvas = z
  .object({
    visual_type_id: Slug,
    channel: NonEmptyText,
    aspect_ratio_id: Slug,
    aspect_ratio_label: NonEmptyText,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    orientation: z.enum(["portrait", "landscape", "square"]),
    /** width / height, rounded to 4 dp — a derived convenience. */
    ratio: z.number().positive(),
    basis: ValueBasis
  })
  .strict();
export type BlueprintCanvas = z.infer<typeof BlueprintCanvas>;

export const BlueprintGrid = z
  .object({
    columns: z.number().int().min(1).max(24),
    rows: z.number().int().min(1).max(24),
    gutter_ratio: Ratio,
    margin_ratio: Ratio,
    modularity: Ratio,
    /** One column's width in normalised canvas units (gutters distributed). */
    column_width: Ratio,
    /** One row's height in normalised canvas units. */
    row_height: Ratio,
    basis: ValueBasis,
    source: NonEmptyText
  })
  .strict();
export type BlueprintGrid = z.infer<typeof BlueprintGrid>;

/** Normalised inset from each edge. Load-bearing zones must sit inside it. */
export const BlueprintSafeArea = z
  .object({
    top: Ratio,
    right: Ratio,
    bottom: Ratio,
    left: Ratio,
    basis: ValueBasis,
    source: NonEmptyText
  })
  .strict();
export type BlueprintSafeArea = z.infer<typeof BlueprintSafeArea>;

// --- zones ------------------------------------------------------------

/** The compositional weight of a zone, bucketed from priority + area share. */
export const ZoneRole = z.enum(["primary", "secondary", "supporting", "utility"]);
export type ZoneRole = z.infer<typeof ZoneRole>;

export const BlueprintZone = z
  .object({
    id: ZoneId,
    label: NonEmptyText,
    role: ZoneRole,
    /** Hierarchy priority carried from the recipe (1 = most important). */
    rank: z.number().int().min(1).max(11),
    /** 0-indexed position in the reading order. */
    reading_index: z.number().int().min(0),
    required: z.boolean(),
    /** True for zones that carry legible copy (headline, body, offer, cta, footer, navigation). */
    text_bearing: z.boolean(),
    /** STRUCTURAL — carried verbatim from `recipe.hierarchy.levels`. */
    area_share: Ratio,
    /** DERIVED — grid-snapped placement. */
    rect: BlueprintRect,
    /** DERIVED — the integer grid cells `rect` occupies. */
    grid_span: GridSpan,
    /** DERIVED — z-order; 0 = back. Higher zones render in front. */
    layer: z.number().int().min(0).max(8),
    /** DERIVED — display dominance 0..1 from area share weighted by focal rank. */
    dominance: Ratio,
    /** DERIVED — whether `rect` sits entirely inside the safe area. */
    within_safe_area: z.boolean(),
    basis: ValueBasis,
    source: NonEmptyText
  })
  .strict();
export type BlueprintZone = z.infer<typeof BlueprintZone>;

// --- reading flow ----------------------------------------------------

export const ReadingFlowPattern = z.enum([
  "z-pattern",
  "f-pattern",
  "centre-out",
  "top-down",
  "diagonal"
]);
export type ReadingFlowPattern = z.infer<typeof ReadingFlowPattern>;

export const BlueprintReadingFlow = z
  .object({
    /** STRUCTURAL — `recipe.composition.flow`. */
    pattern: ReadingFlowPattern,
    /** STRUCTURAL — `recipe.hierarchy.reading_order`, filtered to present zones. */
    path: z.array(ZoneId).min(1),
    entry: ZoneId,
    exit: ZoneId,
    /** DERIVED — the centre point of each path zone, in reading order. */
    waypoints: z
      .array(z.object({ zone: ZoneId, x: Ratio, y: Ratio }).strict())
      .min(1),
    basis: ValueBasis,
    source: NonEmptyText
  })
  .strict()
  .superRefine((flow, ctx) => {
    if (flow.path[0] !== flow.entry) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "entry must be the first zone in path" });
    }
    if (flow.path[flow.path.length - 1] !== flow.exit) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "exit must be the last zone in path" });
    }
    if (flow.waypoints.length !== flow.path.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "one waypoint per path zone is required"
      });
    }
  });
export type BlueprintReadingFlow = z.infer<typeof BlueprintReadingFlow>;

// --- focal region --------------------------------------------------

export const BlueprintFocal = z
  .object({
    /** The priority-1 zone. */
    zone: ZoneId,
    /** DERIVED — focal point in canvas space (centre of the focal zone). */
    x: Ratio,
    y: Ratio,
    /** STRUCTURAL — `recipe.hierarchy.focal_dominance`, verbatim. */
    dominance: Ratio,
    basis: ValueBasis,
    source: NonEmptyText
  })
  .strict();
export type BlueprintFocal = z.infer<typeof BlueprintFocal>;

// --- relationships -------------------------------------------------

/**
 * A structural relationship between two zones (or a zone and a frame element).
 * Every relationship is DERIVED from geometry and/or an already-resolved recipe
 * signal — never an independent design opinion.
 */
export const RelationshipKind = z.enum([
  "aligns_with",
  "adjacent_to",
  "contains",
  "contained_by",
  "overlaps",
  "dominates",
  "contrasts_with",
  "depends_on",
  "precedes"
]);
export type RelationshipKind = z.infer<typeof RelationshipKind>;

/** A relationship target: another zone, or a structural element of the frame. */
export const RelationshipTarget = z.union([
  ZoneId,
  z.enum(["canvas", "grid", "safe_area", "margin"])
]);
export type RelationshipTarget = z.infer<typeof RelationshipTarget>;

export const ZoneRelationship = z
  .object({
    kind: RelationshipKind,
    from: ZoneId,
    to: RelationshipTarget,
    /** What the relationship asserts, in plain language. */
    detail: Note,
    /** The concrete upstream signal that produced it — a path or dataset id. */
    signal: NonEmptyText
  })
  .strict();
export type ZoneRelationship = z.infer<typeof ZoneRelationship>;

// --- rationale ---------------------------------------------------

/** Which upstream artifact a rationale entry traces to. */
export const RationaleBasis = z.enum([
  "contract",
  "direction",
  "recipe",
  "layout",
  "visual_type",
  "dkv",
  "objective",
  "graphic_treatment",
  "geometry"
]);
export type RationaleBasis = z.infer<typeof RationaleBasis>;

/**
 * One deterministic explanation. Generated from resolved values, never from a
 * model. `claim` = what is happening; `reason` = why; `signal` = the concrete
 * upstream value that caused it.
 */
export const BlueprintRationale = z
  .object({
    claim: Note,
    reason: Note,
    signal: NonEmptyText,
    basis: z.array(RationaleBasis).min(1),
    /** One of the seven doctrine principles, verbatim, or null. */
    principle: NonEmptyText.nullable().default(null)
  })
  .strict();
export type BlueprintRationale = z.infer<typeof BlueprintRationale>;

// --- issues ----------------------------------------------------

/** A structural problem found while resolving. The resolver never silently repairs. */
export const BlueprintIssueCode = z.enum([
  "recipe_contract_mismatch",
  "recipe_direction_mismatch",
  "missing_visual_type",
  "missing_layout",
  "missing_aspect_ratio",
  "unknown_zone",
  "empty_zone_set",
  "area_share_exceeds_canvas",
  "zone_out_of_safe_area",
  "zone_overflow",
  "reading_order_mismatch",
  "focal_zone_missing",
  "blueprint_invalid"
]);
export type BlueprintIssueCode = z.infer<typeof BlueprintIssueCode>;

export const BlueprintIssueSeverity = z.enum(["P0", "P1", "P2"]);
export type BlueprintIssueSeverity = z.infer<typeof BlueprintIssueSeverity>;

export const BlueprintIssue = z
  .object({
    code: BlueprintIssueCode,
    severity: BlueprintIssueSeverity,
    path: NonEmptyText,
    message: Note,
    zone: ZoneId.nullable().default(null)
  })
  .strict();
export type BlueprintIssue = z.infer<typeof BlueprintIssue>;

// --- top level -------------------------------------------------

export const BlueprintMode = z.enum(["schematic"]);
export type BlueprintMode = z.infer<typeof BlueprintMode>;

export const LayoutBlueprint = z
  .object({
    schema_version: SemVer,
    /** The resolver logic version. Part of the hashed body. */
    resolver_version: SemVer,
    dataset_version: DatasetVersion,
    mode: BlueprintMode,

    /** Provenance — what this blueprint was derived from. Never re-derived. */
    provenance: z
      .object({
        recipe_id: Id,
        recipe_hash: z.string().length(8),
        contract_id: Id,
        direction_id: Id,
        concept_ref: Id.nullable(),
        layout_id: Slug,
        visual_type_id: Slug,
        objective: NonEmptyText
      })
      .strict(),

    canvas: BlueprintCanvas,
    grid: BlueprintGrid,
    safe_area: BlueprintSafeArea,

    layout_strategy: z
      .object({
        composition_strategy: CompositionStrategy,
        balance: z.enum(["symmetric", "asymmetric", "mixed"]),
        arrangement: z.enum(["stacked", "split-column"]),
        spatial_behavior: Note,
        basis: ValueBasis,
        source: NonEmptyText
      })
      .strict(),

    zones: z.array(BlueprintZone),
    reading_flow: BlueprintReadingFlow,
    focal: BlueprintFocal,
    relationships: z.array(ZoneRelationship),

    hierarchy: z
      .object({
        strength: Ratio,
        focal_dominance: Ratio,
        reading_order: z.array(ZoneId).min(1),
        basis: ValueBasis,
        source: NonEmptyText
      })
      .strict(),

    density: z
      .object({
        visual_density: Ratio,
        whitespace: Ratio,
        basis: ValueBasis,
        source: NonEmptyText
      })
      .strict(),

    constraints: z.array(
      z
        .object({
          kind: z.enum(["safe_area", "focal", "text_zone", "aspect_ratio", "grid"]),
          statement: Note,
          source: NonEmptyText
        })
        .strict()
    ),

    anchors: z.array(
      z
        .object({
          kind: z.enum(["primary_visual_direction", "concept", "grid", "focal_zone"]),
          value: NonEmptyText,
          source: NonEmptyText
        })
        .strict()
    ),

    rationale: z.array(BlueprintRationale),
    issues: z.array(BlueprintIssue),

    /** Field paths that could not be resolved. Normally empty. */
    unassessed: z.array(NonEmptyText),

    blueprint_hash: z.string().length(8)
  })
  .strict();
export type LayoutBlueprint = z.infer<typeof LayoutBlueprint>;
