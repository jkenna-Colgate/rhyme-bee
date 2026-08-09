/**
 * Reading a fetch to `/api/editor/*` back into either a value or a message,
 * shared by all five hooks that talk to that API: `useDayReadout.ts`,
 * `useTierPicker.ts`, `useDemoter.ts`, `useAdder.ts` and `useEditorStatus.ts`.
 *
 * `errorIn` is identical wherever it is called: every route answers a refusal
 * with `sendJson`'s `{ error: string }` shape (`web/editorTransport.ts`), and
 * reading that shape back is the same question regardless of which route asked
 * it — a day, a Tier verdict, a demotion, an add or the status read.
 *
 * `readEndpointResponse` is the ok-check built on top of it: parse the body,
 * and on a non-2xx status turn it into the one sentence every hook then hands
 * to `setError` — `errorIn(body) ?? \`The ${name} endpoint answered
 * ${response.status}.\`` — which was five copies of the same three lines
 * before this, one per hook. It stops there rather than reaching further up
 * into the surrounding `try`: what comes before it (a staleness guard some
 * hooks apply and others do not, because only the ones fetching in an effect
 * that can be superseded need one) and what comes after it on success (which
 * setter a hook calls, and whether it also clears a previous error) are
 * different in every hook and would need a parameter each to unify — at which
 * point the function is not shorter than the five call sites it replaces, only
 * more indirect than they were.
 *
 * `endpointFailure` is for the case a route did not answer at all — the dev
 * server is down, or the fetch itself threw — and it is *not* the same
 * everywhere, so it is not folded into `readEndpointResponse` either: only the
 * day route and the status route read without writing, so they keep their own
 * inline message ("is the dev server still running?" with no claim about what
 * was or was not written) rather than call this. The Tier picker and the
 * demoter both write, and both differ from each other only in which endpoint
 * they name, so that name is the one parameter. `useAdder`'s Submit differs
 * from all four: a broken connection there may have written part of the
 * batch, so its catch says the one true thing instead — that resubmitting is
 * safe — rather than either of these two.
 */

/** The sentence the endpoint sent, when it sent one. */
export function errorIn(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { error } = body as { error?: unknown };
  return typeof error === "string" ? error : null;
}

/** What to show when a write route could not be reached at all. */
export function endpointFailure(cause: unknown, endpoint: string): string {
  return cause instanceof Error
    ? `${cause.message} — is the dev server still running? Nothing was written.`
    : `The ${endpoint} endpoint could not be reached. Nothing was written.`;
}

/**
 * A response's body, read as JSON and sorted into the two shapes every one of
 * the five hooks then does the same thing with: a value to use, or a sentence
 * to show. The body is parsed unconditionally, on a non-2xx response as much
 * as on a 2xx one, because the refusal shape carries the reason in the body —
 * `errorIn` cannot read a body it never gets handed.
 */
export async function readEndpointResponse<T>(
  response: Response,
  name: string,
): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  const body: unknown = await response.json();
  if (!response.ok) {
    return { ok: false, error: errorIn(body) ?? `The ${name} endpoint answered ${response.status}.` };
  }
  return { ok: true, body: body as T };
}
