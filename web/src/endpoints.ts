/**
 * The paths the game's endpoints answer on, shared by the caller and the thing
 * that routes them so the two cannot drift apart — which is why they are
 * constants in one place rather than a literal at each end.
 *
 * The first two are the deployed Worker's, served by Vite plugins in dev and by
 * `worker/index.ts` in production. The rest are *dev-only* paths with no
 * deployed half at all: no Worker route answers them, and the plugins that do
 * are `apply: "serve"`. They are declared beside the first two because the
 * reason to keep paths in one file is to be able to read the whole set, and a
 * path that only ever exists in dev is exactly the one worth being able to see.
 *
 * Everything not listed here falls through to the static assets — the game
 * itself is untouched by any of this.
 */

/**
 * Where a should-have-counted Appeal is sent: the Submission a player believes
 * should have counted as an Answer, reported after the browser has already
 * judged it (ADR-0013).
 *
 * The Editor's Pass posts here too, and it is the one editor gesture that does
 * not use a path below (#163). When a word an editor typed as missing turns out
 * to be in the index on a Rhyme Key other than the day's, the disagreement is
 * recorded as a **Candidate** — the same six fields, the same queue, the same
 * offline judging pass. Giving that its own path would have been a second
 * endpoint writing a second copy of one record, which is precisely what the
 * slice was shaped to avoid.
 *
 * The constant keeps the player's word because the path was built for a
 * player's act and still serves one: an Appeal is a report about a Submission
 * the game rejected, and only the player half has either. The editor half is a
 * word typed as an *add*, adjudicated against nothing — so no sentence the
 * editor is ever shown says "Appeal", and the failure messages
 * `web/src/editor/useDisagreement.ts` builds name the queue this path writes to
 * instead. The URL says `supplement-candidate` for the same reason: the record
 * is what both ends have in common, and the act is not.
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
 * structurally so — `editorDayPlugin` is built by `web/editorRoute.ts`, which
 * declares `apply: "serve"`, so `configureServer` never runs in a production
 * build and no deployed surface answers this path (ADR-0016).
 *
 * The editor's shell calls it instead of loading the Rhyme Index: a day's
 * readout is a few KB against the artifact's fifteen megabytes, and every figure
 * on it is then the one Node computed rather than a second opinion.
 */
export const EDITOR_DAY_PATH = "/api/editor/day";

/**
 * Where the Editor's Pass sets a word's Tier: `GET` for the picker's state on a
 * day, `POST` to append one judgement to `data/tier-overrides.csv`. The day is
 * named the same way as on `EDITOR_DAY_PATH`, and by the same module.
 *
 * Dev only, and structurally so — `editorTierPlugin` is built by
 * `web/editorRoute.ts`, which declares `apply: "serve"`, so `configureServer`
 * never runs in a production build and no deployed surface
 * answers this path (ADR-0016). That guarantee is load-bearing here in a way it
 * is not for the read beside it: this is the one path in the repository that
 * **writes** to `data/`, and the file it writes can never be regenerated
 * (ADR-0015).
 */
export const EDITOR_TIER_PATH = "/api/editor/tier";

/**
 * Where the Editor's Pass demotes a word — removes its wordhood, so a Proper
 * Noun or an abbreviation stops being served as an ordinary Answer: `GET` for
 * the entries standing in `data/demotions.txt`, `POST` to append one.
 *
 * No date, unlike the two paths above. A demotion is a fact about a word rather
 * than about a day, and the same word demoted from Monday's screen is gone from
 * every day that ever held it.
 *
 * Dev only, and structurally so — `editorDemotionPlugin` is built by
 * `web/editorRoute.ts`, which declares `apply: "serve"`, so `configureServer`
 * never runs in a production build and no deployed surface
 * answers this path (ADR-0016). Like the Tier path, this one **writes** to
 * `data/`; unlike it, what it writes is committed and a mistake is reversible by
 * hand, which is exactly how a demotion is reversed.
 */
export const EDITOR_DEMOTION_PATH = "/api/editor/demotion";

/**
 * Where the Editor's Pass submits its queued adds: `POST` alone, carrying the
 * day and the words. It is the one **editor** path with no `GET` — the two
 * report paths above it have none either, and for their own reason — and that
 * is the shape of the feature rather than an omission: the queue lives in the browser
 * and costs nothing until Submit (#161), so there is no server-side list of
 * pending adds for a read to return.
 *
 * One request does three things, because they are one act: the words are given
 * readings and written, the Rhyme Index is rebuilt, and the day is re-read from
 * the artifact that rebuild produced. Splitting them would leave an order for
 * the editor to remember and a half-done pass to remember it in.
 *
 * Dev only, and structurally so — `editorAddPlugin` is built by
 * `web/editorRoute.ts`, which declares `apply: "serve"`, so `configureServer`
 * never runs in a production build and no deployed surface
 * answers this path (ADR-0016). It is the heaviest of the four to leave
 * reachable: it writes to `data/`, spawns a process and rewrites `dist-data/`.
 */
export const EDITOR_ADD_PATH = "/api/editor/add";

/**
 * Where the Editor's Pass reads its own state: `GET` alone, naming nothing.
 * Whether the built Rhyme Index is stale, and whether each file the tool writes
 * carries uncommitted changes (#162).
 *
 * It is the one editor path that takes **no** parameter of any kind — no date,
 * no body, no query. Everything it answers is a fact about the repository
 * rather than about a day, and a status that could be asked for "as of" some
 * argument would be a status somebody could be shown the wrong one of.
 *
 * `GET` and nothing else, and that is the shape of the feature: the status is a
 * read, and every act it might tempt a route into — commit, deploy — is
 * deliberately absent from this tool. See `web/workingTree.ts` for why reading
 * git is not one of the operations #162 bans.
 *
 * Dev only, and structurally so — `editorStatusPlugin` is built by
 * `web/editorRoute.ts`, which declares `apply: "serve"`, so `configureServer`
 * never runs in a production build and no deployed surface answers this path
 * (ADR-0016).
 */
export const EDITOR_STATUS_PATH = "/api/editor/status";
