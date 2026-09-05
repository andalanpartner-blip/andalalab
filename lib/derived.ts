/** Pulls the leading field key out of a `derived` note like `audience.age_range = [...] (...)`. */
export function derivedFieldKeys(derived: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const line of derived) {
    const key = line.split(" = ")[0]?.trim();
    if (key) keys.add(key);
  }
  return keys;
}

export const HIGH_CONFIDENCE = 0.8;
