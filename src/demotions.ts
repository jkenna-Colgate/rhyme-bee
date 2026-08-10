/**
 * The committed demotion list — the human override for the *wordhood* gate, the
 * counterpart to the pronunciation supplement (ADR-0009, ADR-0011 amended).
 *
 * `words.txt` is the wordhood authority and is supposed to exclude proper nouns,
 * but the upstream list carries surnames and placenames — `heinz`, `algiers`,
 * `marx` — and the gate tests wordhood *before* name-hood, so a word in both
 * upstream lists is served to the player as an ordinary Answer. Correcting that
 * by hand in `words.txt` or `names.txt` does not survive a fresh clone: both are
 * regenerable and uncommitted (ADR-0003, `docs/data.md`). This small committed
 * file is the correction that outlives them.
 *
 * Each line demotes one word and says what it is, because the two kinds fail
 * differently for the player:
 *
 *   algiers proper-noun       # a name — rejected as a Proper Noun
 *   lbs     not-a-known-word  # junk with wordhood — rejected as a non-word
 *
 * The second column is the `RejectionReason` the player will actually receive,
 * so the file reads as the verdict it causes. A name that rhymes must be told it
 * is a name (CONTEXT.md); calling an abbreviation somebody's name would be its
 * own small lie.
 *
 * The list is *hand-curated and bounded* — the words a human looked at, not a
 * heuristic over the names list. The SSA names data holds 9,133 words that are
 * also in the word list, `heart`, `faith` and `joy` among them, so name-hood can
 * never be allowed to outrank wordhood wholesale.
 */

import { normaliseWord } from "./cmudict.ts";

/** The rejection a demoted word will earn — the file's second column. */
export type DemotionReason = "proper-noun" | "not-a-known-word";

/**
 * Both reasons the format allows, in the order the demote gesture offers them.
 *
 * Exported so the parser below, the write route's validator and the day view's
 * two buttons all check against one array: a third reason added to the type
 * cannot then be missing from what a request or a file line is checked against,
 * and cannot be a reason the editor has no way to choose. This is the shape
 * `VERDICTS` takes in `src/tierOverride.ts`, for the same reason.
 */
export const DEMOTION_REASONS: readonly DemotionReason[] = ["proper-noun", "not-a-known-word"];

/** True when `value` names one of the two reasons this file recognises. */
export function isDemotionReason(value: string): value is DemotionReason {
  return (DEMOTION_REASONS as readonly string[]).includes(value);
}

export interface Demotion {
  word: string;
  reason: DemotionReason;
}

/** A demotion as applied, so a stale entry can be pruned rather than kept forever. */
export interface AppliedDemotion extends Demotion {
  /** True if the upstream word list really did hold the word this build. */
  hadWordhood: boolean;
}

/** The part of the index build's data this stage touches. Both are mutated. */
export interface DemotionTarget {
  /** The wordhood gate: a demoted word is removed from it. */
  words: Set<string>;
  /** Proper nouns: a demoted *name* is added, so its rejection is labelled. */
  names: Set<string>;
}

/**
 * Serialise one demotion as a single newline-terminated line, ready to append —
 * the write half of the format, so that the Editor's Pass (ADR-0016) can add an
 * entry without knowing how a line is spelled. `src/supplementCandidate.ts` is
 * the precedent: one module holds both halves, because a serialiser living apart
 * from its parser is a second spelling of the format waiting to drift.
 *
 * The columns are separated by one space, and the entries the maintainer wrote
 * by hand are aligned into columns with a trailing `#` gloss. That difference is
 * deliberate rather than a shortfall. Alignment is a property of the file as a
 * whole — the widest word in it decides the column — so a line appended in
 * isolation cannot know where the column sits, and a serialiser that guessed
 * would misalign the file rather than preserve it. `parseDemotions` splits on
 * any run of whitespace, so both spellings read back identically, and a
 * maintainer who wants the file re-aligned can do it in the same hand edit that
 * a reversal takes.
 *
 * The word is normalised here rather than only on the way back in, so the file
 * receives the one spelling the wordhood gate will look the word up under.
 */
export function serialiseDemotion(demotion: Demotion): string {
  return `${normaliseWord(demotion.word)} ${demotion.reason}\n`;
}

/**
 * Parse the demotion list: one `word reason` pair per line, `#` comments and
 * blanks ignored. A line that names no reason, or a reason outside the closed
 * set, throws rather than being skipped — a typo in this file would otherwise
 * silently leave a name in play, which is the exact defect it exists to fix.
 */
export function parseDemotions(text: string): Demotion[] {
  const out: Demotion[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0]!.trim();
    if (line === "") continue;
    const [word, reason, ...rest] = line.split(/\s+/);
    if (reason === undefined || rest.length > 0 || !isDemotionReason(reason)) {
      throw new Error(
        `Demotion "${line}": expected "<word> ${DEMOTION_REASONS.join("|")}" — the reason ` +
          `is the verdict the player receives, so it is not optional.`,
      );
    }
    out.push({ word: normaliseWord(word!), reason });
  }
  return out;
}

/**
 * Apply the demotion list over the pinned upstream inputs. Each entry withdraws
 * wordhood, and a `proper-noun` also joins the names list so the rejection is
 * labelled rather than reading as a typo.
 *
 * It runs *first*, before the supplement, so the demotion is a correction to the
 * upstream word list rather than an override of the override: the supplement's
 * standing rule that it never launders a name into a word (ADR-0009) then covers
 * demoted names too, without knowing this stage exists.
 */
export function applyDemotions(text: string, target: DemotionTarget): AppliedDemotion[] {
  const applied: AppliedDemotion[] = [];
  for (const { word, reason } of parseDemotions(text)) {
    const hadWordhood = target.words.delete(word);
    if (reason === "proper-noun") target.names.add(word);
    applied.push({ word, reason, hadWordhood });
  }
  return applied;
}
