/**
 * Presentation-only formatting helpers for the UI.
 *
 * Nothing here makes a design decision or computes a new value — every
 * function is a pure text/number transform over a value the engine already
 * produced, so a slug or enum reads like language instead of an internal id.
 */

/** "instagram-feed" -> "Instagram feed", "brand-building" -> "Brand building" */
export function humanize(value: string): string {
  const spaced = value.replace(/[-_]+/g, " ").trim();
  if (spaced.length === 0) return spaced;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "instagram-feed" -> "Instagram Feed" (every word capitalised, for labels) */
export function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

const RATIO_LABELS: readonly [number, string][] = [
  [0.2, "Minimal"],
  [0.4, "Restrained"],
  [0.6, "Balanced"],
  [0.8, "Pronounced"],
  [Number.POSITIVE_INFINITY, "Bold"]
];

/** A short qualitative reading of a 0..1 design parameter, for non-technical display. */
export function ratioLabel(ratio: number): string {
  const found = RATIO_LABELS.find(([ceiling]) => ratio <= ceiling);
  return found ? found[1] : "Bold";
}

export function formatAgeRange(range: readonly [number, number]): string {
  return `${range[0]}–${range[1]} years`;
}

const CHANNEL_LABELS: Record<string, string> = {
  "instagram-feed": "Instagram Feed",
  "instagram-story": "Instagram Story / Reels",
  tiktok: "TikTok",
  "facebook-feed": "Facebook Feed",
  "linkedin-feed": "LinkedIn Feed",
  web: "Web",
  print: "Print",
  ooh: "Out-of-home"
};

export function formatChannel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? titleCase(channel);
}
