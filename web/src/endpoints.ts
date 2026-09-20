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
 *
 * That rule binds the sentences an editor can actually read: the ones
 * `useDisagreement.ts` builds, and the dev plugin's. It stops at the deployed
 * Worker, whose refusals say "Appeal" freely and are right to. `editor.html`
 * is not a build input, and in dev this path is `web/supplementPlugin.ts`, so
 * the Editor's Pass never meets `web/worker/appealRoute.ts` at all.
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
 * Where the Editor's Pass reads the **Candidate Queue**: `GET` alone, naming
 * nothing. Every outstanding Candidate grouped by Rhyme Key, each group carrying
 * the scheduled day the schedule holds for that key, and each Candidate carrying
 * a state already derived (#176, #177).
 *
 * No date, like the demotion path and unlike the two day-scoped ones. A
 * Candidate is aimed at a Rhyme Key rather than at a date — 17 of the 33
 * standing Candidates belong to no scheduled day at all — so the whole queue is
 * one answer and the day panel is a filter over it in the browser
 * (`web/src/editor/dayCandidates.ts`), not a second request with a date on it.
 *
 * It **writes nothing**, which makes it the second read-only editor path after
 * the status one. Resolution is derived from the pinned sources on every read,
 * so a Candidate fixed by a change made anywhere else in the build clears itself
 * without a file recording that it did.
 *
 * Dev only, and structurally so — `editorCandidatesPlugin` is built by
 * `web/editorRoute.ts`, which declares `apply: "serve"`, so `configureServer`
 * never runs in a production build and no deployed surface answers this path
 * (ADR-0016, ADR-0017).
 */
export const EDITOR_CANDIDATES_PATH = "/api/editor/candidates";

/**
 * Where the Editor's Pass **declines a Candidate**: `POST` alone, appending one
 * ruling to `data/declines.txt`.
 *
 * No `GET`. Which Candidates stand declined is derived server-side on every read
 * of the queue (`EDITOR_CANDIDATES_PATH`), which is where the screen already
 * learns it; a second verb serving the same fact would be a second answer to one
 * question (#176).
 *
 * A ruling names a word **and a Rhyme Key**, which is the one thing that
 * distinguishes it from the demotion path beside it. A demotion is a fact about
 * a word; a Decline is a ruling on a word *aimed at a target*, so declining
 * `docked` against `AA K T` leaves it visible when a player who hears it
 * differently Appeals it against `AA K` (#176).
 *
 * It records only **one** of the three Declines an editor can make: the case
 * where the engine's rejection is already correct and the Candidate should stop
 * appearing. A Proper Noun and junk with wordhood are demotions, and the gesture
 * reaches `EDITOR_DEMOTION_PATH` with the word prefilled rather than writing a
 * second copy of that fact — one demotion path in the tool, not two.
 *
 * Dev only, and structurally so — `editorDeclinePlugin` is built by
 * `web/editorRoute.ts`, which declares `apply: "serve"`, so `configureServer`
 * never runs in a production build and no deployed surface answers this path
 * (ADR-0016, ADR-0017). Like the demotion path it **writes** to `data/`, and
 * what it writes is committed and reversed by hand.
 */
export const EDITOR_DECLINE_PATH = "/api/editor/decline";

/**
 * Where the Editor's Pass **corrects a reading**: `POST` alone, in two asks on
 * one path (#180).
 *
 * A body naming a word and a Rhyme Key asks an agent to propose a corrected
 * reading and **writes nothing at all**. A body that also names the reading and
 * whether it **replaces** the engine's or **joins** it as an alternate approves
 * that proposal — and that request writes to `data/supplement.dict`, rebuilds
 * the Rhyme Index and rechecks the days on the union of the word's Rhyme Keys
 * before and after.
 *
 * Two asks on one path rather than two paths, because the approval is
 * meaningless without the proposal and they are one act to the editor. What it
 * buys is that "nothing is written before approval" is a property of the parsed
 * body — a request with no reading on it — rather than of a router remembering
 * which half it mounted where.
 *
 * No `GET`. A proposal is not a fact about the repository that can be read back:
 * it is authored on request, costs a subprocess, and is deliberately kept
 * nowhere between the two calls (`web/editorCorrectionPlugin.ts`).
 *
 * Dev only, and structurally so — `editorCorrectionPlugin` is built by
 * `web/editorRoute.ts`, which declares `apply: "serve"`, so `configureServer`
 * never runs in a production build and no deployed surface answers this path
 * (ADR-0016, ADR-0017). It is the joint heaviest of the editor routes with the
 * add beside it: it writes to `data/`, spawns a process and rewrites
 * `dist-data/`.
 */
export const EDITOR_CORRECTION_PATH = "/api/editor/correction";

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

/**
 * Where the Editor's Pass asks what is **true of a list of words** against one
 * Rhyme Key: `POST` alone, carrying the day's key and the words to ask about,
 * answering with per-word evidence — wordhood, name status, the readings the
 * pinned sources hold, a reading composed from a compound split when one reaches
 * the key, and the word's prevalence row (#189).
 *
 * It answers with **evidence and never with piles**. Wordhood, names,
 * readings, composition and knownness are all Node-only facts and no module
 * under `web/src/` can reach them, so this is the seam that carries them across;
 * how they are then grouped is a browser decision that `pastedList.ts` makes
 * and that the tickets after this one keep changing. A pile wire type would
 * put a UI shape in a contract Node had to agree with, and put the join itself
 * behind an HTTP call where neither a test nor the view could reach it.
 *
 * `POST` because 274 words do not fit a query string, and it is nonetheless a
 * **read**: it writes no file under `data/`, rebuilds nothing and spawns no
 * subprocess. It is the third read-only editor path, after the status one and
 * the Candidate Queue.
 *
 * Dev only, and structurally so — `editorEvidencePlugin` is built by
 * `web/editorRoute.ts`, which declares `apply: "serve"`, so `configureServer`
 * never runs in a production build and no deployed surface answers this path
 * (ADR-0016).
 */
export const EDITOR_EVIDENCE_PATH = "/api/editor/evidence";
