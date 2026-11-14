/**
 * The Batch's **ruling list** (#268, #292 to #295, #319): every item a Batch
 * puts to the maintainer after its last model call, what the maintainer is shown
 * for each, and how what they type is read. There are five kinds of item: a
 * hunted Answer the Judge doubts and a day's group of Answers only Normalisation
 * puts on the key (both chosen by `noFalseAccepts.ts`, which gates the day on
 * the rulings), a rhyme the Judge left undecided, a written-in word with no
 * knownness to Tier, and a written-in word whose knownness makes it an Answer,
 * to keep or make a Bonus Word. Each kind has its own prompt and parser, and a
 * parser returns only the Decisions its kind can make. This module calls no
 * model, reads no file and writes none; `scripts/batchHunt.ts` asks and writes.
 */

import type { UndecidedRhyme, UntieredWord, WrittenInAnswer } from "./batch.ts";
import type { DemotionReason } from "./demotions.ts";
import { agreementOver, phonemesOf, readingReachesKey, type Agreement, type TierAnswer, type TierRuling } from "./judge.ts";
import type { AppendedGroup, ListedAnswer } from "./noFalseAccepts.ts";
import { isVowelSound, type Pronunciation, type RhymeKey } from "./phonology.ts";
import { isGeneratedVariantOf } from "./rhymeIndex.ts";

// ---- the maintainer's ruling ---------------------------------------------------

/**
 * A reading the maintainer is shown when ruling on a word: one the game holds
 * (`game`), one Normalisation appended to a reading the game holds
 * (`normalisation`), or one Wiktionary has and the game does not, offered as an
 * addition (`wiktionary`). Wiktionary's are ARPAbet before Normalisation, which
 * the build applies to whatever is written. Every one is numbered, by its place
 * in the list. An appended reading carries the readings it was made from
 * (`madeFrom`), told by its shape as the index tells it: it is never written
 * as a source line, because the build makes it again while one of those is
 * kept, and leaving it out of a keep that holds one of them takes a
 * Normalisation Exception (#323).
 */
export interface ShownReading {
  reading: Pronunciation;
  from: "game" | "normalisation" | "wiktionary";
  /** The earlier readings of the word an appended reading was made from. Only on `normalisation`. */
  madeFrom?: Pronunciation[];
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
  const out: ShownReading[] = game.map((g, i) => g.generated
    ? {
        reading: [...g.pronunciation],
        from: "normalisation",
        madeFrom: game.slice(0, i).filter((earlier) => isGeneratedVariantOf(g.pronunciation, earlier.pronunciation)).map((earlier) => [...earlier.pronunciation]),
      }
    : { reading: [...g.pronunciation], from: "game" });
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
 * alternates). A keep's `readings` are the ones to write: a kept reading that
 * Normalisation appended is not among them, since the build makes it again.
 * Its `excepted` are the appended readings left out that the build would make
 * again from what is kept, each written as a Normalisation Exception
 * (`data/normalisation-exceptions.txt`, #323). A Demotion takes the word's
 * wordhood (`data/demotions.txt`);
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
 * a word skipped. On a written-in word that scores (#319), leave keeps it an
 * Answer and writes nothing, and tier writes a Bonus Word verdict. Each kind of
 * item is read by its own parser (`parseDecision`, `parseUndecided`,
 * `parseTier`, `parseWrittenInAnswer`), which returns only its own kinds.
 */
export type Decision =
  | { kind: "correction"; reading: Pronunciation }
  | { kind: "keep"; readings: Pronunciation[]; excepted?: Pronunciation[] }
  | { kind: "demotion"; reason: DemotionReason }
  | { kind: "leave" }
  | { kind: "confirm"; reading: Pronunciation }
  | { kind: "decline" }
  | { kind: "tier"; tier: TierAnswer }
  | { kind: "unruled" };

/**
 * One item of the sitting's ruling list, all put after the Batch's last model
 * call: a hunted Answer the Judge doubts (#268), a day's group of Answers only
 * Normalisation puts on the key (#297), a rhyme it left undecided (#293), or a
 * word the Batch wrote in that has no knownness, to Tier (#294), with the
 * Judge's answer to the Tier question as the default (#295), or a word it wrote
 * in whose knownness makes it an Answer, to keep or make a Bonus Word (#319).
 * Each word in a group is ruled as a hunted Answer is, with the same prompt and
 * parser.
 */
export type RulingItem =
  | { kind: "hunted"; listed: ListedAnswer }
  | { kind: "appended-group"; group: AppendedGroup }
  | { kind: "undecided"; rhyme: UndecidedRhyme }
  | { kind: "tier"; untiered: UntieredWord; judge?: TierRuling }
  | { kind: "written-in-answer"; written: WrittenInAnswer };

/** One command a line: what is typed, padded, then its effect. */
const commandLine = (typed: string, effect: string): string => `  ${typed.padEnd(20)} ${effect}`;

const spelt = (reading: Pronunciation): string => reading.join(" ");

/** What an appended reading's line says after it: which numbers it was made from, and what leaving it out does. */
function appendedNote(appended: ShownReading, shown: readonly ShownReading[]): string {
  const sources = (appended.madeFrom ?? []).map((source) => shown.findIndex((s) => spelt(s.reading) === spelt(source)) + 1);
  return sources.length
    ? `  (appended by Normalisation to ${sources.join(" and ")}: keep ${sources.join(" or ")} without it and a Normalisation Exception is written for it)`
    : "  (appended by Normalisation)";
}

/**
 * What the maintainer is shown when a ruling is wanted: the readings under who
 * holds them, each numbered by its place and those Normalisation appended
 * marked, then that an answer is awaited and one command a line with its
 * effect. Every command it names is one `parseDecision` reads.
 */
export function rulingPrompt(shown: readonly ShownReading[]): string[] {
  const lines = shown.map((s, i) => ({
    from: s.from,
    text: `  ${i + 1}. ${s.reading.join(" ")}${s.from === "normalisation" ? appendedNote(s, shown) : ""}`,
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
    ...(shown.length
      ? [
          commandLine("k <n> <n> ...", `keep only the readings numbered, e.g. k ${shown.length > 1 ? "1 2" : "1"} (every other reading goes)`),
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
  const reading = /^\d+$/.test(n) ? shown[Number(n) - 1]?.reading : undefined;
  return reading ? [...reading] : null;
}

/**
 * `k <n> <n> ... [<ARPAbet>]`: the numbered readings, in the order shown and
 * once each, then the typed one if it is not among them. At least one number,
 * since a reading typed alone is a correction.
 *
 * A reading Normalisation appended can be kept only with a reading it was made
 * from, numbered in the same keep: without one nothing would make it, and
 * writing it as a source line would make it a reading the word was given. Kept
 * that way it is written nowhere. Left out, it is excepted when the build would
 * make it again: when a reading it was made from is kept, or is itself an
 * appended reading being excepted here (the build makes that one first).
 */
function keepOf(args: readonly string[], shown: readonly ShownReading[]): Decision | null {
  const firstTyped = args.findIndex((a) => !/^\d+$/.test(a));
  const numbers = firstTyped === -1 ? args : args.slice(0, firstTyped);
  if (!numbers.length || numbers.some((n) => !numberedReading(shown, n))) return null;
  const kept = [...new Set(numbers.map(Number))].sort((a, b) => a - b).map((n) => shown[n - 1]!);
  const isKept = (reading: Pronunciation) => kept.some((k) => spelt(k.reading) === spelt(reading));
  const appendedKept = kept.filter((s) => s.from === "normalisation");
  if (appendedKept.some((s) => !(s.madeFrom ?? []).some(isKept))) return null;

  const readings = kept.filter((s) => s.from !== "normalisation").map((s) => [...s.reading]);
  if (firstTyped !== -1) {
    const typed = phonemesOf(args.slice(firstTyped).join(" "));
    if (!typed) return null;
    if (!readings.some((r) => spelt(r) === spelt(typed))) readings.push(typed);
  }

  // In the order shown, so a reading appended to an appended reading meets its source already decided.
  const excepted: Pronunciation[] = [];
  const madeAgain = (reading: Pronunciation) => isKept(reading) || excepted.some((e) => spelt(e) === spelt(reading));
  for (const s of shown) {
    if (s.from === "normalisation" && !isKept(s.reading) && (s.madeFrom ?? []).some(madeAgain)) excepted.push([...s.reading]);
  }
  return { kind: "keep", readings, ...(excepted.length ? { excepted } : {}) };
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

// ---- a written-in word that scores ---------------------------------------------

/**
 * What the maintainer is shown for a word the Batch wrote in whose knownness is
 * at or above the Answer line (#319): that it scores and nobody has looked at
 * it, the Retrieval question (ADR-0015), that an answer is awaited, then one
 * command a line with its effect. Its default is the Tier it already holds, so
 * Enter keeps it and writes nothing; the Judge is not asked, because over the
 * maintainer's blind marks it called half the marked Answers Bonus Words.
 * Every command it names is one `parseWrittenInAnswer` reads.
 */
export function writtenInAnswerPrompt(written: WrittenInAnswer, answerLine: number): string[] {
  return [
    `Its knownness is ${written.knownness.toFixed(2)}, at or above the Answer line of ${answerLine.toFixed(2)}, ` +
    "so it scores as an Answer, and nobody has looked at it.",
    `Would an ordinary player think of ${written.word} when hunting rhymes for ${written.seedWord}?`,
    "Waiting for your Tier ruling on this word. Type one of these and press Enter:",
    commandLine("Enter", "keep it an Answer, as it is: nothing is written"),
    commandLine("a", "the same as Enter"),
    commandLine("b", "Bonus Word: an unlocked Tier verdict is written to data/tier-overrides.csv, so it stays accepted and unscored from the next build"),
  ];
}

/**
 * A ruling on a written-in word that scores, as the maintainer types it: Enter
 * alone, or `a`, to keep it an Answer (`leave`, which writes nothing), and `b`
 * for a Bonus Word. Null when it does not read, so the caller asks again and
 * writes nothing.
 */
export function parseWrittenInAnswer(input: string): Decision | null {
  switch (input.trim().toLowerCase()) {
    case "":
    case "a":
      return { kind: "leave" };
    case "b":
      return { kind: "tier", tier: "bonus" };
    default:
      return null;
  }
}

/**
 * How the maintainer's Tier rulings compared with the Judge's answers, as the
 * run report records it (#295): compared are the words the Judge answered and
 * the maintainer ruled on.
 */
export interface TierAgreement extends Agreement {
  /** Every word put to the maintainer to Tier. */
  words: number;
}

/**
 * The agreement between the Judge's Tier answers and the maintainer's rulings,
 * over the words both answered: a word skipped, or one the Judge gave no
 * answer on, is counted in `words` and compared with nothing.
 */
export function tierAgreement(settled: readonly { judge?: TierRuling; decision: Decision }[]): TierAgreement {
  const comparisons = settled.flatMap(({ judge, decision }) => {
    const proposed = judgeDefault(judge);
    return proposed && decision.kind === "tier" ? [{ confidence: judge!.confidence, agrees: decision.tier === proposed }] : [];
  });
  return { words: settled.length, ...agreementOver(comparisons) };
}
