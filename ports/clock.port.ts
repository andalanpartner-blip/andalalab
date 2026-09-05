/**
 * Time, injected.
 *
 * The engine must be deterministic: the same inputs must produce the same
 * contract, including its hash. Reading the clock directly inside a pure
 * function would break that, so time enters as a dependency.
 */
export type ClockPort = {
  now(): Date;
};

export const fixedClock = (iso: string): ClockPort => ({
  now: () => new Date(iso)
});

export const systemClock: ClockPort = {
  now: () => new Date()
};
