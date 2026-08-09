/**
 * Reading the client-visible half of a failed fetch to `/api/editor/*`, shared
 * by the three hooks that call it: `useDayReadout.ts`, `useTierPicker.ts` and
 * `useDemoter.ts`.
 *
 * `errorIn` is identical wherever it is called: every route answers a refusal
 * with `sendJson`'s `{ error: string }` shape (`web/editorTransport.ts`), and
 * reading that shape back is the same question regardless of which route asked
 * it — a day, a Tier verdict or a demotion.
 *
 * `endpointFailure` is for the case a route did not answer at all — the dev
 * server is down, or the fetch itself threw — and it is *not* the same
 * everywhere: only the day route reads without writing, so it is the one hook
 * that keeps its own inline message rather than call this. The Tier picker and
 * the demoter both write, and both differ from each other only in which
 * endpoint they name, so that name is the one parameter.
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
