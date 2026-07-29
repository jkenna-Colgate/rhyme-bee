/**
 * Coverage derivation: the build stage that gives an ordinary word a reading by
 * composing it from a known stem's reading, so the game stops rejecting words it
 * already holds the sounds for. `undocked` is the case that motivated it — the
 * index knows `docked`, and 93% of people report knowing `undocked`, yet it came
 * back `not-a-known-word`.
 *
 * ## Where this sits in the index build
 *
 *     pinned upstream inputs      data/cmudict.dict, words.txt, names.txt
 *       -> committed supplement   hand-authored readings (ADR-0009)
 *       -> coverage derivation    this stage
 *       -> normalisation          the accent specification (ADR-0010)
 *       -> Rhyme Index
 *
 * It runs after the supplement so a hand-authored reading is always preferred to
 * a composed one, and before normalisation so a derived reading is an input to
 * the accent specification rather than an exemption from it. Nothing downstream
 * knows this stage exists: it produces ordinary pronunciations.
 *
 * Nothing here is inferred from spelling. Every phoneme in a derived reading
 * comes either from the pinned reading of a word the dictionary already holds,
 * or from the affix's own configured phonemes — which is why this is not the
 * grapheme-to-phoneme guesswork ADR-0009 deferred (see its 2026-07-29
 * amendment). The one thing a rule can get wrong is the *segmentation*, and the
 * derived-words report exists to put every segmentation in front of a human.
 *
 * ## What it may and may not do
 *
 * **Derivation supplies a reading only — never wordhood.** Unlike the committed
 * supplement, it cannot introduce a word: `words` and `names` are read-only
 * here, which is why the target type says so in its types. A word nobody has
 * granted wordhood to stays underived and still rejects as not a known word.
 *
 * It never overwrites a reading either, from upstream data or from the
 * supplement — a word with a reading is simply not a target.
 *
 * ## The candidate set
 *
 * A word is a derivation target when it is in the prevalence norms, already
 * carries wordhood, is not a name, and has no reading from any earlier stage.
 * Bounding it to the norms does more work than it looks: it keeps derivation on
 * attested vocabulary rather than word-list artefacts, and it guarantees every
 * derived word arrives with a knownness — so it tiers as an Answer or a Bonus
 * Word on the ordinary threshold, with no special case anywhere.
 *
 * The candidate set is deliberately independent of the affix inventory in
 * `src/affixes.ts`: a slice that adds suffixes widens what can be reached
 * without touching what may be reached.
 *
 * ## One pass
 *
 * Derived readings are staged and written only once every target has been
 * considered, so a derived reading is never itself a stem in the same build.
 * `misunderstand` therefore waits: `understand` gains its reading this build,
 * and `misunderstand` could only be built on it in the next one. Chaining
 * would stack one segmentation on another, and the report would stop naming a
 * stem whose reading a human can check against the pinned dictionary.
 */

import { AFFIX_RULES } from "./affixes.ts";
import type { Pronunciation } from "./phonology.ts";

/**
 * The part of the index build's data this stage touches. `words` and `names`
 * are read-only by type: derivation supplies readings and never wordhood.
 */
export interface CoverageTarget {
  /** Surface form -> its pronunciations (mutated in place). */
  pronunciations: Map<string, Pronunciation[]>;
  /** The wordhood gate — read only; derivation never adds to it. */
  words: ReadonlySet<string>;
  /** Proper nouns — read only; a name is never given a reading. */
  names: ReadonlySet<string>;
  /** Lemma -> knownness. Bounds the candidate set to attested vocabulary. */
  prevalence: ReadonlyMap<string, number>;
}

/** One line of the derived-words report. */
export interface DerivedWord {
  /** The word that gained a reading. */
  word: string;
  /** The known word whose reading it was composed from. */
  stem: string;
  /** The affix rule that produced it, e.g. `prefix:un`. */
  rule: string;
}

/**
 * The words this stage may give a reading to, in a stable order. Exported
 * because the candidate set is the part later coverage slices reuse wholesale —
 * and because "which words are still unreachable" is a question worth asking of
 * the build directly.
 */
export function* derivationTargets(target: CoverageTarget): Generator<string> {
  for (const word of target.prevalence.keys()) {
    if (!target.words.has(word)) continue;
    if (target.names.has(word)) continue;
    if ((target.pronunciations.get(word)?.length ?? 0) > 0) continue;
    yield word;
  }
}

/** Collapse readings that compose to the same thing, preserving order. */
function dedupe(readings: Pronunciation[]): Pronunciation[] {
  const seen = new Set<string>();
  return readings.filter((reading) => {
    const key = reading.join(" ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The first rule that reaches `word` from a stem the build already reads, with
 * every reading that stem carries. A stem with several pronunciations yields
 * several derived pronunciations, because a Submission rhymes if *any* of its
 * readings rhymes (ADR-0001).
 *
 * The stem must carry wordhood, not merely appear in the raw dictionary: a
 * surname or a dictionary artefact would otherwise father a whole family of
 * readings that no player could have meant.
 */
function derive(
  word: string,
  target: CoverageTarget,
): { stem: string; rule: string; readings: Pronunciation[] } | null {
  for (const rule of AFFIX_RULES) {
    for (const stem of rule.stemsOf(word)) {
      if (!target.words.has(stem) || target.names.has(stem)) continue;
      const stemReadings = target.pronunciations.get(stem);
      if (!stemReadings || stemReadings.length === 0) continue;

      const readings = dedupe(
        stemReadings
          .map((reading) => rule.read(reading))
          .filter((reading): reading is Pronunciation => reading !== null),
      );
      if (readings.length > 0) return { stem, rule: rule.name, readings };
    }
  }
  return null;
}

/**
 * Run the coverage derivation stage over an index build's data, in place.
 * Called once by `scripts/build-index.ts`, between the committed supplement and
 * normalisation.
 *
 * Returns the derived-words report: every word that gained a reading, the stem
 * it was composed from and the rule that did it, sorted by word. It is returned
 * rather than written here for the same reason the dropped-words report is built
 * in the build script — this module does no file IO — and it ships with the
 * first slice precisely so over-generation is visible from the first commit.
 */
export function applyCoverage(target: CoverageTarget): DerivedWord[] {
  const staged = new Map<string, Pronunciation[]>();
  const report: DerivedWord[] = [];

  for (const word of derivationTargets(target)) {
    const found = derive(word, target);
    if (found === null) continue;
    staged.set(word, found.readings);
    report.push({ word, stem: found.stem, rule: found.rule });
  }

  // Written only now, so nothing derived above could have been read as a stem.
  for (const [word, readings] of staged) target.pronunciations.set(word, readings);

  report.sort((a, b) => a.word.localeCompare(b.word));
  return report;
}
