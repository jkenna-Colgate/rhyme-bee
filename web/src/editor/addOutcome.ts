/**
 * What an add is aimed at, and what came of every word in it: the wire shapes
 * the add endpoint answers with, and the browser renders.
 *
 * ## Why the shapes are declared here
 *
 * For the reason `DemotionWriteResult`, `TierWriteResult` and `EditorStatus`
 * are: the browser cannot import the module that assembles them — it opens
 * files and shells out to an agent — and two declarations of one wire shape is
 * exactly the pair that drifts. Every other editor route already declares its
 * *response* shape here and lets the Node side import it back; the add's nine
 * types were the last ones on the wrong side of that line (#171). The day
 * readout's shapes are still declared in `scripts/editorDay.ts` and imported
 * the other way, so `web/src/` has not stopped reaching into `scripts/`
 * altogether — that is a second module's split and not this one's.
 *
 * So `scripts/editorAdd.ts` imports them back from here. That reads backwards
 * for about a minute and then stops: its one browser-reachable caller is
 * `web/editorAddPlugin.ts`, and it is a `web/` server module that happens to
 * live in `scripts/`.
 */

import type { Pronunciation, RhymeKey } from "../../../src/phonology.ts";
import type { ComposedReading, ReadingEvidence } from "../../../src/supplementEvidence.ts";

/**
 * What an add is aimed at: one Rhyme Key, and where that key came from. The two
 * travel together because the provenance is printed beside the key — a night's
 * add is auditable from its own output only if the readout says whether the
 * editor typed the key or the schedule supplied it.
 */
export interface AddTarget {
  target: RhymeKey;
  provenance: string;
  /**
   * The Seed Word the key belongs to, when the aim came from a scheduled day.
   * Absent when the editor named a Rhyme Key outright on the command line —
   * there is no Puzzle behind that aim and therefore no Seed.
   *
   * It exists because a `reads-on-another-key` outcome can be recorded as a
   * Candidate, and a Candidate names the Seed Word the disagreement is about
   * (#163). Read out of `provenance` it would be a sentence being parsed for a
   * value it was written to *read* well, and taken from the day on screen it
   * would be the wrong Seed the moment the editor looked at a neighbouring day
   * with a batch's outcome still showing — a Candidate that looks right and
   * names a Puzzle the word was never held against. So the outcome carries the
   * Seed it was actually aimed at.
   */
  seed?: string;
}

/**
 * An aim taken from a scheduled day, where the Seed Word is not in question.
 *
 * `AddTarget.seed` is optional because one aim genuinely has no Seed — the
 * command line's `--rhymeKey`, which names a Rhyme Key outright with no Puzzle
 * behind it. That optionality is correct for the union of the two aims and
 * wrong for either one taken alone: every aim `targetIn` builds comes off a
 * scheduled day and therefore *always* carries a Seed, and typing it as though
 * it might not made a real gap on the screen. The browser's record-a-
 * disagreement button needs the Seed Word, so it rendered `seed !== null &&
 * (…)` and a null Seed made the button silently vanish — the editor watching a
 * word do nothing, which is the exact failure the gesture exists to prevent.
 *
 * Narrowing here rather than making `seed` required on `AddTarget` because the
 * `--rhymeKey` aim is not a degenerate scheduled one, it is a second kind of
 * aim, and a required field would have to be filled with a lie. It does not
 * reach all the way to the browser either: `AddOutcome.seed` stays optional
 * because the outcome is the union again, and a wire type cannot carry a
 * guarantee about which caller built it. What this buys is that the one server
 * path a browser can reach (`web/editorAddPlugin.ts`, which aims only through
 * `targetIn`) provably has a Seed — so the null case on screen is a sentence
 * about the CLI's aim rather than a hole the web mode can fall into.
 */
export interface ScheduledAddTarget extends AddTarget {
  seed: string;
}

/**
 * A word that needed nothing: a Proper Noun, refused outright. The space of
 * names is unbounded and has no defensible edge, however well the name
 * rhymes. It is its own case rather than a `deferred` reason — deferring
 * says "later", and a name is never coming back.
 */
export interface RefusedNameOutcome {
  outcome: "refused-name";
  word: string;
}

/**
 * A word CMUdict already reads on the target Rhyme Key: the reading an add would
 * have written is there, so there is nothing to add. It does **not** follow that
 * the word is in the Puzzle. Reading on the key is one of three properties, and
 * an add supplies only this one — a demoted word has no wordhood and appears in
 * neither list however well it reads, and a word that does have wordhood holds a
 * Tier that decides whether it is an Answer or a Bonus Word. Saying "it is in
 * the Puzzle already" would state a conclusion this outcome cannot reach, and
 * the sentence `web/src/editor/AddQueueView.tsx` renders is written to the same
 * limit.
 *
 * Distinguished from `ReadsOnAnotherKeyOutcome` because the two look alike (both
 * are "no write happened") but mean opposite things to the editor reading the
 * outcome: this one is confirmation, that one is a problem.
 *
 * Carries `readings` for the same reason `ReadsOnAnotherKeyOutcome` does: a
 * word can hold more than one CMUdict entry, and confirming *which* reading
 * is the one on the target key is still worth showing, not only the fact of
 * agreement.
 */
export interface AlreadyReadsOutcome {
  outcome: "already-reads";
  word: string;
  readings: ReadingEvidence[];
}

/**
 * A word CMUdict already reads, but not on the target key — a correction
 * rather than an add, and left alone here exactly as it always has been
 * (overriding an upstream pronunciation stays a deliberate hand-edit in
 * `data/supplement.dict`, never something this program does on its own
 * judgement).
 *
 * Carries every direct reading CMUdict holds for the word, keys included —
 * where the index holds it *now* — because a maintainer reading this outcome
 * cannot act on "it disagrees" without also being told what it currently
 * says. The browser names every one of them beside its key, and records the
 * *first* as the engine's respelling when the editor says the word rhymes
 * anyway — `web/src/editor/disagreement.ts` argues why that is the reading the
 * engine itself would have shown (#163). Nothing on either path proposes a
 * correction; recording the disagreement is the whole of what is offered.
 */
export interface ReadsOnAnotherKeyOutcome {
  outcome: "reads-on-another-key";
  word: string;
  readings: ReadingEvidence[];
}

/**
 * A word given a reading and written to `data/supplement.dict`: either
 * composed from a compound split (`composed` carries the parts, for a reader
 * who wants to check the derivation) or authored by the agent once no split
 * reached the target (`composed` is null). Either way the reading passed the
 * same `verifyReading` before arriving here (ADR-0014) — this case does not
 * distinguish the two paths by trustworthiness, only by provenance.
 */
export interface WrittenOutcome {
  outcome: "written";
  word: string;
  phonemes: Pronunciation;
  composed: ComposedReading | null;
}

/**
 * A word neither composed nor authored: no compound split reached the target,
 * and the agent either did not answer (`agent-unavailable`) or proposed a
 * reading that failed the same verification a human proposal would fail
 * (`agent-reading-failed-verification`, and `proposed` carries what it said so
 * the miss is inspectable). Appended to the deferred queue rather than
 * discarded, so the composition's real miss rate is countable and a night's
 * words are not silently retried next time.
 */
export interface DeferredOutcome {
  outcome: "deferred";
  word: string;
  reason: "agent-unavailable" | "agent-reading-failed-verification";
  proposed: Pronunciation | null;
}

export type WordOutcome =
  | RefusedNameOutcome
  | AlreadyReadsOutcome
  | ReadsOnAnotherKeyOutcome
  | WrittenOutcome
  | DeferredOutcome;

/**
 * The whole of one `add` invocation, as a value: the aim it ran against — the
 * Rhyme Key, where that key came from, and the Seed Word behind it when there
 * was one — and every supplied word's outcome in the order it was given.
 * `printAddOutcome` (`scripts/editorAdd.ts`) is one renderer over it; the
 * editor's React view is the other (#150).
 *
 * Flat rather than pre-partitioned into written/deferred lists — `words` is
 * the one list, each entry self-describing via `outcome`, so a reader who
 * wants the partition filters it (as `printAddOutcome` and the two reading
 * collectors beside it in `scripts/editorAdd.ts` all do) and a reader who
 * wants the original order an
 * editor typed the words in still has it. Two lists would have to agree on
 * an order convention neither the CLI nor a browser table actually needs.
 */
export interface AddOutcome {
  target: RhymeKey;
  provenance: string;
  /** The aim's Seed Word, carried through unchanged — see `AddTarget.seed`. */
  seed?: string;
  words: WordOutcome[];
}
