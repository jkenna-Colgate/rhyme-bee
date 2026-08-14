/**
 * The **correction** judgement: what an agent proposed for a word whose engine
 * reading is wrong, what approving it writes, and the sentences the editor reads
 * before approving (#180).
 *
 * ## Why the shapes are declared here
 *
 * For the reason `addOutcome.ts`, `decline.ts` and `DemotionWriteResult` are:
 * the browser cannot import the module that assembles them — it opens files,
 * shells out to an agent and rebuilds the Rhyme Index — and two declarations of
 * one wire shape is exactly the pair that drifts. `scripts/editorCorrection.ts`
 * imports them back, the direction every other editor route already uses.
 *
 * ## Two acts, one route, and nothing written between them
 *
 * A correction is **proposed** and then **approved**, and the gap between the
 * two is the whole point: a proposal the editor disagrees with costs nothing,
 * because asking for one writes nothing anywhere (ADR-0017). So the proposal is
 * a value with the engine's current readings on it — the thing the editor is
 * comparing against — and the approval is a second request that names the
 * reading it approves rather than a token referring to one held on a server.
 *
 * ## Replace and join
 *
 * A supplement entry replaces every upstream reading for its word, which is
 * right for an upstream stress that is simply wrong and wrong for a word with
 * two legitimate pronunciations (ADR-0009's superseded point, ADR-0017). A
 * correction that **joins** writes the engine's readings and the new one as
 * alternate-pronunciation entries, which `parseCmudict` already merges into one
 * set and which adjudication already honours, since a Submission rhymes if *any*
 * of its Rhyme Keys matches. **The merge is not modified and no new syntax is
 * introduced.**
 *
 * Making the supplement append by default is rejected and is not re-proposed
 * here: an appended wrong reading goes on making words rhyme that should not,
 * silently and forever. The choice is the editor's because only the editor knows
 * which of the two situations they are in.
 */

import { rhymeKeyOf, type Pronunciation, type RhymeKey } from "../../../src/phonology.ts";
import { respell } from "../../../src/respelling.ts";
import type { PuzzleFacts } from "../../../src/schedule.ts";
import type { ReadingEvidence } from "../../../src/supplementEvidence.ts";
import type { RebuildResult } from "./add.ts";

/** Which of the two a correction is. The editor's choice, never the tool's. */
export type CorrectionMode = "replace" | "join";

/** The two, in the order the card offers them. */
export const CORRECTION_MODES: readonly CorrectionMode[] = ["replace", "join"];

/**
 * A reading an agent authored, shown and **written nowhere**.
 *
 * It carries the engine's current readings beside it, because that is what makes
 * the approval a judgement rather than a rubber stamp: the editor is approving a
 * change they can see, not a change they are told about. And it carries the
 * proposal's own Rhyme Key and respelling, so whether it lands where the
 * Candidate needs it to is on the screen rather than in the editor's head.
 */
export interface CorrectionProposal {
  outcome: "proposed";
  word: string;
  /** The Rhyme Key the Candidate is aimed at — what the proposal is measured against. */
  target: RhymeKey;
  /** Every reading the engine holds for this word today. Empty for an honest reading. */
  current: ReadingEvidence[];
  phonemes: Pronunciation;
  /** The proposal's own Rhyme Key, or null when it carries no stressed vowel. */
  key: RhymeKey | null;
  /** The proposal, respelled, so it can be read rather than decoded. */
  respelling: string;
  /**
   * Whether the proposal reaches the target.
   *
   * **Reported, never enforced.** A proposal that reaches the target is the
   * correction the Candidate asked for. One that does not is the word's *honest
   * reading* — the player was wrong, and writing it is what makes the engine say
   * "doesn't rhyme" instead of "not a word we know" (#176). Both are approved
   * through this one value and this one act; refusing the second here would be
   * the second code path the ticket rules out.
   */
  reaches: boolean;
}

/**
 * The agent did not answer. A missing CLI, a non-zero exit, unparseable output
 * and a process that hung are all this to the editor, exactly as they are on the
 * add path — the word waits, and nothing was written.
 */
export interface CorrectionUnavailable {
  outcome: "agent-unavailable";
  word: string;
  target: RhymeKey;
  current: ReadingEvidence[];
}

/**
 * There is no correction to make: either the word already reaches the target —
 * which is a resolved Candidate, and nothing is being rejected — or the engine
 * holds no reading at all for it, which is an **add** rather than a correction
 * and is offered as one on the card beside this.
 *
 * Its own case rather than an error, because neither is a failure: both are the
 * queue telling the editor which act this word actually wants. Nothing is
 * written and no agent is asked.
 */
export interface NothingToCorrect {
  outcome: "nothing-to-correct";
  word: string;
  target: RhymeKey;
  current: ReadingEvidence[];
  /** True when the word already reads on the target — the resolved case. */
  rhymesDirectly: boolean;
}

export type CorrectionOutcome = CorrectionProposal | CorrectionUnavailable | NothingToCorrect;

/**
 * One day the correction reached, as it read before and as it reads now.
 *
 * `before` and `after` are null for a day the index could not build, which is
 * `readScheduledDay`'s own two other outcomes and not this module's to flatten.
 * `moved` is the question the editor actually has — a day whose figures and
 * lists are unchanged is a day they can stop thinking about.
 */
export interface DayMovement {
  date: string;
  seed: string;
  rhymeKey: RhymeKey;
  before: PuzzleFacts | null;
  after: PuzzleFacts | null;
  /** Whether the corrected word was in the day's Answers or Bonus Words. */
  heldBefore: boolean;
  heldAfter: boolean;
  /** True when anything above changed. */
  moved: boolean;
}

/**
 * What an approved correction came to: what was written, which Rhyme Keys the
 * word held before and after, and what moved on the days those keys reach.
 *
 * `rechecked` is the **union** of `keysBefore` and `keysAfter`, which is what
 * covers replace and join without the screen needing to know which happened: a
 * join leaves the word on its old key and adds a new one, a replace moves it,
 * and the union is right for both. The run holds 260 days over 260 distinct
 * Rhyme Keys, so a key reaches at most one day and the recheck stays small.
 */
export interface CorrectionWriteResult {
  word: string;
  mode: CorrectionMode;
  /** The readings appended to `data/supplement.dict`, in the order they were written. */
  written: Pronunciation[];
  keysBefore: RhymeKey[];
  keysAfter: RhymeKey[];
  rechecked: RhymeKey[];
  rebuilt: RebuildResult;
  /** Every scheduled day on a rechecked key. Days with nothing on them included. */
  days: DayMovement[];
}

/**
 * Which modes this correction can offer.
 *
 * **Join needs something to join to.** A word the engine holds no reading for —
 * the honest reading, approved off a failed-verification proposal — has no
 * second pronunciation to stand alongside, so offering the choice would be
 * offering two buttons that write the same line. A function rather than a
 * condition at the call site, so the panel that draws the buttons and the test
 * that holds the rule to account read the same rule.
 */
export function correctionModes(current: readonly ReadingEvidence[]): readonly CorrectionMode[] {
  return current.length === 0 ? ["replace"] : CORRECTION_MODES;
}

/** The button's own words: the choice, as the editor would say it. */
export const CORRECTION_MODE_LABEL: Record<CorrectionMode, string> = {
  replace: "Replace the engine's reading",
  join: "Join it, keeping both",
};

/**
 * What each choice will do, shown **beside the button and before it is clicked**.
 *
 * The two are not symmetrical and the asymmetry is the decision: replacing a
 * reading that was in fact legitimate takes a pronunciation away from the player
 * who has it, and joining a reading that was in fact wrong leaves the wrong one
 * making words rhyme that should not. Only the editor knows which situation they
 * are in, so both costs are named before either button is available.
 */
export const CORRECTION_MODE_CONSEQUENCE: Record<CorrectionMode, string> = {
  replace:
    "Writes one reading to data/supplement.dict, standing in place of every reading the engine " +
    "holds for this word. Right when the upstream reading is simply wrong. If the old reading " +
    "was a legitimate second pronunciation, this takes it away from the player who has it.",
  join:
    "Writes both readings to data/supplement.dict as alternates, which the existing parser " +
    "merges into one set — the word is then accepted on either pronunciation. Right when the " +
    "word legitimately holds two. If the old reading is simply wrong, this leaves it making " +
    "words rhyme that should not.",
};

/**
 * The reach of a correction, said before it is approved.
 *
 * It is the sentence that distinguishes a correction from an add. An add fills a
 * gap on the day being read and does nothing anywhere else; a correction changes
 * what the word *is*, on every day that ever holds it, in the same way a
 * demotion does. An editor who learns that from the result rather than from the
 * button has already done it — which is `DECLINE_CONSEQUENCE`'s argument
 * (`decline.ts`) for the same kind of sentence.
 */
export const CORRECTION_REACH =
  "A correction changes this word on every day, not just this one — every Puzzle that holds " +
  "it is re-read against the new pronunciation. That is what makes it different from an add, " +
  "which only fills a gap. The days on the word's Rhyme Keys before and after are rechecked " +
  "once it lands, and what moved is reported below.";

/** The days a correction actually changed, out of every day it reached. */
export function movedDays(result: CorrectionWriteResult): DayMovement[] {
  return result.days.filter((day) => day.moved);
}

/**
 * A proposal the add path **already made**, as the approve card reads it.
 *
 * `agent-reading-failed-verification` (`addOutcome.ts`) is a word an agent
 * authored a reading for and `verifyReading` refused, because the reading does
 * not reach the target. That is the *same value* the correction card approves,
 * arriving from the other direction — so it is turned into one here rather than
 * asked for again. Asking again would spend another minute of agent time to get
 * a different reading, and would throw away the one the editor is being invited
 * to judge.
 *
 * This is the **one branch**, and the reason the honest-reading Decline is not a
 * second feature: a proposal that misses its target is either a correction the
 * editor declines or the word's honest reading, and approving it writes the
 * reading either way (#176). `reaches` is false by construction — it is what
 * "failed verification" means — and it is recomputed rather than hard-coded, so
 * a caller that hands this a proposal that *does* reach the key gets the truth
 * rather than a lie inherited from the name of the outcome.
 *
 * `rhymeKeyOf` and `respell` are pure phoneme functions and need no Rhyme Index:
 * this computes what the reading *says*, not what any Puzzle makes of it, which
 * is the line ADR-0016 draws (`dayCandidates.ts` argues it for the queue).
 */
export function honestReading(
  word: string,
  target: RhymeKey,
  proposed: Pronunciation,
): CorrectionProposal {
  return {
    outcome: "proposed",
    word,
    target,
    // The engine reads this word not at all — that is why it went to an agent.
    current: [],
    phonemes: proposed,
    key: rhymeKeyOf(proposed),
    respelling: respell(proposed),
    reaches: rhymeKeyOf(proposed) === target,
  };
}
