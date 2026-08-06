/**
 * The paths the deployed Worker answers on, shared by the browser that calls
 * them and the Worker that routes them so the two cannot drift apart. In dev the
 * same paths are served by Vite plugins instead, which is why they are constants
 * in one place rather than a literal at each end.
 *
 * Everything not listed here falls through to the static assets — the game
 * itself is untouched by any of this.
 */

/**
 * Where a should-have-counted Appeal is sent: the Submission a player believes
 * should have counted as an Answer, reported after the browser has already
 * judged it (ADR-0013).
 */
export const APPEAL_PATH = "/api/supplement-candidate";

/**
 * Where a general note is sent: whatever a playtester wanted to say, filed as an
 * issue on the tracker. Like an Appeal it is a report and never a request for a
 * verdict (ADR-0013) — the game has already judged everything it is going to.
 */
export const FEEDBACK_PATH = "/api/feedback";
