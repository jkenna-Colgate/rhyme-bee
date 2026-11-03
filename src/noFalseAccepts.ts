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
 * maintainer rules on each in the sitting: keep some of the word's readings
 * (#292), a pronunciation correction, a Demotion, or leave it. The game's
 * current readings are shown numbered, with Wiktionary's offered as additions,
 * so a word half right (`environmental`, two readings with the t and two
 * without) keeps the half that is. Below high confidence the Answer is left
 * alone, and a doubtful Answer stays scored until it is ruled.
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

import type { UndecidedRhyme, UntieredWord } from "./batch.ts";
import type { DemotionReason } from "./demotions.ts";
import {
  phonemesOf, readingReachesKey, readingsReachKey, type Confidence, type RhymeRuling, type TierAnswer, type TierRuling, type WordhoodRuling,
} from "./judge.ts";
import { isVowelSound, rhymeKeyOf, type Pronunciation, type RhymeKey } from "./phonology.ts";

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
 * A reading the maintainer is shown when ruling on a word: one the game holds
 * (`game`), one Normalisation appended to a reading the game holds
 * (`normalisation`), or one Wiktionary has and the game does not, offered as an
 * addition (`wiktionary`). Wiktionary's are ARPAbet before Normalisation, which
 * the build applies to whatever is written. Every one but an appended reading is
 * numbered, by its place among those: an appended reading comes back by itself
 * while a reading it was made from is kept, so writing it as a source line would
 * only put a reading the build makes into the supplement.
 */
export interface ShownReading {
  reading: Pronunciation;
  from: "game" | "normalisation" | "wiktionary";
}

/**
 * The readings to show for a word, in this order: the game's current readings
 * as the index holds them (`RhymeIndex.readingsOf`), then each of Wiktionary's
 * the game lacks, once (#292).
 */
export function shownReadings(
  game: readonly { pronunciation: Pronunciation; generated: boolean }[],
  wiktionary: readonly Pronunciation[],
): ShownReading[] {
  const out: ShownReading[] = game.map((g) => ({ reading: [...g.pronunciation], from: g.generated ? "normalisation" : "game" }));
  const seen = new Set(out.map((s) => s.reading.join(" ")));
  for (const reading of wiktionary) {
    const spelling = reading.join(" ");
    if (seen.has(spelling)) continue;
    seen.add(spelling);
    out.push({ reading: [...reading], from: "wiktionary" });
  }
  return out;
}

/**
 * What the maintainer decided about a listed Answer. A correction replaces the
 * word's readings with one, and a keep with the several the maintainer kept
 * (both in `data/supplement.dict`, several readings written as one word's
 * alternates); a Demotion takes the word's wordhood (`data/demotions.txt`);
 * leave it keeps it scored on the maintainer's word; unruled is an Answer
 * skipped.
 *
 * On a rhyme the Judge left undecided (#293), confirm writes a reading beside
 * the word's others (`data/supplement.dict`, a join), decline records a Decline
 * for the word and the Rhyme Key (`data/declines.txt`), and unruled is a rhyme
 * skipped.
 *
 * On a written-in word with no knownness (#294), tier writes a Tier verdict
 * (`data/tier-overrides.csv`, as the Editor's Pass writes one), and unruled is
 * a word skipped. Each kind of item is read by its own parser (`parseDecision`,
 * `parseUndecided`, `parseTier`), which returns only its own kinds.
 */
export type Decision =
  | { kind: "correction"; reading: Pronunciation }
  | { kind: "keep"; readings: Pronunciation[] }
  | { kind: "demotion"; reason: DemotionReason }
  | { kind: "leave" }
  | { kind: "confirm"; reading: Pronunciation }
  | { kind: "decline" }
  | { kind: "tier"; tier: "answer" | "bonus" }
  | { kind: "unruled" };

/**
 * One item of the sitting's ruling list, all put after the Batch's last model
 * call: a hunted Answer the Judge doubts (#268), a rhyme it left undecided
 * (#293), or a word the Batch wrote in that has no knownness, to Tier (#294),
 * with the Judge's answer to the Tier question as the default (#295).
 */
export type RulingItem =
  | { kind: "hunted"; listed: ListedAnswer }
  | { kind: "undecided"; rhyme: UndecidedRhyme }
  | { kind: "tier"; untiered: UntieredWord; judge?: TierRuling };

/** One command a line: what is typed, padded, then its effect. */
const commandLine = (typed: string, effect: string): string => `  ${typed.padEnd(20)} ${effect}`;

const APPENDED_NOTE = "  (appended by Normalisation, so not numbered: it comes back by itself while a reading it was made from is kept)";

/** The readings that can be kept or corrected to, in the order shown: `numbered[n - 1]` is number n. */
const numberedOf = (shown: readonly ShownReading[]): ShownReading[] => shown.filter((s) => s.from !== "normalisation");

/**
 * What the maintainer is shown when a ruling is wanted: the readings under who
 * holds them, numbered but for those Normalisation appended, then that an answer
 * is awaited and one command a line with its effect. Every command it names is
 * one `parseDecision` reads.
 */
export function rulingPrompt(shown: readonly ShownReading[]): string[] {
  const numbered = numberedOf(shown);
  const lines = shown.map((s) => ({
    from: s.from,
    text: s.from === "normalisation" ? `     ${s.reading.join(" ")}${APPENDED_NOTE}` : `  ${numbered.indexOf(s) + 1}. ${s.reading.join(" ")}`,
  }));
  const game = lines.filter((l) => l.from !== "wiktionary").map((l) => l.text);
  const wiktionary = lines.filter((l) => l.from === "wiktionary").map((l) => l.text);
  const readings = !shown.length
    ? ["Readings you can pick: none (the game and Wiktionary have none), so a correction must be typed."]
    : [
        ...(game.length ? ["The game's readings of this word (ARPAbet):", ...game] : ["The game holds no reading of this word."]),
        ...(wiktionary.length ? ["Wiktionary's readings the game lacks, which you can add:", ...wiktionary] : ["Wiktionary's readings the game lacks: none."]),
      ];
  return [
    ...readings,
    "Waiting for your ruling on this word. Type one of these and press Enter:",
    ...(numbered.length
      ? [
          commandLine("k <n> <n> ...", `keep only the readings numbered, e.g. k ${numbered.length > 1 ? "1 2" : "1"} (every other reading goes)`),
          commandLine("k <n> ... <ARPAbet>", "keep those and add one you type, e.g. k 1 K AE1 T"),
          commandLine("c <n>", "correct the reading to number <n> alone, e.g. c 1 (it replaces every reading)"),
        ]
      : []),
    commandLine("c <ARPAbet>", "correct the reading to one you type, e.g. c K AE1 T (it replaces every reading)"),
    commandLine("d", "demote it as a name (the player is told it is a name)"),
    commandLine("d word", "demote it as not a word (the player is told it is not a word)"),
    commandLine("l", "leave it scored, as the game has it"),
    commandLine("s", "skip it: it stays scored unruled, and the day fails its No False Accepts gate"),
  ];
}

/** The reading numbered `n` in the list shown, or null when there is none. */
function numberedReading(shown: readonly ShownReading[], n: string): Pronunciation | null {
  const reading = /^\d+$/.test(n) ? numberedOf(shown)[Number(n) - 1]?.reading : undefined;
  return reading ? [...reading] : null;
}

/**
 * `k <n> <n> ... [<ARPAbet>]`: the numbered readings, in the order shown and
 * once each, then the typed one if it is not among them. At least one number,
 * since a reading typed alone is a correction.
 */
function keepOf(args: readonly string[], shown: readonly ShownReading[]): Decision | null {
  const firstTyped = args.findIndex((a) => !/^\d+$/.test(a));
  const numbers = firstTyped === -1 ? args : args.slice(0, firstTyped);
  if (!numbers.length || numbers.some((n) => !numberedReading(shown, n))) return null;
  const numbered = numberedOf(shown);
  const readings = [...new Set(numbers.map(Number))].sort((a, b) => a - b).map((n) => [...numbered[n - 1]!.reading]);
  if (firstTyped !== -1) {
    const typed = phonemesOf(args.slice(firstTyped).join(" "));
    if (!typed) return null;
    if (!readings.some((r) => r.join(" ") === typed.join(" "))) readings.push(typed);
  }
  return { kind: "keep", readings };
}

/**
 * A ruling as the maintainer types it: `k <n> <n> ...` to keep the numbered
 * readings shown, optionally followed by one typed in ARPAbet; `c <n>` for the
 * nth reading shown alone, or `c <ARPAbet>` for one typed; `d` for a Demotion
 * as a name, `d word` as not a word; `l` to leave it; `s` to skip it. Null when
 * it does not read, so the caller asks again and writes nothing.
 */
export function parseDecision(input: string, shown: readonly ShownReading[]): Decision | null {
  const [command, ...rest] = input.trim().split(/\s+/);
  const arg = rest.join(" ");
  switch (command?.toLowerCase()) {
    case "k":
      return keepOf(rest, shown);
    case "c": {
      if (/^\d+$/.test(arg)) {
        const reading = numberedReading(shown, arg);
        return reading ? { kind: "correction", reading } : null;
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

// ---- a rhyme the Judge left undecided ------------------------------------------

const KNEW: Record<UndecidedRhyme["knew"], (key: RhymeKey) => string> = {
  "missing-reading": () => "the game has no reading of it (a Missing Reading)",
  overrule: (key) => `the game's readings miss /${key}/ (an Overrule)`,
};

/**
 * A reading confirming may write for this rhyme: one that reaches its Rhyme Key
 * once Normalisation has read it (directly, by the merger, or by its Schwa
 * Twin), as the Judge's own reading must to land. Null for one that misses it,
 * since writing it would leave the word no Rhyme on the key it was confirmed for.
 */
const confirmable = (reading: Pronunciation | null, key: RhymeKey): Pronunciation | null =>
  reading && readingReachesKey(reading.join(" "), key) ? [...reading] : null;

/** A reading whose Rhyme Key is `key`: the key said as a word, its first vowel stressed. */
const keyAsReading = (key: RhymeKey): string => {
  let stressed = false;
  return key.split(" ").map((sound) => {
    if (!isVowelSound(sound)) return sound;
    const mark = stressed ? "0" : "1";
    stressed = true;
    return sound + mark;
  }).join(" ");
};

/**
 * What the maintainer is shown for a rhyme the Judge left undecided (#293): what
 * the Judge ruled and what the game knew, the Judge's reading and reasoning, then
 * that an answer is awaited and one command a line with its effect. Confirming
 * the Judge's own reading is offered only when it reaches the Rhyme Key. Its
 * letters are none of a hunted Answer's, so a `d` meant for a Demotion there
 * never declines here. Every command it names is one `parseUndecided` reads.
 */
export function undecidedPrompt(rhyme: UndecidedRhyme): string[] {
  const { word, rhymeKey: key } = rhyme;
  const reading = confirmable(rhyme.reading, key);
  const heard = rhyme.heard ?? "none given";
  return [
    `The Judge ruled it a Rhyme at ${rhyme.confidence} confidence, and nothing landed: ${KNEW[rhyme.knew](key)}.`,
    reading ? `  The Judge's reading: ${heard}` : `  The Judge's reading: ${heard}, which misses /${key}/, so confirming needs a reading typed`,
    `  The Judge's reasoning: ${rhyme.why}`,
    "Waiting for your ruling on this rhyme. Type one of these and press Enter:",
    ...(reading
      ? [
          commandLine("y", `confirm it: ${reading.join(" ")} is written beside the word's readings, so it rhymes on /${key}/ from then on`),
          commandLine("y <ARPAbet>", `confirm it with a reading you type instead, e.g. y ${reading.join(" ")} (written beside the word's readings)`),
        ]
      : [commandLine("y <ARPAbet>", `confirm it with a reading you type, e.g. y ${keyAsReading(key)} (written beside the word's readings)`)]),
    commandLine("n", `decline it: a Decline is recorded for ${word} on /${key}/, so it is not raised again`),
    commandLine("s", "skip it: nothing is written, and the run report lists it"),
  ];
}

/**
 * A ruling on an undecided rhyme as the maintainer types it: `y` to confirm the
 * Judge's reading, `y <ARPAbet>` to confirm one typed; `n` to decline; `s` to
 * skip. Either reading must reach the Rhyme Key. Null when it does not read, or
 * the reading misses the key, so the caller asks again and writes nothing.
 */
export function parseUndecided(input: string, rhyme: UndecidedRhyme): Decision | null {
  const [command, ...rest] = input.trim().split(/\s+/);
  switch (command?.toLowerCase()) {
    case "y": {
      const reading = confirmable(rest.length ? phonemesOf(rest.join(" ")) : rhyme.reading, rhyme.rhymeKey);
      return reading ? { kind: "confirm", reading } : null;
    }
    case "n":
      return rest.length ? null : { kind: "decline" };
    case "s":
      return rest.length ? null : { kind: "unruled" };
    default:
      return null;
  }
}

// ---- a written-in word with no knownness ---------------------------------------

/**
 * What the maintainer is shown to Tier a word the Batch wrote in that has no
 * knownness (#294): why it is asked, the question as Retrieval puts it (would a
 * player produce it, naming the Seed Word; ADR-0015), the Judge's answer to the
 * same question with its confidence when it was asked (#295), that an answer is
 * awaited, then one command a line with its effect. The Judge's answer is only
 * a default: Enter accepts it, and nothing is written until the maintainer
 * rules. Its letters are none of the other items', so a `d` or a `y` meant for
 * one never Tiers here. Every command it names is one `parseTier` reads.
 */
export function tierPrompt(untiered: UntieredWord, judge?: TierRuling): string[] {
  const effect: Record<TierAnswer, string> = {
    answer: "Answer: a Tier verdict is written to data/tier-overrides.csv, so it scores from the next build",
    bonus: "Bonus Word: a Tier verdict is written to data/tier-overrides.csv, so it stays accepted and unscored",
  };
  const proposed = judgeDefault(judge);
  return [
    "Nothing measures how well known it is, so it is a Bonus Word until you Tier it.",
    `Would an ordinary player think of ${untiered.word} when hunting rhymes for ${untiered.seedWord}?`,
    ...(!judge ? []
      : proposed ? [`The Judge's answer: ${TIER_NAME[proposed]}, at ${judge.confidence} confidence: ${judge.why}`]
      : ["The Judge's answer: none it could read, so there is nothing to accept with Enter."]),
    "Waiting for your Tier ruling on this word. Type one of these and press Enter:",
    ...(proposed ? [commandLine("Enter", `accept the Judge's answer, ${effect[proposed]}`)] : []),
    commandLine("a", effect.answer),
    commandLine("b", effect.bonus),
    commandLine("s", "skip it: nothing is written, and the run report lists it"),
  ];
}

const TIER_NAME: Record<TierAnswer, string> = { answer: "Answer", bonus: "Bonus Word" };

/** The Tier the Judge's answer fills in, or null when it gave none that reads. */
const judgeDefault = (judge: TierRuling | undefined): TierAnswer | null =>
  judge && judge.verdict !== "no-ruling" ? judge.verdict : null;

/**
 * A Tier ruling as the maintainer types it: `a` for Answer, `b` for Bonus
 * Word, `s` to skip, and Enter alone for the Judge's answer when it gave one.
 * Null when it does not read, so the caller asks again and writes nothing.
 */
export function parseTier(input: string, judge?: TierRuling): Decision | null {
  switch (input.trim().toLowerCase()) {
    case "": {
      const proposed = judgeDefault(judge);
      return proposed ? { kind: "tier", tier: proposed } : null;
    }
    case "a":
      return { kind: "tier", tier: "answer" };
    case "b":
      return { kind: "tier", tier: "bonus" };
    case "s":
      return { kind: "unruled" };
    default:
      return null;
  }
}

/** How the maintainer's Tier rulings compared with the Judge's answers, as the run report records it (#295). */
export interface TierAgreement {
  /** Every word put to the maintainer to Tier. */
  words: number;
  /** Those the Judge answered and the maintainer ruled on, which are the ones compared. */
  compared: number;
  agreed: number;
  /** `agreed / compared`, or null when nothing was compared. */
  rate: number | null;
  /** Agreed and compared, at each confidence the Judge gave: what a later decision to let high-confidence answers land alone reads. */
  byConfidence: Record<Confidence, [agreed: number, compared: number]>;
}

/**
 * The agreement between the Judge's Tier answers and the maintainer's rulings,
 * over the words both answered: a word skipped, or one the Judge gave no
 * answer on, is counted in `words` and compared with nothing.
 */
export function tierAgreement(settled: readonly { judge?: TierRuling; decision: Decision }[]): TierAgreement {
  const out: TierAgreement = { words: settled.length, compared: 0, agreed: 0, rate: null, byConfidence: { high: [0, 0], medium: [0, 0], low: [0, 0] } };
  for (const { judge, decision } of settled) {
    const proposed = judgeDefault(judge);
    if (!proposed || decision.kind !== "tier") continue;
    const agrees = decision.tier === proposed ? 1 : 0;
    out.compared++;
    out.agreed += agrees;
    const at = out.byConfidence[judge!.confidence];
    at[0] += agrees;
    at[1]++;
  }
  out.rate = out.compared ? out.agreed / out.compared : null;
  return out;
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
