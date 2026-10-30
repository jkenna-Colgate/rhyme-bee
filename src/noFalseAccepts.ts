/**
 * The **No False Accepts** half of a Batch (#268; GLOSSARY.md, Playability Bar
 * and Batch): hunt the doubtful scored Answers on each Seed Word in the block,
 * put them to the Judge, and hand the maintainer a ruling list to settle in the
 * same sitting. This module calls no model, reads no file and writes none;
 * `scripts/batch.ts` does all three.
 *
 * ## The hunt
 *
 * A scored Answer is put to the Judge when it has either
 *
 * - **another key**: Wiktionary has General American readings for it and none of
 *   them has the Seed Word's Rhyme Key (directly or by its Schwa Twin). One
 *   reading that agrees is enough to leave it, as one is enough to make a Rhyme;
 *   this is the agreement the research measured at 96.7% (#221). Or
 * - a **names hit**: the names data holds it. That is no doubt by itself (7% of
 *   scheduled Answers are in the names data, nearly all ordinary words), so it
 *   only sends the word to the Judge.
 *
 * The Judge is asked the rhyme question and, apart from it, the wordhood one.
 *
 * ## The ruling list
 *
 * **Nothing the hunt finds lands on the Judge's word** (#242). A correction here
 * replaces a reading the game holds, which is an Overrule, and an Overrule
 * never writes a reading unreviewed (#238); and once the maintainer has left,
 * nothing undoes a wrong Demotion. So a high-confidence ruling that the Answer
 * is no Rhyme, a name and nothing else, or not a word goes on a list, and the
 * maintainer rules on each in the sitting: a pronunciation correction, a
 * Demotion, or leave it. Below high confidence the Answer is left alone, and a
 * doubtful Answer stays scored until it is ruled.
 *
 * ## The gate
 *
 * It passes when one pass leaves no such Answer scored (#225): every Answer on
 * the list is ruled, and none the maintainer corrected or demoted is still
 * scored once the index is rebuilt. Leaving an Answer is a ruling: it is the
 * maintainer's word that the Judge was wrong. An Answer skipped is not, and
 * fails the day, since it stays scored on nobody's word.
 */

import type { DemotionReason } from "./demotions.ts";
import { phonemesOf, readingsReachKey, type RhymeRuling, type WordhoodRuling } from "./judge.ts";
import { rhymeKeyOf, type Pronunciation, type RhymeKey } from "./phonology.ts";

// ---- the hunt ------------------------------------------------------------------

/** Why the hunt sent an Answer to the Judge. */
export type HuntReason = "another-key" | "names-hit";

export interface HuntedAnswer {
  word: string;
  reasons: HuntReason[];
  /** The Rhyme Keys of its Wiktionary readings. Empty when Wiktionary has none. */
  wiktionaryKeys: RhymeKey[];
}

/** What the hunt reads about an Answer. */
export interface AnswerFacts {
  /** Its Wiktionary readings, normalised as the build normalises CMUdict's. */
  wiktionaryReadings: (word: string) => readonly Pronunciation[];
  /** Whether the names data holds it. */
  isName: (word: string) => boolean;
}

/** The scored Answers of one Seed Word the hunt puts to the Judge, in alphabetical order. */
export function huntAnswers(answers: readonly string[], seedKey: RhymeKey, facts: AnswerFacts): HuntedAnswer[] {
  const out: HuntedAnswer[] = [];
  for (const word of [...new Set(answers)].sort()) {
    const readings = facts.wiktionaryReadings(word);
    const reasons: HuntReason[] = [];
    if (readings.length > 0 && !readingsReachKey(readings, seedKey)) reasons.push("another-key");
    if (facts.isName(word)) reasons.push("names-hit");
    if (reasons.length === 0) continue;
    const keys = [...new Set(readings.map(rhymeKeyOf).filter((k): k is RhymeKey => k !== null))];
    out.push({ word, reasons, wiktionaryKeys: keys });
  }
  return out;
}

// ---- the ruling list -----------------------------------------------------------

/** One hunted Answer with what the Judge said of it. */
export interface HuntRuling {
  seedWord: string;
  rhymeKey: RhymeKey;
  answer: HuntedAnswer;
  rhyme: RhymeRuling;
  /** Absent when the wordhood question was not answered. */
  wordhood?: WordhoodRuling;
}

/** What a high-confidence ruling doubts about a scored Answer. */
export type Doubt = "no-rhyme" | "name" | "not-a-word";

export interface ListedAnswer extends HuntRuling {
  doubts: Doubt[];
}

/** The rulings that go on the maintainer's list: those with a high-confidence doubt, in the order given. */
export function rulingList(rulings: readonly HuntRuling[]): ListedAnswer[] {
  return rulings.flatMap((r) => {
    const doubts: Doubt[] = [];
    if (r.rhyme.verdict === "no-rhyme" && r.rhyme.confidence === "high") doubts.push("no-rhyme");
    if (r.wordhood?.confidence === "high" && (r.wordhood.verdict === "name" || r.wordhood.verdict === "not-a-word")) doubts.push(r.wordhood.verdict);
    return doubts.length ? [{ ...r, doubts }] : [];
  });
}

// ---- the maintainer's ruling ---------------------------------------------------

/**
 * What the maintainer decided about a listed Answer. A correction replaces the
 * game's readings with one (`data/supplement.dict`); a Demotion takes the word's
 * wordhood (`data/demotions.txt`); leave it keeps it scored on the maintainer's
 * word; unruled is an Answer skipped.
 */
export type Decision =
  | { kind: "correction"; reading: Pronunciation }
  | { kind: "demotion"; reason: DemotionReason }
  | { kind: "leave" }
  | { kind: "unruled" };

/**
 * A ruling as the maintainer types it: `c <n>` for the nth reading offered, or
 * `c <ARPAbet>` for one typed; `d` for a Demotion as a name, `d word` as not a
 * word; `l` to leave it; `s` to skip it. Null when it does not read.
 */
export function parseDecision(input: string, offered: readonly Pronunciation[]): Decision | null {
  const [command, ...rest] = input.trim().split(/\s+/);
  const arg = rest.join(" ");
  switch (command?.toLowerCase()) {
    case "c": {
      if (/^\d+$/.test(arg)) {
        const reading = offered[Number(arg) - 1];
        return reading ? { kind: "correction", reading: [...reading] } : null;
      }
      const reading = phonemesOf(arg);
      return reading ? { kind: "correction", reading } : null;
    }
    case "d":
      return arg === "" || arg === "name" ? { kind: "demotion", reason: "proper-noun" } : arg === "word" ? { kind: "demotion", reason: "not-a-known-word" } : null;
    case "l":
      return rest.length ? null : { kind: "leave" };
    case "s":
      return rest.length ? null : { kind: "unruled" };
    default:
      return null;
  }
}

// ---- the gate ------------------------------------------------------------------

export interface NoFalseAcceptsResult {
  result: "pass" | "fail";
  /** Listed Answers with no ruling, in alphabetical order. */
  unruled: string[];
  /** Answers corrected or demoted that the rebuilt index still scores. */
  stillScored: string[];
}

/**
 * The gate on one Seed Word, once the maintainer has ruled and the index is
 * rebuilt. `isScored` reads the rebuilt index: whether the word is still a scored
 * Answer on the day.
 */
export function noFalseAcceptsResult(
  listed: readonly string[],
  decisions: ReadonlyMap<string, Decision>,
  isScored: (word: string) => boolean,
): NoFalseAcceptsResult {
  const unruled: string[] = [];
  const stillScored: string[] = [];
  for (const word of [...new Set(listed)].sort()) {
    const d = decisions.get(word);
    if (!d || d.kind === "unruled") unruled.push(word);
    else if (d.kind !== "leave" && isScored(word)) stillScored.push(word);
  }
  return { result: unruled.length || stillScored.length ? "fail" : "pass", unruled, stillScored };
}
