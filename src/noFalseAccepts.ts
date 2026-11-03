/**
 * The **No False Accepts** half of a Batch (#268; GLOSSARY.md, Playability Bar
 * and Batch): hunt the doubtful scored Answers on each Seed Word in the block,
 * put them to the Judge, and hand the maintainer a ruling list to settle in the
 * same sitting. This module calls no model, reads no file and writes none;
 * `scripts/batch.ts` does all three.
 *
 * ## The hunt
 *
 * A scored Answer is put to the Judge when it has any of these reasons:
 *
 * - **another key**: Wiktionary has General American readings for it and none of
 *   them has the Seed Word's Rhyme Key (directly or by its Schwa Twin). One
 *   reading that agrees is enough to leave it, as one is enough to make a Rhyme;
 *   this is the agreement the research measured at 96.7% (#221). Or
 * - a **names hit**: the names data holds it. That is no doubt by itself (7% of
 *   scheduled Answers are in the names data, nearly all ordinary words), so it
 *   only sends the word to the Judge. Or
 * - **appended only** (#297; ADR-0021, 2026-11-02 amendment): every reading the
 *   game holds on the key (or its Schwa Twin) is one Normalisation appended, so
 *   a rule put it there and no source did. Wiktionary's readings go through the
 *   same rules, so their agreeing confirms nothing, and the word is sent though
 *   they agree. The selection is `appendedReadings.ts`'s.
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
 * maintainer rules on each in the sitting: keep some of the word's readings
 * (#292), a pronunciation correction, a Demotion, or leave it. The game's
 * current readings are shown numbered, with Wiktionary's offered as additions,
 * so a word half right (`environmental`, two readings with the t and two
 * without) keeps the half that is. Below high confidence the Answer is left
 * alone, and a doubtful Answer stays scored until it is ruled.
 *
 * An Answer sent as appended only is listed by its day (#297). When the Judge
 * holds any one of them, every appended-only Answer on that day goes on the
 * list as one group, the held ones marked, so words of one shape get one
 * ruling; when it holds none, none of them is listed for this reason. Each word
 * in a group is ruled as any listed Answer is, and is listed once. What the
 * maintainer is shown and how a ruling is read are the ruling list's, in
 * `rulingList.ts`, which holds every kind of item a Batch puts to them; this
 * module chooses the hunted Answers that go on it and gates the day after.
 *
 * ## The gate
 *
 * It passes when one pass leaves no such Answer scored (#225): every Answer on
 * the list is ruled, and none the maintainer corrected or demoted is still
 * scored once the index is rebuilt. Leaving an Answer is a ruling: it is the
 * maintainer's word that the Judge was wrong. So is keeping readings, whether or
 * not one kept still rhymes on the day: the maintainer saw each reading's sound
 * and chose. An Answer skipped is not, and fails the day, since it stays scored
 * on nobody's word.
 */

import { reachesKeyOnlyByAppended, type MarkedReading } from "./appendedReadings.ts";
import { readingsReachKey, type RhymeRuling, type WordhoodRuling } from "./judge.ts";
import { rhymeKeyOf, type Pronunciation, type RhymeKey } from "./phonology.ts";
import { schwaTwinOf } from "./schwaTwins.ts";
import type { Decision } from "./rulingList.ts";

// ---- the hunt ------------------------------------------------------------------

/** Why the hunt sent an Answer to the Judge. */
export type HuntReason = "another-key" | "names-hit" | "appended-only";

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
  /** The game's readings, each marked if Normalisation appended it (`RhymeIndex.readingsOf`). */
  readingsOf: (word: string) => readonly MarkedReading[];
}

/** The scored Answers of one Seed Word the hunt puts to the Judge, in alphabetical order. */
export function huntAnswers(answers: readonly string[], seedKey: RhymeKey, facts: AnswerFacts): HuntedAnswer[] {
  const twin = schwaTwinOf(seedKey);
  const seedKeys = twin === null ? [seedKey] : [seedKey, twin];
  const out: HuntedAnswer[] = [];
  for (const word of [...new Set(answers)].sort()) {
    const readings = facts.wiktionaryReadings(word);
    const reasons: HuntReason[] = [];
    if (readings.length > 0 && !readingsReachKey(readings, seedKey)) reasons.push("another-key");
    if (facts.isName(word)) reasons.push("names-hit");
    if (reachesKeyOnlyByAppended(facts.readingsOf(word), seedKeys)) reasons.push("appended-only");
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

/** A ruling as it is listed, with what it doubts. A member of a day's group the Judge did not hold doubts nothing. */
export interface ListedAnswer extends HuntRuling {
  doubts: Doubt[];
}

/** What a ruling holds the Answer for: each high-confidence doubt it has, if any. */
function doubtsOf(r: HuntRuling): Doubt[] {
  const doubts: Doubt[] = [];
  if (r.rhyme.verdict === "no-rhyme" && r.rhyme.confidence === "high") doubts.push("no-rhyme");
  if (r.wordhood?.confidence === "high" && (r.wordhood.verdict === "name" || r.wordhood.verdict === "not-a-word")) doubts.push(r.wordhood.verdict);
  return doubts;
}

/** The rulings that go on the maintainer's list: those with a high-confidence doubt, in the order given. */
export function rulingList(rulings: readonly HuntRuling[]): ListedAnswer[] {
  return rulings.flatMap((r) => {
    const doubts = doubtsOf(r);
    return doubts.length ? [{ ...r, doubts }] : [];
  });
}

/**
 * Every Answer on one day sent because only Normalisation puts it on the key,
 * listed together because the Judge held at least one of them (#297). The
 * Judge is an alarm for the day, not a verdict on each word: on `event` it held
 * `vestment` and passed `comment`, which has the same shape, and two such words
 * ruled apart would be a Trust failure of their own. A held member carries its
 * doubts; the others carry none.
 */
export interface AppendedGroup {
  seedWord: string;
  rhymeKey: RhymeKey;
  members: ListedAnswer[];
}

/**
 * The hunt's part of the ruling list: the groups of the days the Judge held an
 * appended-only Answer on, and every other Answer with a high-confidence doubt,
 * each in the order given. A word in a group is listed there alone, whatever
 * other reason it was sent for, so no word is put to the maintainer twice.
 */
export function huntListing(rulings: readonly HuntRuling[]): { answers: ListedAnswer[]; groups: AppendedGroup[] } {
  const appendedOnly = (r: HuntRuling) => r.answer.reasons.includes("appended-only");
  const heldDays = new Set(rulings.filter((r) => appendedOnly(r) && doubtsOf(r).length).map((r) => r.seedWord));
  const grouped = (r: HuntRuling) => heldDays.has(r.seedWord) && appendedOnly(r);
  const groups: AppendedGroup[] = [];
  for (const r of rulings.filter(grouped)) {
    let group = groups.find((g) => g.seedWord === r.seedWord);
    if (!group) groups.push((group = { seedWord: r.seedWord, rhymeKey: r.rhymeKey, members: [] }));
    group.members.push({ ...r, doubts: doubtsOf(r) });
  }
  return { answers: rulingList(rulings.filter((r) => !grouped(r))), groups };
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
    else if ((d.kind === "correction" || d.kind === "demotion") && isScored(word)) stillScored.push(word);
  }
  return { result: unruled.length || stillScored.length ? "fail" : "pass", unruled, stillScored };
}
