/**
 * The paths the game's endpoints answer on, shared by the caller and the thing
 * that routes them so the two cannot drift apart — which is why they are
 * constants in one place rather than a literal at each end.
 *
 * The first two are the deployed Worker's, served by Vite plugins in dev and by
 * `worker/index.ts` in production. The last is a *dev-only* path with no
 * deployed half at all: no Worker route answers it, and the plugin that does is
 * `apply: "serve"`. It is declared beside them because the reason to keep paths
 * in one file is to be able to read the whole set, and a path that only ever
 * exists in dev is exactly the one worth being able to see.
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

/**
 * Where the Editor's Pass reads one scheduled day from: `GET`, with the day
 * named as `?date=YYYY-MM-DD` and tomorrow when it is not. Dev only, and
 * structurally so — `editorDayPlugin` is `apply: "serve"`, so `configureServer`
 * never runs in a production build and no deployed surface answers this path
 * (ADR-0016).
 *
 * The editor's shell calls it instead of loading the Rhyme Index: a day's
 * readout is a few KB against the artifact's fifteen megabytes, and every figure
 * on it is then the one Node computed rather than a second opinion.
 */
export const EDITOR_DAY_PATH = "/api/editor/day";
