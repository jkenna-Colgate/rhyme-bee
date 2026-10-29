/**
 * The Judge (GLOSSARY.md) as an instrument: the prompts it is sent, how its
 * replies are read, the reading check, which Candidates it is asked about, and
 * what a ruling earns (#250). It calls no model and writes no file. The
 * callers in `scripts/` own the `claude -p` call, the cache and the run report,
 * and one module serves the `judge` command, the Synthetic Player, and later the
 * Batch and the Appeals job of ADR-0021.
 *
 * The rhyme prompt is the prototype's `--rules 2` wording with no evidence shown
 * (`prototype/238-judge-margin`), because that is the wording the margin was
 * measured on (#238), with a line for every Normalisation that has shipped
 * (#266). A change to it is measured with `judge --score` before it is trusted. The wordhood question is asked apart
 * from it: folded into the rhyme prompt it caught the names and cost real Rhymes
 * their high confidence.
 *
 * Classifying a ruling says what ADR-0017's table gives it, and acts on nothing.
 * `judgeLanding.ts` turns a classified ruling into the writes it earns (#266).
 */

import { applyNormalisation, NORMALISATION_NAMES } from "./normalise.ts";
import { rhymeKeyOf, type Pronunciation, type RhymeKey } from "./phonology.ts";
import { schwaTwinOf } from "./schwaTwins.ts";

// ---- the rhyme prompt -------------------------------------------------------

/**
 * The sounds the Judge must hear as one: a line for every Normalisation that
 * has shipped, under the rule's name (#241, #266). Without the tap's line it
 * refused `cruder` for `computer` five times in five. A rule that ships adds its
 * line here and `judge --score` is run again before the writes are trusted; a
 * test holds these names to `NORMALISATION_NAMES`. The weak-vowel, glide-r and
 * syllabic lines are #232's wording, carried across verbatim. A new line's
 * examples are kept off the label sets, or the score on them is no longer blind.
 */
export const NORMALISATION_LINES: Readonly<Record<string, string>> = {
  "cot-caught-merger": `Except before r, the vowels of "cot" and "caught" (AA and AO) are one sound: "talked" for "docked", "ball" for "doll". Before r they stay apart: "for" is not a Rhyme for "far".`,
  "syllabic-consonant": `After "eye", "oh", "oo", "ow" or "oy" (AY, OW, UW, AW, OY), a weak "ul" (AH0 L) and plain l are read as each other, and so are their -s and -ed forms: "trial" for "file", "jewel" for "rule", "towels" for "howls".`,
  "weak-vowel-merge": `After the stressed vowel of the Rhyme Key, weak "ih" and weak "uh" (ARPAbet IH0 and AH0) are one sound: "utility" for "facility", "annotated" for "abated", "direction" for "collection".`,
  tap: `A t or a d with a vowel or r before it and a weak vowel after it is one sound, the quick tap: "ladder" for "latter", "medal" for "petal", "disorder" for "quarter". Not after "eye" or "ow" ("rider" is not a Rhyme for "writer", nor "crowded" for "shouted"), and not where the next syllable is a weak "n" ("sudden" is not a Rhyme for "button").`,
  "stress-promotion": `A full vowel in a closed last syllable carries a secondary stress even where a dictionary marks it unstressed: "candidate" for "ate", "module" for "rule". Never a weak vowel ("chocolate" is not a Rhyme for "ate"), and never a vowel closed only by an -s or -ed ending ("arrows" is not a Rhyme for "nose").`,
  "vowel-before-r": `Before r, a stressed "ee" and "ih" are one sound (IY and IH), and so are "oo" and "uu" (UW and UH), and "ay" and "eh" (EY and EH): "near" for "here", "tour" for "poor", "menswear" for "air". Before r and a vowel, "a" and "eh" (AE and EH) are one sound too: "barbaric" for "generic". "car" and "care" stay apart, and so do "cure" and "core".`,
  "glide-r": `After "eye", "ow" or "oy" (AY, AW, OY), "er" and plain r are read as each other: "higher" for "fire", "flower" for "hour".`,
};

/** The rules of #232 in the `--rules 2` wording, with a line for every shipped Normalisation (#266). */
export const RHYME_RULES = `You are ruling on Candidates for Rhyming Bee, a daily word game. The player is given a Seed Word and types words that rhyme with it. Each Candidate below is a word a player typed that the game did not score. Every Candidate is on the game's word list, so do not rule on whether it is a word, and do not rule on how well known it is. Rule on one thing: is the pair a Rhyme? A Rhyme is what scores.

The game adjudicates in merged General American (cot and caught are the same vowel). It is generous about stress and strict about sound.

THE RULE. A word's Rhyme Key is the rime of its last stressed syllable (its vowel and the consonants after that vowel) together with every syllable after it. The consonants before the vowel are ignored. The stressed syllable may carry main or secondary stress, and the game draws no line between the two: "copycat" has the Rhyme Key of "cat", "adjudicate" of "ate". The pair is a Rhyme when the Candidate, as General American says it, has exactly the Seed Word's Rhyme Key. Spelling is irrelevant. A word may be said more than one way, and one way that fits is enough. That way must be one heard across General American: "route" is said to rhyme with "boot" and with "out", and both count. A reading that belongs to one region does not count ("wash" said with an r, "greasy" said with a z), even where a dictionary lists it.

NOT A RHYME:
- Any differing sound in the vowel or after it, a one-sound difference included ("pollution" for "delusion", "time" for "fine").
- A match only on an unstressed last syllable ("magic" for "trick", "stylish" for "dish", "boulder" for "fur", "facility" for "tree").
- An extra or missing syllable ("serial" for "meal", "betrayal" for "male"), except for the r and l readings below.

READ AS THE SAME:
${NORMALISATION_NAMES.map((name) => `- ${NORMALISATION_LINES[name]}`).join("\n")}

ALSO A RHYME: a homophone of the Seed Word; a longer word whose last part is the Seed Word; a compound, whose last part keeps a secondary stress ("carsick" and "drumstick" for "trick").

A Rhyme holds in both directions. If the Candidate is a Rhyme for the Seed Word, then the Seed Word is a Rhyme for the Candidate, and every word that rhymes with one rhymes with the other. If you would not rule it both ways, it is not a Rhyme.

Rule each Candidate as exactly one of:
- "rhyme": give the reading that makes it one, in ARPAbet with stress digits. The reading must put stress 1 or 2 on the first vowel of the Seed Word's Rhyme Key and no stressed vowel after it.
- "no-rhyme": however General American says the word, it does not have the Seed Word's Rhyme Key.`;

const RHYME_REPLY = `Reply with only a JSON array, one object per Candidate in the order given:
[{"word": "...", "verdict": "rhyme" | "no-rhyme", "reading": "ARPAbet or null", "confidence": "high" | "medium" | "low", "why": "one short sentence"}]`;

/** One pair the Judge rules on: a word typed for a Seed Word. */
export interface JudgedPair {
  word: string;
  seedWord: string;
}

/** The prompt for one call: the rules, the Candidates in order, and the reply asked for. */
export function rhymePrompt(pairs: readonly JudgedPair[]): string {
  const lines = pairs.map((p) => `- "${p.word}" for the Seed Word "${p.seedWord}"`);
  return [RHYME_RULES, "", "Candidates:", ...lines, "", RHYME_REPLY].join("\n");
}

/** How many Candidates one call carries, as the margin was measured. */
export const RHYME_BATCH = 8;

/**
 * The calls a list of pairs is sent in: grouped by Rhyme Key where they can be,
 * as the Candidate Queue is, and then by word, so the same list always makes the
 * same prompts.
 */
export function rhymeBatches<T extends JudgedPair & { rhymeKey: RhymeKey }>(pairs: readonly T[], size = RHYME_BATCH): T[][] {
  const ordered = [...pairs].sort((a, b) => a.rhymeKey.localeCompare(b.rhymeKey) || a.word.localeCompare(b.word) || a.seedWord.localeCompare(b.seedWord));
  const out: T[][] = [];
  for (let i = 0; i < ordered.length; i += size) out.push(ordered.slice(i, i + size));
  return out;
}

// ---- reading a reply ---------------------------------------------------------

export type RhymeVerdict = "rhyme" | "no-rhyme" | "no-ruling";
export type Confidence = "high" | "medium" | "low";

export interface RhymeRuling {
  verdict: RhymeVerdict;
  /** The reading the Judge says makes the pair a Rhyme, as it wrote it. */
  reading: string | null;
  confidence: Confidence;
  why: string;
}

const CONFIDENCES = new Set(["high", "medium", "low"]);

/**
 * The last JSON array in a reply. The Judge sometimes writes an array, takes it
 * back in a sentence and writes the whole array again (one call in 16 on
 * batch-2), so the last array that parses is the ruling.
 */
function lastArray(raw: string): unknown[] {
  const end = raw.lastIndexOf("]");
  if (end < 0) return [];
  for (let at = raw.lastIndexOf("[", end); at >= 0; at = at === 0 ? -1 : raw.lastIndexOf("[", at - 1)) {
    try {
      const got: unknown = JSON.parse(raw.slice(at, end + 1));
      if (Array.isArray(got)) return got;
    } catch {
      // An earlier bracket may open it.
    }
  }
  return [];
}

const field = (o: unknown, name: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[name] : undefined);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

const NO_RHYME_RULING: RhymeRuling = { verdict: "no-ruling", reading: null, confidence: "low", why: "unparseable reply" };

/** One ruling per Candidate, in the order they were sent. What cannot be read is `no-ruling`. */
export function parseRhymeReply(raw: string, count: number): RhymeRuling[] {
  const got = lastArray(raw);
  return Array.from({ length: count }, (_, i) => {
    const o = got[i];
    const verdict = field(o, "verdict");
    if (verdict !== "rhyme" && verdict !== "no-rhyme") return { ...NO_RHYME_RULING };
    const confidence = field(o, "confidence");
    const reading = field(o, "reading");
    return {
      verdict,
      reading: typeof reading === "string" && reading.trim() ? reading : null,
      confidence: CONFIDENCES.has(confidence as string) ? (confidence as Confidence) : "low",
      why: text(field(o, "why")),
    };
  });
}

// ---- the wordhood question ---------------------------------------------------

const WORDHOOD_QUESTION = `You are checking words for Rhyming Bee, a daily word game in which players type English words. Every word below is on the game's word list, but the list holds some names and some strings that are not words, and the game never scores either. Rule each word as exactly one of:
- "word": an English word, however rare. A word that is also a name is a word ("sue", "bill", "grace"), and so is a regular form of a word (a plural, a past tense, an -ing form) or a compound.
- "name": only a name, of a person, a place, a brand or the like.
- "not-a-word": not an English word at all: an abbreviation, a misspelling, a fragment, or a word from another language.

Reply with only a JSON array, one object per word in the order given:
[{"word": "...", "verdict": "word" | "name" | "not-a-word", "confidence": "high" | "medium" | "low", "why": "one short sentence"}]`;

/** How many words one wordhood call carries, as it was measured. */
export const WORDHOOD_BATCH = 20;

export function wordhoodPrompt(words: readonly string[]): string {
  return [WORDHOOD_QUESTION, "", "Words:", ...words.map((w) => `- ${w}`)].join("\n");
}

export type WordhoodVerdict = "word" | "name" | "not-a-word" | "no-ruling";

export interface WordhoodRuling {
  word: string;
  verdict: WordhoodVerdict;
  confidence: Confidence;
  why: string;
}

/** One ruling per word asked about. A ruling written against another word is no ruling on this one. */
export function parseWordhoodReply(raw: string, words: readonly string[]): WordhoodRuling[] {
  const got = lastArray(raw);
  return words.map((word, i) => {
    const o = got[i];
    const verdict = field(o, "verdict");
    if (field(o, "word") !== word || (verdict !== "word" && verdict !== "name" && verdict !== "not-a-word")) {
      return { word, verdict: "no-ruling", confidence: "low", why: "unparseable reply" };
    }
    const confidence = field(o, "confidence");
    return {
      word,
      verdict,
      confidence: CONFIDENCES.has(confidence as string) ? (confidence as Confidence) : "low",
      why: text(field(o, "why")),
    };
  });
}

// ---- the reading check ---------------------------------------------------------

const PHONEME = /^[A-Z]{1,2}[012]?$/;

/** A reading's phonemes, or null when it is not ARPAbet. */
export function phonemesOf(reading: string | null): Pronunciation | null {
  const parts = (reading ?? "").trim().toUpperCase().split(/\s+/).filter(Boolean);
  return parts.length && parts.every((p) => PHONEME.test(p)) ? parts : null;
}

/** True if any of these readings, as the index holds them, has the key, directly or by its Schwa Twin. */
export function readingsReachKey(readings: readonly Pronunciation[], key: RhymeKey): boolean {
  const twin = schwaTwinOf(key);
  return readings.some((r) => {
    const k = rhymeKeyOf(r);
    return k === key || (twin !== null && k === twin);
  });
}

/**
 * The gate: a "rhyme" counts only when the reading the Judge gives reaches the
 * Rhyme Key. The reading is put through the build's Normalisation first, so it
 * is read exactly as a dictionary reading would be: the Judge often writes the
 * caught vowel, and a key holds the merged one.
 */
export function readingReachesKey(reading: string | null, key: RhymeKey): boolean {
  const phonemes = phonemesOf(reading);
  if (!phonemes) return false;
  const pronunciations = new Map([["", [phonemes]]]);
  applyNormalisation({ pronunciations });
  return readingsReachKey(pronunciations.get("")!, key);
}

// ---- which Candidates the Judge is asked about --------------------------------

/**
 * What the game knew about the word, which is what a ruling is named for (#238):
 * a **Missing Reading** is no reading at all, and an **Overrule** is a reading
 * that misses the Rhyme Key.
 */
export type WhatTheGameKnew = "missing-reading" | "overrule";

/** Why a Candidate is not sent to the Judge. */
export type SetAside =
  /** A reading already has the key: what is left is a Tier, or nothing. */
  | "already-rhymes"
  /** Off the word list: a wordhood question, with no right reading to rule on. */
  | "not-on-word-list";

export type JudgeQuestion = { ask: WhatTheGameKnew } | { setAside: SetAside };

/** What the index holds for one word. */
export interface WordFacts {
  isWord: boolean;
  /** The readings a Rhyme is decided on. */
  readings: readonly Pronunciation[];
}

/**
 * Whether the Judge is asked about a word typed for a Rhyme Key, and as what.
 * The `lunatic` shape (`heretic` for `trick`) is asked like any other since
 * #233 ruled on it: the game holds a reading for it, so it is an Overrule and
 * lands at most as an Unconfirmed Rhyme (#266).
 */
export function judgeQuestion(facts: WordFacts, key: RhymeKey): JudgeQuestion {
  if (!facts.isWord) return { setAside: "not-on-word-list" };
  if (readingsReachKey(facts.readings, key)) return { setAside: "already-rhymes" };
  return { ask: facts.readings.length === 0 ? "missing-reading" : "overrule" };
}

// ---- where a ruling would land -------------------------------------------------

/**
 * ADR-0017's table. `reading` writes the Judge's reading into the game, and the
 * word rhymes from then on. `unconfirmed-rhyme` accepts it without Points on this
 * Rhyme Key only. `demotion` holds it back for the editor as a suggested
 * Demotion. `editors-pass` writes nothing: the Candidate waits, with the ruling
 * kept beside it.
 */
export type Landing = "reading" | "unconfirmed-rhyme" | "demotion" | "editors-pass";

export interface Classification {
  knew: WhatTheGameKnew;
  verdict: RhymeVerdict;
  confidence: Confidence;
  /** The gate: the Judge's reading reaches the Rhyme Key. */
  reachesKey: boolean;
  /** Where the ruling would land. Reported, never acted on here. */
  lands: Landing;
  /** True when the ruling would act and the wordhood question has not been asked. */
  needsWordhood: boolean;
}

/**
 * Where a ruling would land, by what the game knew (#238). Only a ruling that
 * would act needs the wordhood question; until it is answered, `lands` is what
 * the ruling earns and `needsWordhood` says the question is still to be asked.
 */
export function classifyRuling(
  knew: WhatTheGameKnew,
  ruling: RhymeRuling,
  key: RhymeKey,
  wordhood?: WordhoodRuling,
): Classification {
  const reachesKey = ruling.verdict === "rhyme" && readingReachesKey(ruling.reading, key);
  const earned: Landing = !reachesKey
    ? "editors-pass"
    : ruling.confidence === "high"
      ? knew === "missing-reading" ? "reading" : "unconfirmed-rhyme"
      : ruling.confidence === "medium" && knew === "missing-reading" ? "unconfirmed-rhyme" : "editors-pass";
  const acts = earned !== "editors-pass";
  const lands: Landing = !acts || !wordhood
    ? earned
    : wordhood.verdict === "word" ? earned
    : wordhood.verdict === "no-ruling" ? "editors-pass"
    : "demotion";
  return { knew, verdict: ruling.verdict, confidence: ruling.confidence, reachesKey, lands, needsWordhood: acts && !wordhood };
}
