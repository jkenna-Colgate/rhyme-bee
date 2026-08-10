/**
 * Which day a request to the editor's day endpoint asks for, and how much of a
 * request the endpoint will read. The whole of the decision, with none of the
 * transport — so the two things most worth getting right about the endpoint can
 * be tested without standing a dev server up, which is how the deployed Worker
 * routes are split from `src/supplementCandidate.ts` and why they are testable
 * at all.
 *
 * A date is either named or it is not. Not named means **tomorrow**, because
 * tomorrow is the day an Editor's Pass is nearly always about: it is the next
 * day to go live, and the last moment at which a correction is cheap. Resolving
 * that here rather than in the browser keeps the browser free of a figure the
 * screen would then be showing on its own authority — the readout that comes
 * back names its own date, and that is what the screen displays.
 */

/** ISO `YYYY-MM-DD`, the spelling the schedule artifact uses. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What the endpoint will read of a request body before refusing it.
 *
 * A read names its day in the query string and carries no body at all, so this
 * is not a size the endpoint expects to use — it is the answer to what happens
 * to a body that arrives anyway. Something must decide, because connect hands a
 * middleware a live stream and the alternative to a cap is buffering whatever a
 * caller chose to send. Small enough that the answer is "nothing an editor ever
 * sends is refused, and nothing else is buffered"; the later slices of the pass
 * (#159–#162) post real bodies and will bring their own caps, sized to what they
 * carry.
 */
export const MAX_REQUEST_BODY_BYTES = 512;

export type EditorDayRequest = { ok: true; date: string } | { ok: false; error: string };

/**
 * The day a request asks for. `url` is taken as connect gives it — mounting the
 * middleware on a path strips that path first, so what arrives is usually `/`
 * with the query still attached, and a base is supplied to parse either form.
 *
 * `today` is passed rather than read, so the default is a decision this module
 * makes about a date rather than a fact it discovers about the clock.
 */
export function editorDayRequest(url: string, today: string): EditorDayRequest {
  const named = new URL(url, "http://localhost").searchParams.get("date");
  // An empty `date` is a cleared field, not a malformed one: the date control
  // sends `date=` when the editor deletes what they typed, and the useful answer
  // to that is the day the screen opened on.
  if (named === null || named === "") return { ok: true, date: dayAfter(today) };
  if (!ISO_DATE.test(named)) {
    return { ok: false, error: `"${named}" is not a date. Dates are written YYYY-MM-DD.` };
  }
  return { ok: true, date: named };
}

/**
 * The day after an ISO date. Built through `Date` rather than by adding one to
 * the day field, so month and year ends and leap days come out of the calendar
 * instead of out of arithmetic here; local-time components throughout, never
 * UTC, because the day the editor means is the day on their own calendar
 * (ADR-0013) and a UTC round trip moves it for half the world.
 *
 * `scripts/editorArgs.ts` has the same five lines, and this is deliberately not
 * an import of them: ADR-0016 retires that module with the CLI, and a web mode
 * that imports from it would be the reason the retirement could not happen.
 */
function dayAfter(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day + 1);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
