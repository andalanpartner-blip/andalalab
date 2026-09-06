import { Fragment } from "react";
import type { LayoutBlueprint } from "../../types/schemas/layout-blueprint.schema";
import { canvasAnnotations } from "../../lib/blueprint-view";
import styles from "./BlueprintCanvas.module.css";

/**
 * The Layout Blueprint schematic — presentation only.
 *
 * It renders the already-resolved blueprint as an SVG diagram: canvas frame,
 * grid, margin, safe area, zones (weighted by role, bordered by required /
 * optional), the focal point, the reading-flow path and a few relationship
 * annotations. It computes NO geometry — every coordinate comes straight from
 * `blueprint.*.rect` / `.waypoints` / `.focal`, drawn into a viewBox sized to
 * the blueprint's own aspect ratio. It is a schematic, not the finished poster.
 */

const W = 1000;

const ROLE_FILL: Record<string, string> = {
  primary: "var(--bp-fill-primary)",
  secondary: "var(--bp-fill-secondary)",
  supporting: "var(--bp-fill-supporting)",
  utility: "var(--bp-fill-utility)"
};

export type BlueprintCanvasProps = {
  readonly blueprint: LayoutBlueprint;
  /** Highlight one zone (hover/focus coming from the zone list). */
  readonly highlightZone?: string | null;
};

export function BlueprintCanvas({ blueprint, highlightZone = null }: BlueprintCanvasProps) {
  const { canvas, grid, safe_area: safe, zones, reading_flow: flow, focal } = blueprint;
  const H = Math.round((W * canvas.height) / canvas.width);

  const px = (n: number) => n * W;
  const py = (n: number) => n * H;

  const margin = grid.margin_ratio;
  const gridLeft = px(margin);
  const gridRight = px(1 - margin);
  const gridTop = py(margin);
  const gridBottom = py(1 - margin);

  const verticals = Array.from({ length: grid.columns + 1 }, (_, i) =>
    gridLeft + ((gridRight - gridLeft) * i) / grid.columns
  );
  const horizontals = Array.from({ length: grid.rows + 1 }, (_, i) =>
    gridTop + ((gridBottom - gridTop) * i) / grid.rows
  );

  const flowPoints = flow.waypoints.map((w) => `${px(w.x).toFixed(1)},${py(w.y).toFixed(1)}`).join(" ");
  const annotations = canvasAnnotations(blueprint, 4);
  const annBySource = new Map<string, string[]>();
  for (const a of annotations) {
    annBySource.set(a.from, [...(annBySource.get(a.from) ?? []), a.label]);
  }

  const summary = `Layout blueprint schematic: ${canvas.aspect_ratio_label}, ${grid.columns} by ${grid.rows} grid, ${zones.length} zones, reading ${flow.pattern} from ${flow.entry} to ${flow.exit}, focal point on ${focal.zone}.`;

  return (
    <svg
      className={styles.canvas}
      viewBox={`0 0 ${W} ${H}`}
      style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
      role="img"
      aria-label={summary}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* canvas frame */}
      <rect className={styles.frame} x={1} y={1} width={W - 2} height={H - 2} />

      {/* grid */}
      <g className={styles.grid} aria-hidden="true">
        {verticals.map((x, i) => (
          <line key={`v${i}`} x1={x} y1={gridTop} x2={x} y2={gridBottom} />
        ))}
        {horizontals.map((y, i) => (
          <line key={`h${i}`} x1={gridLeft} y1={y} x2={gridRight} y2={y} />
        ))}
      </g>

      {/* margin boundary */}
      <rect
        className={styles.margin}
        x={gridLeft}
        y={gridTop}
        width={gridRight - gridLeft}
        height={gridBottom - gridTop}
        aria-hidden="true"
      />

      {/* safe area */}
      <rect
        className={styles.safe}
        x={px(safe.left)}
        y={py(safe.top)}
        width={px(1 - safe.left - safe.right)}
        height={py(1 - safe.top - safe.bottom)}
        aria-hidden="true"
      />
      <text className={styles.edgeLabel} x={px(safe.left) + 8} y={py(safe.top) - 9} aria-hidden="true">
        safe area
      </text>

      {/* zones */}
      <g className={styles.zones}>
        {[...zones]
          .sort((a, b) => a.layer - b.layer || b.area_share - a.area_share)
          .map((zone) => {
            const x = px(zone.rect.x);
            const y = py(zone.rect.y);
            const w = px(zone.rect.w);
            const h = py(zone.rect.h);
            const isFocal = zone.id === focal.zone;
            const isHi = highlightZone === zone.id;
            const small = h < 74 || w < 150;
            const labels = annBySource.get(zone.id) ?? [];
            return (
              <g
                key={zone.id}
                className={styles.zone}
                data-role={zone.role}
                data-focal={isFocal || undefined}
                data-highlight={isHi || undefined}
              >
                <title>{`${zone.label} — rank ${zone.rank}, ${zone.role}, ${Math.round(
                  zone.area_share * 100
                )}% area, ${zone.required ? "required" : "optional"}`}</title>
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  className={styles.zoneRect}
                  style={{ fill: ROLE_FILL[zone.role] ?? ROLE_FILL.supporting }}
                  strokeDasharray={zone.required ? undefined : "6 5"}
                />
                {!small && (
                  <>
                    <text className={styles.zoneLabel} x={x + 14} y={y + 30}>
                      {zone.label}
                    </text>
                    <text className={styles.zoneMeta} x={x + 14} y={y + 50}>
                      {`#${zone.rank} · ${zone.role} · ${Math.round(zone.area_share * 100)}% · ${
                        zone.required ? "required" : "optional"
                      }`}
                    </text>
                  </>
                )}
                {small && (
                  <text className={styles.zoneLabelSmall} x={x + w / 2} y={y + h / 2}>
                    {zone.label}
                  </text>
                )}
                {labels.length > 0 && !small && (
                  <text className={styles.annotation} x={x + 12} y={y + h - 12}>
                    {labels.join(" · ")}
                  </text>
                )}
              </g>
            );
          })}
      </g>

      {/* reading flow */}
      <g className={styles.flow} aria-hidden="true">
        <polyline points={flowPoints} className={styles.flowLine} markerEnd="url(#bp-arrow)" />
        <defs>
          <marker id="bp-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className={styles.arrowHead} />
          </marker>
        </defs>
        {flow.waypoints.map((w, i) => (
          <Fragment key={w.zone}>
            <circle cx={px(w.x)} cy={py(w.y)} r={13} className={styles.flowDot} />
            <text x={px(w.x)} y={py(w.y) + 4} className={styles.flowNum}>
              {i + 1}
            </text>
          </Fragment>
        ))}
      </g>

      {/* focal point */}
      <g className={styles.focal} aria-hidden="true">
        <circle cx={px(focal.x)} cy={py(focal.y)} r={20} className={styles.focalRing} />
        <circle cx={px(focal.x)} cy={py(focal.y)} r={5} className={styles.focalDot} />
        <line x1={px(focal.x) - 30} y1={py(focal.y)} x2={px(focal.x) + 30} y2={py(focal.y)} className={styles.focalCross} />
        <line x1={px(focal.x)} y1={py(focal.y) - 30} x2={px(focal.x)} y2={py(focal.y) + 30} className={styles.focalCross} />
      </g>
    </svg>
  );
}
