import type { CSSProperties } from "react";
import type { SchematicNode, SchematicBlock } from "../../engine/layout/templates";
import styles from "./LayoutSchematic.module.css";

/**
 * A deterministic structural schematic — blocks only. No imagery, no colour
 * beyond a faint tonal step per block role, no generated content. It renders
 * the same tree the engine holds, so two calls with the same template are
 * byte-identical.
 */

const BLOCK_LABEL: Record<SchematicBlock, string> = {
  image: "Image",
  headline: "Headline",
  body: "Body",
  cta: "CTA",
  brand: "Brand",
  offer: "Offer",
  product: "Product",
  scene: "Scene"
};

function Node({ node, depth }: { node: SchematicNode; depth: number }) {
  if ("block" in node) {
    return (
      <div
        className={styles.block}
        data-block={node.block}
        style={{ flexGrow: node.grow } as CSSProperties}
      >
        <span className={styles.label}>{node.label ?? BLOCK_LABEL[node.block]}</span>
      </div>
    );
  }
  return (
    <div
      className={node.dir === "row" ? styles.row : styles.col}
      style={{ flexGrow: node.grow } as CSSProperties}
    >
      {node.children.map((child, i) => (
        <Node key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function LayoutSchematic({
  schematic,
  size = "card",
  title
}: {
  readonly schematic: SchematicNode;
  readonly size?: "card" | "detail";
  readonly title?: string;
}) {
  return (
    <div
      className={styles.frame}
      data-size={size}
      role="img"
      aria-label={title ? `Structural schematic — ${title}` : "Structural layout schematic"}
    >
      <Node node={schematic} depth={0} />
    </div>
  );
}
