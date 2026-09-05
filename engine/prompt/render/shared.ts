export function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function ensureSentence(statement: string): string {
  const trimmed = statement.trim();
  if (trimmed.length === 0) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function joinAnd(items: readonly string[], connector: string): string {
  const list = items.filter((item) => item.trim().length > 0);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0]!;
  if (list.length === 2) return `${list[0]} ${connector} ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, ${connector} ${list[list.length - 1]}`;
}
