/**
 * A tiny Result type.
 *
 * Engine functions collect every problem and return them together rather than
 * throwing on the first one. A brief with four wrong references should produce
 * four messages, not four round trips.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok;

export function unwrap<T, E>(result: Result<T, E>, context: string): T {
  if (result.ok) return result.value;
  throw new Error(`${context}: ${JSON.stringify(result.error, null, 2)}`);
}
