/**
 * What every "turn an untrusted request body into a domain record" validator
 * shares, regardless of what the record is. An Appeal becomes a
 * `SupplementCandidate` (`supplementCandidate.ts`); a feedback body becomes a
 * `FeedbackNote` (`web/src/feedback/feedbackIssue.ts`). Both read a body
 * nobody can be trusted to have sent honestly, so both need the same two
 * things: a result that cannot come out half-built, and a way to refuse a
 * field neither validator was told to expect.
 *
 * What a report may contain, and how each of its fields is checked, stays
 * with the caller — that is the part that differs and the part that is
 * actually interesting. This module is only the shape they were repeating.
 */

/**
 * A refusal: an untrusted report that did not pass validation, with the
 * reason a caller can show the sender.
 */
export interface Refused {
  ok: false;
  error: string;
}

/** Build a refusal. Assignable to any `Validated<Key, T>` — it never needs `T`. */
export function refuse(error: string): Refused {
  return { ok: false, error };
}

/**
 * The outcome of validating an untrusted report: either the domain value,
 * under `Key`, or a `Refused`. There is deliberately no third state — a
 * caller cannot get a half-built value out of this, so a refusal can never be
 * half-written.
 *
 * `Key` is the field name each caller already uses for its own success value
 * (`candidate`, `note`, …), kept literal so `Validated<"candidate", SupplementCandidate>`
 * reads at the call site exactly as the hand-written union it replaces did.
 */
export type Validated<Key extends string, T> = ({ ok: true } & Record<Key, T>) | Refused;

/**
 * `true` if `report` carries only fields named in `allowed`. A field nobody
 * recognises means the sender is not the game, so every caller here refuses
 * the whole report on the first field it doesn't know, rather than quietly
 * trimming it to the parts it liked.
 */
export function hasOnlyFields(
  report: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  for (const field of Object.keys(report)) {
    if (!allowed.has(field)) return false;
  }
  return true;
}
