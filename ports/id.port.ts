/** Identifier generation, injected for the same reason as the clock. */
export type IdPort = {
  next(prefix: string): string;
};

/** Deterministic sequential ids. Used in tests and golden fixtures. */
export const sequentialIds = (): IdPort => {
  let counter = 0;
  return {
    next: (prefix: string) => {
      counter += 1;
      return `${prefix}_${String(counter).padStart(6, "0")}`;
    }
  };
};

export const randomIds: IdPort = {
  next: (prefix: string) => `${prefix}_${crypto.randomUUID()}`
};
