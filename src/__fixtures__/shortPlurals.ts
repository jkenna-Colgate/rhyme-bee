/**
 * A miniature Rhyme Index for the three-letter `-s` question (issue #97): does a
 * short plural reach its lemma, and only when the *sound* agrees?
 *
 * Hand-built rather than drawn from the pinned data files, so the assertions
 * stay put when upstream is repinned. Six pairs carry the whole rule:
 *
 *   - `up`/`ups`, `in`/`ins`, `el`/`els` — the reading agrees (base + `S`/`Z`),
 *     so the plural is derived. Each sits in a family of nothing but derived
 *     forms, which makes its key a Shadow Key with no Seed to offer.
 *   - `ha`/`has` and `ga`/`gas` — the vowel disagrees (`HH AE1 Z` against
 *     `HH AA1`), so the plural is native and its key keeps its content.
 *   - `wa`/`was` and `ye`/`yes` — the reading agrees, in the dictionary's own
 *     transcription, so both are derived. They are the rule's known misses:
 *     their families keep native members, and both words keep their own
 *     knownness because they appear in the prevalence norms.
 *
 * Every base carries a reading of its own, because the rule is a comparison of
 * two readings and a base with none could never license anything. That puts each
 * base in its own family — `up` in `AH P`, never in `AH P S` — which is exactly
 * where the real index puts it.
 */

import type { Pronunciation } from "../phonology.ts";
import type { RhymeIndex } from "../rhymeIndex.ts";
import { buildSlice } from "./build.ts";

/** The committed threshold, so `el` (below zero) tiers as the data says. */
const KNOWNNESS_THRESHOLD = 0.0;

const p = (...phonemes: string[]): Pronunciation[] => [phonemes];

const pronunciations = new Map<string, Pronunciation[]>([
  // AH P S — every member is a plural of a word in the `up` family.
  ["ups", p("AH1", "P", "S")],
  ["cups", p("K", "AH1", "P", "S")],
  ["pups", p("P", "AH1", "P", "S")],
  // IH N Z — likewise. `in` reads two ways; only the stressed one can be a base.
  ["ins", p("IH1", "N", "Z")],
  ["pins", p("P", "IH1", "N", "Z")],
  ["wins", p("W", "IH1", "N", "Z")],
  // EH L Z — likewise.
  ["els", p("EH1", "L", "Z")],
  ["bells", p("B", "EH1", "L", "Z")],
  ["cells", p("S", "EH1", "L", "Z")],
  // AE Z — `has` is not `ha` + Z, so the family keeps three native members.
  ["has", p("HH", "AE1", "Z")],
  ["jazz", p("JH", "AE1", "Z")],
  ["razz", p("R", "AE1", "Z")],
  // AE S — `gas` is not `ga` + S, for the same reason.
  ["gas", p("G", "AE1", "S")],
  ["mass", p("M", "AE1", "S")],
  ["lass", p("L", "AE1", "S")],
  // AA Z — `was` *is* `wa` + Z, a known miss; `cause`/`pause` keep the family.
  ["was", p("W", "AA1", "Z")],
  ["cause", p("K", "AA1", "Z")],
  ["pause", p("P", "AA1", "Z")],
  // EH S — `yes` *is* `ye` + S, the other known miss.
  ["yes", p("Y", "EH1", "S")],
  ["mess", p("M", "EH1", "S")],
  ["bless", p("B", "L", "EH1", "S")],
  // IH N — `inn` reaches `in` by de-doubling, a candidate no `-s` rule made and
  // no sound test may take away.
  ["inn", p("IH1", "N")],
  // AH S — `bus` has no base to be a plural of, so it stays native.
  ["bus", p("B", "AH1", "S")],
  ["plus", p("P", "L", "AH1", "S")],
  ["thus", p("DH", "AH1", "S")],
]);

/** Bases, present as words and as readings the phonological test can consult. */
const baseReadings = new Map<string, Pronunciation[]>([
  ["up", p("AH1", "P")],
  ["in", [["IH0", "N"], ["IH1", "N"]]],
  ["el", p("EH1", "L")],
  ["ha", p("HH", "AA1")],
  ["ga", p("G", "AA1")],
  ["wa", p("W", "AA1")],
  ["ye", [["Y", "IY1"], ["Y", "EH1"]]],
  ["cup", p("K", "AH1", "P")],
  ["pup", p("P", "AH1", "P")],
  ["pin", p("P", "IH1", "N")],
  ["win", p("W", "IH1", "N")],
  ["bell", p("B", "EH1", "L")],
  ["cell", p("S", "EH1", "L")],
]);

/**
 * Knownness, on the same z-scale as the real norms. Every base is scored
 * differently from its plural, so a form that wrongly inherited its base's
 * knownness would show it. `ups`, `ins` and `els` are absent on purpose: their
 * lemma carries the score, which is the whole point of the lookup. `el` sits
 * below the threshold and `ha` well above it — the pair that rules out every
 * knownness-threshold version of this rule.
 */
const prevalence = new Map<string, number>([
  ["up", 2.0], ["in", 2.5], ["el", -0.324],
  ["ha", 1.28], ["ga", 0.5], ["wa", 0.1], ["ye", 0.3],
  // `has` is absent, as it is from the real norms — so if the rule ever took
  // `ha` as its base, `has` would jump from Bonus Word to Answer on knownness
  // that is not its own. That flip is the test.
  ["gas", 2.0], ["was", 2.4], ["yes", 2.3], ["bus", 1.9],
  ["cups", 1.7], ["pups", 1.5], ["pins", 1.6], ["wins", 1.8],
  ["bells", 1.4], ["cells", 1.6],
  ["jazz", 1.5], ["razz", 0.2], ["mass", 1.8], ["lass", 0.4],
  ["cause", 2.2], ["pause", 1.9], ["mess", 1.9], ["bless", 1.3],
  ["plus", 2.1], ["thus", 1.7],
  ["cup", 2.2], ["pup", 1.4], ["pin", 1.8], ["win", 2.3],
  ["bell", 1.9], ["cell", 2.0],
]);

/** Built by the same call the real build makes, all four stages (#106). */
export function makeShortPluralIndex(): RhymeIndex {
  const readings = new Map([...pronunciations, ...baseReadings]);
  return buildSlice(
    { pronunciations: readings, words: readings.keys(), prevalence },
    KNOWNNESS_THRESHOLD,
  ).index;
}
